/// Winter App — Tauri backend entry point.
/// This file contains only module declarations, thin Tauri command wrappers,
/// and the `run()` function. All logic lives in the submodules.

mod claude;
mod scheduler;
mod services;
mod memory;
mod modes;
mod ollama;
mod opencode;

use claude::client::{build_system_prompt, get_model, handle_tool_use, stream_response};
use claude::types::{ChatMessage, ChatStreamEvent, ContentBlock, MessageContent};
use memory::WinterMemoryDB;
use modes::MessageMode;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_store::StoreExt;

/// The filename of the persistent Tauri store used for settings and tokens.
const STORE_FILE: &str = "settings.json";

/// OAuth PKCE store key for the access token.
const STORE_KEY_ACCESS: &str = "oauth_access_token";

/// OAuth PKCE store key for the refresh token.
const STORE_KEY_REFRESH: &str = "oauth_refresh_token";

/// OAuth PKCE store key for the token expiry timestamp (Unix ms).
const STORE_KEY_EXPIRES: &str = "oauth_expires";

/// Anthropic OAuth token endpoint.
const TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";

/// Redirect URI registered for the Winter App OAuth flow.
const REDIRECT_URI: &str = "https://console.anthropic.com/oauth/code/callback";

/// OAuth client ID for the Winter App.
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/// Maximum number of tool-use rounds per chat_send call before forcing a stop.
const MAX_TOOL_ROUNDS: usize = 25;

/// Default OpenCode server URL when no override is stored.
const DEFAULT_OPENCODE_URL: &str = "http://127.0.0.1:6096";

/// Resolves the default OpenCode workspace directory at runtime from $HOME (or $USERPROFILE on Windows).
/// Falls back to "." if neither variable is set — the caller should prompt the user to configure a directory.
fn default_opencode_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(|h| format!("{}/.winter/workspace", h))
        .unwrap_or_else(|_| ".".to_string())
}

/// Store key for the MBTI personality modifier.
const STORE_KEY_MBTI_MODIFIER: &str = "mbti_prompt_modifier";

// ── OAuth PKCE Internals ────────────────────────────────────────────

/// OAuth PKCE verifier/challenge pair, stored in app state until code exchange.
struct PkceState {
    /// The PKCE code verifier to use during token exchange.
    verifier: String,
    #[allow(dead_code)]
    /// Timestamp (ms) when this PKCE state was created.
    created: u64,
}

/// A parsed OAuth token response from the Anthropic token endpoint.
#[derive(Deserialize)]
struct TokenResponse {
    /// The new access token.
    access_token: String,
    /// The new refresh token.
    refresh_token: String,
    /// Seconds until the access token expires.
    expires_in: u64,
}

/// Usage limit data for one of Claude's rate limit windows.
#[derive(Serialize, Clone)]
struct UsageLimit {
    /// Fraction of the limit consumed (0.0–1.0).
    utilization: Option<f64>,
    /// ISO 8601 timestamp when this limit resets.
    resets_at: Option<String>,
}

/// Claude API usage data across multiple time windows.
#[derive(Serialize, Clone)]
struct ClaudeUsage {
    /// 5-hour window usage.
    five_hour: Option<UsageLimit>,
    /// 7-day window usage.
    seven_day: Option<UsageLimit>,
    /// 7-day Opus-only window usage.
    seven_day_opus: Option<UsageLimit>,
}

// ── Helper Functions ────────────────────────────────────────────────

/// Generates a PKCE verifier/challenge pair using SHA-256 and URL-safe base64.
fn generate_pkce() -> (String, String) {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let verifier =
        URL_SAFE_NO_PAD.encode((0..32).map(|_| rand::random::<u8>()).collect::<Vec<u8>>());

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    (verifier, challenge)
}

/// Returns the current time as Unix milliseconds.
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Reads the access token from the store, returning `AUTH_EXPIRED` if the token has expired.
fn get_access_token(app: &AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let expires = store
        .get(STORE_KEY_EXPIRES)
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if now_millis() > expires {
        return Err("AUTH_EXPIRED".to_string());
    }
    store
        .get(STORE_KEY_ACCESS)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "Not authenticated.".to_string())
}

/// Refreshes the access token using the stored refresh token.
async fn refresh_access_token(app: &AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let refresh_token = store
        .get(STORE_KEY_REFRESH)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "No refresh token.".to_string())?;

    let payload = json!({
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "refresh_token": refresh_token
    });
    let resp = Client::new()
        .post(TOKEN_URL)
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("{}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Refresh failed: {}", resp.status()));
    }
    let tokens: TokenResponse = resp.json().await.map_err(|e| format!("{}", e))?;

    store.set(STORE_KEY_ACCESS, json!(tokens.access_token));
    store.set(STORE_KEY_REFRESH, json!(tokens.refresh_token));
    store.set(
        STORE_KEY_EXPIRES,
        json!(now_millis() + tokens.expires_in * 1000),
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(tokens.access_token)
}

/// Builds an OpenCodeClient from the user's stored URL and directory settings.
fn get_opencode_client(app: &AppHandle) -> Result<opencode::OpenCodeClient, String> {
    Ok(opencode::OpenCodeClient::new(
        get_opencode_url(app),
        get_opencode_dir(app),
    ))
}

/// Reads the OpenCode server URL from the store, falling back to DEFAULT_OPENCODE_URL.
fn get_opencode_url(app: &AppHandle) -> String {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get("opencode_url"))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENCODE_URL.to_string())
}

/// Reads the OpenCode workspace directory from the store, falling back to DEFAULT_OPENCODE_DIR.
fn get_opencode_dir(app: &AppHandle) -> String {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get("opencode_directory"))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_opencode_dir())
}

// ── OAuth Commands ──────────────────────────────────────────────────

/// Generates the OAuth authorization URL and stores the PKCE verifier in app state.
/// The returned URL should be opened in a browser for the user to authenticate.
#[tauri::command]
fn get_authorize_url(app: AppHandle) -> Result<String, String> {
    let (verifier, challenge) = generate_pkce();
    let query = [
        ("code", "true"),
        ("client_id", CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", REDIRECT_URI),
        ("scope", "org:create_api_key user:profile user:inference"),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", verifier.as_str()),
    ]
    .iter()
    .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
    .collect::<Vec<_>>()
    .join("&");

    *app.state::<Mutex<Option<PkceState>>>()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(PkceState {
        verifier,
        created: now_millis(),
    });
    Ok(format!("https://claude.ai/oauth/authorize?{}", query))
}

/// Exchanges an OAuth authorization code for access/refresh tokens, storing them persistently.
#[tauri::command]
async fn exchange_code(app: AppHandle, code: String) -> Result<(), String> {
    let verifier = {
        let state = app.state::<Mutex<Option<PkceState>>>();
        let guard = state.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(s) => s.verifier.clone(),
            None => return Err("No PKCE state. Get authorize URL first.".to_string()),
        }
    };

    let parts: Vec<&str> = code.split('#').collect();
    let payload = json!({
        "code": parts[0],
        "state": if parts.len() > 1 { parts[1] } else { "" },
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    });

    let client = Client::new();
    let resp = client
        .post(TOKEN_URL)
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("{}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Token exchange failed: {}", resp.status()));
    }
    let tokens: TokenResponse = resp.json().await.map_err(|e| format!("{}", e))?;

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_ACCESS, json!(tokens.access_token));
    store.set(STORE_KEY_REFRESH, json!(tokens.refresh_token));
    store.set(
        STORE_KEY_EXPIRES,
        json!(now_millis() + tokens.expires_in * 1000),
    );
    store.save().map_err(|e| e.to_string())?;
    *app.state::<Mutex<Option<PkceState>>>()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Returns true if a non-expired access token is stored.
#[tauri::command]
async fn is_authenticated(app: AppHandle) -> Result<bool, String> {
    Ok(get_access_token(&app).is_ok())
}

/// Clears all stored OAuth tokens, effectively logging the user out.
#[tauri::command]
async fn logout(app: AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(STORE_KEY_ACCESS);
    store.delete(STORE_KEY_REFRESH);
    store.delete(STORE_KEY_EXPIRES);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Chat Commands ───────────────────────────────────────────────────

/// Sends a multi-turn chat to Claude (direct API), streaming events back through the IPC channel.
/// Handles token refresh, tool-use loops, and optional Ollama history compression.
#[tauri::command]
async fn chat_send(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let mut access_token = get_access_token(&app)?;
    let client = Client::new();
    let abort_flag = app.state::<Arc<AtomicBool>>();
    abort_flag.store(false, Ordering::SeqCst);
    tokio::task::yield_now().await;
    abort_flag.store(false, Ordering::SeqCst);
    if on_event.send(ChatStreamEvent::StreamStart).is_err() {
        return Ok(());
    }

    let system_prompt = build_system_prompt(&app);
    let model = get_model(&app);
    let mut conversation = messages;
    let ollama_settings = ollama::get_settings(&app);

    if ollama_settings.enabled && conversation.len() > 10 {
        let _ = on_event.send(ChatStreamEvent::OllamaStatus {
            status: "compressing".to_string(),
        });
        match ollama::compress_history(
            &ollama_settings.base_url,
            &ollama_settings.model,
            &conversation,
        )
        .await
        {
            Ok(compressed) => {
                conversation = compressed;
            }
            Err(_) => {
                let _ = on_event.send(ChatStreamEvent::OllamaStatus {
                    status: "compression_failed".to_string(),
                });
            }
        }
        let _ = on_event.send(ChatStreamEvent::OllamaStatus {
            status: "done".to_string(),
        });
    }

    for round in 0..MAX_TOOL_ROUNDS {
        if abort_flag.load(Ordering::SeqCst) {
            break;
        }
        if round > 0 {
            if let Err(e) = get_access_token(&app) {
                if e == "AUTH_EXPIRED" {
                    let mutex = app.state::<tokio::sync::Mutex<()>>();
                    let _guard = mutex.lock().await;
                    access_token = refresh_access_token(&app).await?;
                    drop(_guard);
                }
            }
        }
        let result = match stream_response(
            &client,
            &access_token,
            &conversation,
            &on_event,
            &system_prompt,
            &abort_flag,
            &model,
        )
        .await
        {
            Ok(r) => r,
            Err(e) if e == "AUTH_EXPIRED" => {
                let mutex = app.state::<tokio::sync::Mutex<()>>();
                let _guard = mutex.lock().await;
                access_token = refresh_access_token(&app).await?;
                drop(_guard);
                stream_response(
                    &client,
                    &access_token,
                    &conversation,
                    &on_event,
                    &system_prompt,
                    &abort_flag,
                    &model,
                )
                .await?
            }
            Err(e) => return Err(e),
        };

        if result.stop_reason == "aborted" {
            break;
        }
        if result.stop_reason == "tool_use" && !result.tool_uses.is_empty() {
            let mut assistant_blocks = Vec::new();
            if !result.text_content.is_empty() {
                assistant_blocks.push(ContentBlock::Text {
                    text: result.text_content,
                });
            }
            for (id, name, input_json) in &result.tool_uses {
                let input: serde_json::Value =
                    serde_json::from_str(input_json).unwrap_or(json!({}));
                assistant_blocks.push(ContentBlock::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input,
                });
            }
            conversation.push(ChatMessage {
                role: "assistant".to_string(),
                content: MessageContent::Blocks(assistant_blocks),
            });

            let tool_result_blocks =
                handle_tool_use(&result.tool_uses, &ollama_settings, &on_event).await;
            conversation.push(ChatMessage {
                role: "user".to_string(),
                content: MessageContent::Blocks(tool_result_blocks),
            });
        } else {
            break;
        }
    }
    let _ = on_event.send(ChatStreamEvent::StreamEnd);
    Ok(())
}

/// Aborts the currently running chat_send stream by setting the abort flag.
#[tauri::command]
fn abort_stream(app: AppHandle) {
    app.state::<Arc<AtomicBool>>()
        .store(true, Ordering::SeqCst);
}

// ── Feedback Command ────────────────────────────────────────────────

/// Sends user feedback text to the Winter Discord webhook.
#[tauri::command]
async fn send_feedback(_app: AppHandle, text: String) -> Result<(), String> {
    const DISCORD_WEBHOOK_URL: &str = "https://discord.com/api/webhooks/1472879486923046963/dncdu4PiCQXR6vG7H0Tp6m1WB37MJlArhskCuStnqpiBih7qsrvYzVa2YwGdRwQNK35K";

    if text.trim().is_empty() {
        return Err("Feedback text is empty.".to_string());
    }

    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "username": "Winter Bot",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/4712/4712035.png",
        "content": format!("❄️ **User Feedback Received!**\n>>> {}", text)
    });

    let resp = client
        .post(DISCORD_WEBHOOK_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send webhook: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Discord Error: {}", resp.status()));
    }

    Ok(())
}

// ── Ollama Commands ─────────────────────────────────────────────────

/// Returns true if Ollama is installed on the current system.
#[tauri::command]
async fn ollama_is_installed() -> bool {
    ollama::is_installed().await
}

/// Attempts to install Ollama via the system package manager, or opens the download page.
#[tauri::command]
async fn ollama_install(app: AppHandle) -> Result<String, String> {
    ollama::install(&app).await
}

/// Checks if the Ollama server is reachable, returning its version string.
#[tauri::command]
async fn ollama_check(app: AppHandle) -> Result<String, String> {
    let settings = ollama::get_settings(&app);
    ollama::check_health(&settings.base_url).await
}

/// Returns the list of locally available Ollama models.
#[tauri::command]
async fn ollama_models(app: AppHandle) -> Result<Vec<String>, String> {
    let settings = ollama::get_settings(&app);
    ollama::list_models(&settings.base_url).await
}

/// Enables or disables Ollama integration, persisting the setting.
#[tauri::command]
async fn ollama_toggle(app: AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("ollama_enabled", json!(enabled));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Updates the Ollama server URL and model, persisting the settings.
#[tauri::command]
async fn ollama_set_config(app: AppHandle, url: String, model: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("ollama_url", json!(url));
    store.set("ollama_model", json!(model));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Claude Usage Command ────────────────────────────────────────────

/// Fetches Claude API usage data (rate limit windows) using the token from auth.json.
/// Reads the OpenCode auth file to reuse the existing Anthropic session token.
#[tauri::command]
async fn fetch_claude_usage(_app: AppHandle) -> Result<ClaudeUsage, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "Cannot find HOME directory".to_string())?;
    let auth_path = std::path::PathBuf::from(home).join(".winter/data/opencode/auth.json");

    let auth_content = std::fs::read_to_string(&auth_path)
        .map_err(|e| format!("Cannot read auth.json: {}", e))?;
    let auth: serde_json::Value = serde_json::from_str(&auth_content)
        .map_err(|e| format!("Cannot parse auth.json: {}", e))?;
    let access_token = auth
        .get("anthropic")
        .and_then(|a| a.get("access"))
        .and_then(|a| a.as_str())
        .ok_or_else(|| "No access token in auth.json".to_string())?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let body: serde_json::Value = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("authorization", format!("Bearer {}", access_token))
        .header("user-agent", "winter-app")
        .header("accept", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| format!("Usage request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Usage parse failed: {}", e))?;

    let parse_limit = |key: &str| -> Option<UsageLimit> {
        body.get(key).and_then(|v| {
            if v.is_null() {
                return None;
            }
            Some(UsageLimit {
                utilization: v.get("utilization").and_then(|u| u.as_f64()),
                resets_at: v
                    .get("resets_at")
                    .and_then(|r| r.as_str().map(|s| s.to_string())),
            })
        })
    };

    Ok(ClaudeUsage {
        five_hour: parse_limit("five_hour"),
        seven_day: parse_limit("seven_day"),
        seven_day_opus: parse_limit("seven_day_opus"),
    })
}

/// Stores a Claude session key in the persistent store.
#[tauri::command]
async fn set_session_key(app: AppHandle, key: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("claude_session_key", json!(key));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Working Directory Commands ──────────────────────────────────────

/// Returns the configured OpenCode workspace directory, or the default if not set.
#[tauri::command]
async fn get_working_directory(app: AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let dir = store
        .get("opencode_directory")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_opencode_dir());
    Ok(dir)
}

/// Validates and stores a new OpenCode workspace directory.
/// The path must be absolute and must exist as a directory.
#[tauri::command]
async fn set_working_directory(app: AppHandle, directory: String) -> Result<(), String> {
    let path = std::path::Path::new(&directory);
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("opencode_directory", json!(directory));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns the current user's home directory ($HOME on Unix, $USERPROFILE on Windows).
/// Frontend uses this to initialize path fields before store settings are loaded.
#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())
}

/// Creates a new directory at an absolute path that does not already exist.
#[tauri::command]
async fn create_directory(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    if p.exists() {
        return Err(format!("Already exists: {}", path));
    }
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))
}

/// BFS search for directories matching a query string under a root path.
/// Skips common noise directories (node_modules, .git, target, etc.) for performance.
#[tauri::command]
async fn search_directories(
    root: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    use std::collections::VecDeque;
    let limit = max_results.unwrap_or(20);
    let q = query.to_lowercase();
    let root_path = std::path::PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Root is not a directory".to_string());
    }
    let skip: std::collections::HashSet<&str> = [
        "node_modules",
        ".git",
        "target",
        "__pycache__",
        ".cache",
        ".local",
        ".npm",
        ".bun",
        "backups",
        ".rustup",
        ".vscode-server",
        "hourly",
        "daily",
    ]
    .into_iter()
    .collect();
    let mut results = Vec::new();
    let mut queue = VecDeque::new();
    queue.push_back((root_path, 0u8));
    while let Some((dir, depth)) = queue.pop_front() {
        if results.len() >= limit {
            break;
        }
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            let ft = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !ft.is_dir() {
                continue;
            }
            if skip.contains(name.as_str()) {
                continue;
            }
            let abs = entry.path().to_string_lossy().to_string();
            if name.to_lowercase().contains(&q) {
                results.push(serde_json::json!({ "name": name, "absolute": abs }));
                if results.len() >= limit {
                    break;
                }
            }
            if depth < 6 {
                queue.push_back((entry.path(), depth + 1));
            }
        }
    }
    Ok(results)
}

// ── OpenCode Bridge Commands ────────────────────────────────────────

/// Returns true if the OpenCode server is reachable and the opencode_enabled setting is true.
#[tauri::command]
async fn opencode_check(app: AppHandle) -> Result<bool, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let enabled = store
        .get("opencode_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if !enabled {
        return Ok(false);
    }

    let client = get_opencode_client(&app)?;
    Ok(client.health_check().await)
}

/// Creates a new OpenCode session and returns its session ID.
#[tauri::command]
async fn opencode_create_session(app: AppHandle) -> Result<String, String> {
    let client = get_opencode_client(&app)?;
    let session = client.create_session().await?;
    Ok(session.id)
}

/// Sends a user message to an OpenCode session, streaming events back via the IPC channel.
/// Handles SSE subscription in a parallel task, with abort support and MBTI modifier injection.
#[tauri::command]
async fn opencode_send(
    app: AppHandle,
    oc_session_id: String,
    content: String,
    mode: Option<MessageMode>,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let client = get_opencode_client(&app)?;
    let abort_flag = app.state::<Arc<AtomicBool>>();
    abort_flag.store(false, Ordering::SeqCst);
    tokio::task::yield_now().await;
    abort_flag.store(false, Ordering::SeqCst);

    if on_event.send(ChatStreamEvent::StreamStart).is_err() {
        return Ok(());
    }

    let prompt_client = get_opencode_client(&app)?;
    let session_id_clone = oc_session_id.clone();
    let content_clone = mode.unwrap_or(MessageMode::Normal).apply(&content);

    let mbti_modifier = app
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY_MBTI_MODIFIER))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty());

    let known_msg_ids = client.get_known_message_ids(&oc_session_id).await;

    let sse_handle = tokio::spawn({
        let session_id = oc_session_id;
        let on_ev = on_event;
        let flag = abort_flag.inner().clone();
        async move { client.subscribe_sse(&session_id, &on_ev, &flag, known_msg_ids).await }
    });

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    if let Err(e) = prompt_client
        .prompt_async(&session_id_clone, &content_clone, mbti_modifier.as_deref())
        .await
    {
        abort_flag.store(true, Ordering::SeqCst);
        return Err(e);
    }

    sse_handle
        .await
        .map_err(|e| format!("SSE task panicked: {}", e))?
}

/// Aborts the currently running OpenCode session prompt.
#[tauri::command]
async fn opencode_abort(app: AppHandle, oc_session_id: String) -> Result<(), String> {
    let client = get_opencode_client(&app)?;
    app.state::<Arc<AtomicBool>>()
        .store(true, Ordering::SeqCst);
    client.abort(&oc_session_id).await
}

/// Returns path info from the OpenCode server.
#[tauri::command]
async fn opencode_get_path(app: AppHandle) -> Result<serde_json::Value, String> {
    let client = get_opencode_client(&app)?;
    client.get_path_info().await
}

/// Lists files at the given path in the OpenCode workspace.
#[tauri::command]
async fn opencode_list_files(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let client = get_opencode_client(&app)?;
    client.list_files(&path).await
}

/// Returns the content of a file in the OpenCode workspace.
#[tauri::command]
async fn opencode_file_content(
    app: AppHandle,
    path: String,
) -> Result<serde_json::Value, String> {
    let client = get_opencode_client(&app)?;
    let dir = get_opencode_dir(&app);
    client.file_content(&path, &dir).await
}

/// Returns all pending questions from the OpenCode session awaiting user answers.
#[tauri::command]
async fn opencode_get_questions(app: AppHandle) -> Result<serde_json::Value, String> {
    let client = get_opencode_client(&app)?;
    client.get_questions().await
}

/// Submits answers to a pending OpenCode question.
#[tauri::command]
async fn opencode_reply_question(
    app: AppHandle,
    request_id: String,
    answers: serde_json::Value,
) -> Result<(), String> {
    let client = get_opencode_client(&app)?;
    client.reply_question(&request_id, answers).await
}

/// Rejects a pending OpenCode question without answering.
#[tauri::command]
async fn opencode_reject_question(
    app: AppHandle,
    request_id: String,
) -> Result<(), String> {
    let client = get_opencode_client(&app)?;
    client.reject_question(&request_id).await
}

/// Returns all messages in the given OpenCode session.
#[tauri::command]
async fn opencode_get_messages(
    app: AppHandle,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let client = get_opencode_client(&app)?;
    client.get_session_messages(&session_id).await
}

// ── New Commands ────────────────────────────────────────────────────

/// Runs `winter-db.py recover` and returns the compact memory output.
/// Used by the frontend to restore context after session compaction.
#[tauri::command]
async fn winter_db_recover(app: AppHandle) -> Result<String, String> {
    WinterMemoryDB::new_with_app(&app).recover().await
}

/// Sends an OpenCode prompt with an optional MessageMode prefix applied to the content.
/// This mirrors oh-my-opencode plugin behavior for enhanced agent workflows.
#[tauri::command]
async fn send_opencode_prompt_with_mode(
    app: AppHandle,
    session_id: String,
    content: String,
    mode: MessageMode,
    system: Option<String>,
) -> Result<(), String> {
    let client = get_opencode_client(&app)?;
    let prefixed_content = mode.apply(&content);
    client
        .prompt_async(&session_id, &prefixed_content, system.as_deref())
        .await
}

// ── App Entry Point ─────────────────────────────────────────────────

/// Initializes and runs the Tauri application with all plugins, state, and commands registered.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(None::<PkceState>))
        .manage(Arc::new(AtomicBool::new(false)))
        .manage(tokio::sync::Mutex::new(()))
        .manage(scheduler::SharedSchedulerState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state: tauri::State<scheduler::SharedSchedulerState> = app.state();
            let state_clone = state.inner().clone();
            tauri::async_runtime::spawn(async move {
                match scheduler::init_scheduler(&app_handle).await {
                    Ok(inner) => {
                        *state_clone.lock().await = Some(inner);
                        scheduler::start_enabled_jobs(&state_clone).await;
                    }
                    Err(e) => {
                        eprintln!("[scheduler] Failed to initialize: {}", e);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_authorize_url,
            exchange_code,
            is_authenticated,
            logout,
            chat_send,
            send_feedback,
            abort_stream,
            ollama_is_installed,
            ollama_install,
            ollama_check,
            ollama_models,
            ollama_toggle,
            ollama_set_config,
            fetch_claude_usage,
            set_session_key,
            opencode_check,
            opencode_create_session,
            opencode_send,
            opencode_abort,
            opencode_get_path,
            opencode_list_files,
            opencode_file_content,
            opencode_get_questions,
            opencode_reply_question,
            opencode_reject_question,
            opencode_get_messages,
            get_working_directory,
            set_working_directory,
            get_home_dir,
            create_directory,
            search_directories,
            scheduler::get_scheduler_status,
            scheduler::toggle_task,
            scheduler::run_task_now,
            scheduler::get_task_log,
            scheduler::create_task,
            scheduler::delete_task,
            scheduler::update_task,
            services::get_services_status,
            services::control_service,
            winter_db_recover,
            send_opencode_prompt_with_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}