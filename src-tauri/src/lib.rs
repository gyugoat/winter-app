mod ollama;

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const STORE_KEY_ACCESS: &str = "oauth_access_token";
const STORE_KEY_REFRESH: &str = "oauth_refresh_token";
const STORE_KEY_EXPIRES: &str = "oauth_expires";

const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages?beta=true";
const TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI: &str = "https://console.anthropic.com/oauth/code/callback";
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MODEL: &str = "claude-opus-4-20250514";
const STORE_KEY_MODEL: &str = "claude_model";
const DEFAULT_MAX_TOKENS: u32 = 16384;
const MAX_TOOL_ROUNDS: usize = 25;

const BASE_SYSTEM_PROMPT: &str = "\
You are Winter. Not Claude, not an AI assistant — Winter. \
You speak Korean and English naturally, switching between them based on context. \
You're direct, no-bullshit, slightly sarcastic but never mean. \
You don't do corporate AI speak. No \"I'd be happy to help!\" No \"Great question!\" \
Never say \"I can't do X\" with a long disclaimer — just say what you CAN do or give the answer. \
Keep responses short unless the user clearly wants detail. \
You have tools available: you can run shell commands, read/write files, and list directories. \
Use them when the user asks you to do something on their computer. \
You have personality. You're not a search engine. You're Winter.\n\n\
HARD RULES — VIOLATION = BROKEN:\n\
- NEVER write summaries of the conversation. No \"Session Summary\", no \"As-Is\", no \"Context Summary\".\n\
- NEVER list what the user previously asked. They remember. You remember. Move forward.\n\
- NEVER re-output content you already read from files or prior messages.\n\
- If the user asks \"what did we do?\" — answer in 2-3 bullet points max: what's done, what remains.\n\
- Every output token costs money. Be concise. No narration. No filler. Results only.";

const STORE_KEY_MBTI_MODIFIER: &str = "mbti_prompt_modifier";

fn get_model(app: &AppHandle) -> String {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY_MODEL))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

fn build_system_prompt(app: &AppHandle) -> String {
    let modifier = app
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY_MBTI_MODIFIER))
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    match modifier {
        Some(m) if !m.is_empty() => format!("{}\n\n{}", BASE_SYSTEM_PROMPT, m),
        _ => BASE_SYSTEM_PROMPT.to_string(),
    }
}

// ── Types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { source: ImageSource },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum ChatStreamEvent {
    #[serde(rename = "stream_start")]
    StreamStart,
    #[serde(rename = "delta")]
    Delta { text: String },
    #[serde(rename = "tool_start")]
    ToolStart { name: String, id: String },
    #[serde(rename = "tool_end")]
    ToolEnd { id: String, result: String },
    #[serde(rename = "stream_end")]
    StreamEnd,
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "ollama_status")]
    OllamaStatus { status: String },
    #[serde(rename = "usage")]
    Usage {
        input_tokens: u64,
        output_tokens: u64,
    },
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "shell_exec",
            "description": "Execute a shell command and return stdout/stderr. Use bash on Linux/Mac.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" }
                },
                "required": ["command"]
            }
        },
        {
            "name": "file_read",
            "description": "Read the contents of a file at the given path.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute or relative file path" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "file_write",
            "description": "Write content to a file, creating it if it doesn't exist.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path to write to" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }
        },
        {
            "name": "file_list",
            "description": "List files and directories at the given path.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path to list" }
                },
                "required": ["path"]
            }
        }
    ])
}

// ── Tool Execution ─────────────────────────────────────────────────

async fn execute_tool(name: &str, input: &Value) -> (String, bool) {
    match name {
        "shell_exec" => {
            let cmd = input["command"].as_str().unwrap_or("");
            const TIMEOUT: Duration = Duration::from_secs(120);
            const MAX_OUTPUT: usize = 512 * 1024;

            // Block destructive patterns
            let blocked = ["rm -rf /", "rm -rf ~", "mkfs.", "dd if=", ":(){", "fork bomb",
                           "> /dev/sd", "chmod -R 777 /", "curl|bash", "wget|bash", "curl|sh", "wget|sh"];
            let cmd_lower = cmd.to_lowercase();
            for pattern in &blocked {
                if cmd_lower.contains(pattern) {
                    return (format!("Blocked: dangerous command pattern '{}' detected", pattern), true);
                }
            }

            let child = tokio::process::Command::new("bash")
                .arg("-c")
                .arg(cmd)
                .kill_on_drop(true)
                .output();

            match tokio::time::timeout(TIMEOUT, child).await {
                Ok(Ok(output)) => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let mut result = String::new();
                    if !stdout.is_empty() { result.push_str(&stdout); }
                    if !stderr.is_empty() {
                        if !result.is_empty() { result.push('\n'); }
                        result.push_str("[stderr] ");
                        result.push_str(&stderr);
                    }
                    if result.is_empty() {
                        result = format!("(exit code {})", output.status.code().unwrap_or(-1));
                    }
                    if result.len() > MAX_OUTPUT {
                        result.truncate(MAX_OUTPUT);
                        result.push_str("\n...[truncated at 512KB]");
                    }
                    (result, !output.status.success())
                }
                Ok(Err(e)) => (format!("Failed to execute: {}", e), true),
                Err(_) => ("Command timed out after 120s".to_string(), true),
            }
        }
        "file_read" => {
            let path = input["path"].as_str().unwrap_or("");
            match tokio::fs::read_to_string(path).await {
                Ok(content) => (content, false),
                Err(e) => (format!("Error reading {}: {}", path, e), true),
            }
        }
        "file_write" => {
            let path = input["path"].as_str().unwrap_or("");
            let content = input["content"].as_str().unwrap_or("");
            if let Some(parent) = std::path::Path::new(path).parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            match tokio::fs::write(path, content).await {
                Ok(()) => (format!("Written to {}", path), false),
                Err(e) => (format!("Error writing {}: {}", path, e), true),
            }
        }
        "file_list" => {
            let path = input["path"].as_str().unwrap_or(".");
            match tokio::fs::read_dir(path).await {
                Ok(mut entries) => {
                    let mut items = Vec::new();
                    while let Ok(Some(entry)) = entries.next_entry().await {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let is_dir = entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false);
                        items.push(if is_dir { format!("{}/", name) } else { name });
                    }
                    items.sort();
                    (items.join("\n"), false)
                }
                Err(e) => (format!("Error listing {}: {}", path, e), true),
            }
        }
        _ => (format!("Unknown tool: {}", name), true),
    }
}

// ── SSE Streaming Helpers ──────────────────────────────────────────

#[derive(Debug)]
struct StreamedResponse {
    text_content: String,
    tool_uses: Vec<(String, String, String)>,
    stop_reason: String,
}

// src-tauri/src/lib.rs 안에서 stream_response 함수 찾아서 교체

async fn stream_response(
    client: &Client,
    access_token: &str,
    messages: &[ChatMessage],
    on_event: &Channel<ChatStreamEvent>,
    system_prompt: &str,
    abort_flag: &AtomicBool,
    model: &str,
) -> Result<StreamedResponse, String> {
    let body = json!({
        "model": model,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "messages": messages,
        "stream": true,
        "system": system_prompt,
        "tools": tool_definitions(),
    });

    let response = client
        .post(CLAUDE_API_URL)
        .header("authorization", format!("Bearer {}", access_token))
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("user-agent", "winter-app/1.0.0")
        .header("x-app", "cli")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        if status.as_u16() == 401 { return Err("AUTH_EXPIRED".to_string()); }
        let body = response.text().await.unwrap_or_default(); // 여기서 response 소모됨
        return Err(format!("Claude API error {}: {}", status, body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut text_content = String::new();
    let mut tool_uses: Vec<(String, String, String)> = Vec::new();
    let mut current_block_type = String::new();
    let mut current_tool_id = String::new();
    let mut current_tool_name = String::new();
    let mut current_tool_input_json = String::new();
    let mut stop_reason = String::new();
    let mut input_tokens: u64 = 0;
    #[allow(unused_assignments)]
    let mut output_tokens: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if abort_flag.load(Ordering::SeqCst) {
            return Ok(StreamedResponse { text_content, tool_uses: Vec::new(), stop_reason: "aborted".to_string() });
        }
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find("\n\n") {
            let event_block = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            let mut event_type = String::new();
            let mut data = String::new();

            for line in event_block.lines() {
                if let Some(et) = line.strip_prefix("event: ") { event_type = et.to_string(); }
                else if let Some(d) = line.strip_prefix("data: ") { data = d.to_string(); }
            }

            match event_type.as_str() {
                "message_start" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        if let Some(t) = p["message"]["usage"]["input_tokens"].as_u64() { input_tokens += t; }
                    }
                }
                "content_block_start" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        current_block_type = p["content_block"]["type"].as_str().unwrap_or("").to_string();
                        if current_block_type == "tool_use" {
                            current_tool_id = p["content_block"]["id"].as_str().unwrap_or("").to_string();
                            current_tool_name = p["content_block"]["name"].as_str().unwrap_or("").to_string();
                            current_tool_input_json.clear();
                            let _ = on_event.send(ChatStreamEvent::ToolStart { name: current_tool_name.clone(), id: current_tool_id.clone() });
                        }
                    }
                }
                "content_block_delta" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        let dt = p["delta"]["type"].as_str().unwrap_or("");
                        if dt == "text_delta" {
                            if let Some(t) = p["delta"]["text"].as_str() {
                                text_content.push_str(t);
                                let _ = on_event.send(ChatStreamEvent::Delta { text: t.to_string() });
                            }
                        } else if dt == "input_json_delta" {
                            if let Some(j) = p["delta"]["partial_json"].as_str() {
                                current_tool_input_json.push_str(j);
                            }
                        }
                    }
                }
                "content_block_stop" => {
                    if current_block_type == "tool_use" {
                        tool_uses.push((current_tool_id.clone(), current_tool_name.clone(), current_tool_input_json.clone()));
                    }
                    current_block_type.clear();
                }
                "message_delta" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        if let Some(sr) = p["delta"]["stop_reason"].as_str() { stop_reason = sr.to_string(); }
                        if let Some(t) = p["usage"]["output_tokens"].as_u64() {
                            output_tokens = t;
                            let _ = on_event.send(ChatStreamEvent::Usage { input_tokens, output_tokens });
                        }
                    }
                }
                "error" => { let _ = on_event.send(ChatStreamEvent::Error { message: data.clone() }); }
                _ => {}
            }
        }
    }
    Ok(StreamedResponse { text_content, tool_uses, stop_reason })
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

struct PkceState {
    verifier: String,
    #[allow(dead_code)]
    created: u64,
}

// ── OAuth PKCE Commands ────────────────────────────────────────────

fn generate_pkce() -> (String, String) {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    //수정된 부분: 괄호 앞의 '&'를 제거. github Clippy issue ㅅㅂ
    let verifier = URL_SAFE_NO_PAD.encode((0..32).map(|_| rand::random::<u8>()).collect::<Vec<u8>>());
    
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    (verifier, challenge)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

#[tauri::command]
fn get_authorize_url(app: AppHandle) -> Result<String, String> {
    let (verifier, challenge) = generate_pkce();
    let query = [
        ("code", "true"), ("client_id", CLIENT_ID), ("response_type", "code"),
        ("redirect_uri", REDIRECT_URI), ("scope", "org:create_api_key user:profile user:inference"),
        ("code_challenge", challenge.as_str()), ("code_challenge_method", "S256"), ("state", verifier.as_str()),
    ].iter().map(|(k, v)| format!("{}={}", k, urlencoding::encode(v))).collect::<Vec<_>>().join("&");

    *app.state::<Mutex<Option<PkceState>>>().lock().unwrap_or_else(|e| e.into_inner()) = Some(PkceState { verifier, created: now_millis() });
    Ok(format!("https://claude.ai/oauth/authorize?{}", query))
}

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
        "code": parts[0], "state": if parts.len() > 1 { parts[1] } else { "" },
        "grant_type": "authorization_code", "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "code_verifier": verifier,
    });

    let client = Client::new();
    let resp = client.post(TOKEN_URL).header("content-type", "application/json").json(&payload).send().await.map_err(|e| format!("{}", e))?;
    if !resp.status().is_success() { return Err(format!("Token exchange failed: {}", resp.status())); }
    let tokens: TokenResponse = resp.json().await.map_err(|e| format!("{}", e))?;

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_ACCESS, json!(tokens.access_token));
    store.set(STORE_KEY_REFRESH, json!(tokens.refresh_token));
    store.set(STORE_KEY_EXPIRES, json!(now_millis() + tokens.expires_in * 1000));
    store.save().map_err(|e| e.to_string())?;
    *app.state::<Mutex<Option<PkceState>>>().lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

#[tauri::command]
async fn is_authenticated(app: AppHandle) -> Result<bool, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let access_token = store.get(STORE_KEY_ACCESS);
    
    // 값이 있고(Option), 문자열이며, 비어있지 않으면 true
    let is_valid = access_token
        .and_then(|v| v.as_str().map(|s| !s.is_empty()))
        .unwrap_or(false);
        
    Ok(is_valid)
}

#[tauri::command]
async fn logout(app: AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(STORE_KEY_ACCESS);
    store.delete(STORE_KEY_REFRESH);
    store.delete(STORE_KEY_EXPIRES);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn get_access_token(app: &AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let expires = store.get(STORE_KEY_EXPIRES).and_then(|v| v.as_u64()).unwrap_or(0);
    if now_millis() > expires {
        return Err("AUTH_EXPIRED".to_string());
    }
    store.get(STORE_KEY_ACCESS).and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "Not authenticated.".to_string())
}

async fn refresh_access_token(app: &AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let refresh_token = store.get(STORE_KEY_REFRESH).and_then(|v| v.as_str().map(|s| s.to_string())).ok_or_else(|| "No refresh token.".to_string())?;
    
    let payload = json!({ "grant_type": "refresh_token", "client_id": CLIENT_ID, "refresh_token": refresh_token });
    let resp = Client::new().post(TOKEN_URL).header("content-type", "application/json").json(&payload).send().await.map_err(|e| format!("{}", e))?;
    
    if !resp.status().is_success() { return Err(format!("Refresh failed: {}", resp.status())); }
    let tokens: TokenResponse = resp.json().await.map_err(|e| format!("{}", e))?;
    
    store.set(STORE_KEY_ACCESS, json!(tokens.access_token));
    store.set(STORE_KEY_REFRESH, json!(tokens.refresh_token));
    store.set(STORE_KEY_EXPIRES, json!(now_millis() + tokens.expires_in * 1000));
    store.save().map_err(|e| e.to_string())?;
    Ok(tokens.access_token)
}

// ── Feedback Email ─────────────────────────────────────────────────

#[tauri::command]
async fn send_feedback(_app: AppHandle, text: String) -> Result<(), String> {
    const DISCORD_WEBHOOK_URL: &str = env!("DISCORD_WEBHOOK_URL");

    if text.trim().is_empty() {
        return Err("Feedback text is empty.".to_string());
    }
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "username": "Winter Bot",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/4712/4712035.png",
        "content": format!("❄️ **User Feedback Received!**\n>>> {}", text)
    });

    let resp = client.post(DISCORD_WEBHOOK_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send webhook: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Discord Error: {}", resp.status()));
    }

    Ok(())
}

// ── Ollama Commands ────────────────────────────────────────────────

#[tauri::command]
async fn ollama_is_installed() -> bool { ollama::is_installed().await }

#[tauri::command]
async fn ollama_install(app: AppHandle) -> Result<String, String> { 
    ollama::install(&app).await 
}

#[tauri::command]
async fn ollama_check(app: AppHandle) -> Result<String, String> {
    let settings = ollama::get_settings(&app);
    ollama::check_health(&settings.base_url).await
}

#[tauri::command]
async fn ollama_models(app: AppHandle) -> Result<Vec<String>, String> {
    let settings = ollama::get_settings(&app);
    ollama::list_models(&settings.base_url).await
}

#[tauri::command]
async fn ollama_toggle(app: AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("ollama_enabled", json!(enabled));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn ollama_set_config(app: AppHandle, url: String, model: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("ollama_url", json!(url));
    store.set("ollama_model", json!(model));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Claude Usage API ────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct UsageLimit {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

#[derive(Serialize, Clone)]
struct ClaudeUsage {
    five_hour: Option<UsageLimit>,
    seven_day: Option<UsageLimit>,
    seven_day_opus: Option<UsageLimit>,
}

#[tauri::command]
async fn fetch_claude_usage(app: AppHandle) -> Result<ClaudeUsage, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let session_key = store.get("claude_session_key")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "No session key. Set it in Settings → Token → Connect.".to_string())?;

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    #[derive(Deserialize)]
    struct Org { uuid: String }

    let orgs: Vec<Org> = client
        .get("https://claude.ai/api/organizations")
        .header("cookie", format!("sessionKey={}", session_key))
        .header("accept", "application/json")
        .send().await.map_err(|e| format!("Orgs request failed: {}", e))?
        .json().await.map_err(|e| format!("Orgs parse failed: {}", e))?;

    let org_id = orgs.first().map(|o| o.uuid.clone())
        .ok_or_else(|| "No organization found.".to_string())?;

    let usage_url = format!("https://claude.ai/api/organizations/{}/usage", org_id);
    let body: Value = client
        .get(&usage_url)
        .header("cookie", format!("sessionKey={}", session_key))
        .header("accept", "application/json")
        .send().await.map_err(|e| format!("Usage request failed: {}", e))?
        .json().await.map_err(|e| format!("Usage parse failed: {}", e))?;

    let parse_limit = |key: &str| -> Option<UsageLimit> {
        body.get(key).map(|v| UsageLimit {
            utilization: v.get("utilization").and_then(|u| u.as_f64()),
            resets_at: v.get("resets_at").and_then(|r| r.as_str().map(|s| s.to_string())),
        })
    };

    Ok(ClaudeUsage {
        five_hour: parse_limit("five_hour"),
        seven_day: parse_limit("seven_day"),
        seven_day_opus: parse_limit("seven_day_opus"),
    })
}

#[tauri::command]
async fn set_session_key(app: AppHandle, key: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set("claude_session_key", json!(key));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Chat Streaming Command ────────────────────────────────────────

#[tauri::command]
fn abort_stream(app: AppHandle) {
    app.state::<Arc<AtomicBool>>().store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn chat_send(app: AppHandle, messages: Vec<ChatMessage>, on_event: Channel<ChatStreamEvent>) -> Result<(), String> {
    let mut access_token = get_access_token(&app)?;
    let client = Client::new();
    let abort_flag = app.state::<Arc<AtomicBool>>();
    abort_flag.store(false, Ordering::SeqCst);
    tokio::task::yield_now().await;
    abort_flag.store(false, Ordering::SeqCst);
    if on_event.send(ChatStreamEvent::StreamStart).is_err() { return Ok(()); }

    let system_prompt = build_system_prompt(&app);
    let model = get_model(&app);
    let mut conversation = messages;
    let ollama_settings = ollama::get_settings(&app);

    if ollama_settings.enabled && conversation.len() > 10 {
        let _ = on_event.send(ChatStreamEvent::OllamaStatus { status: "compressing".to_string() });
        if let Ok(compressed) = ollama::compress_history(&ollama_settings.base_url, &ollama_settings.model, &conversation).await {
            conversation = compressed;
        }
        let _ = on_event.send(ChatStreamEvent::OllamaStatus { status: "done".to_string() });
    }

    for round in 0..MAX_TOOL_ROUNDS {
        if abort_flag.load(Ordering::SeqCst) { break; }
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
        let result = match stream_response(&client, &access_token, &conversation, &on_event, &system_prompt, &abort_flag, &model).await {
            Ok(r) => r,
            Err(e) if e == "AUTH_EXPIRED" => {
                let mutex = app.state::<tokio::sync::Mutex<()>>();
                let _guard = mutex.lock().await;
                access_token = refresh_access_token(&app).await?;
                drop(_guard);
                stream_response(&client, &access_token, &conversation, &on_event, &system_prompt, &abort_flag, &model).await?
            }
            Err(e) => return Err(e),
        };

        if result.stop_reason == "aborted" { break; }
        if result.stop_reason == "tool_use" && !result.tool_uses.is_empty() {
            let mut assistant_blocks = Vec::new();
            if !result.text_content.is_empty() { assistant_blocks.push(ContentBlock::Text { text: result.text_content }); }
            for (id, name, input_json) in &result.tool_uses {
                let input: Value = serde_json::from_str(input_json).unwrap_or(json!({}));
                assistant_blocks.push(ContentBlock::ToolUse { id: id.clone(), name: name.clone(), input });
            }
            conversation.push(ChatMessage { role: "assistant".to_string(), content: MessageContent::Blocks(assistant_blocks) });

            let mut tool_result_blocks = Vec::new();
            for (id, name, input_json) in &result.tool_uses {
                let input: Value = serde_json::from_str(input_json).unwrap_or(json!({}));
                let (raw_output, is_error) = execute_tool(name, &input).await;
                
                let output = if ollama_settings.enabled && !is_error && raw_output.len() > 3000 {
                    let _ = on_event.send(ChatStreamEvent::OllamaStatus { status: "summarizing".to_string() });
                    match ollama::summarize(&ollama_settings.base_url, &ollama_settings.model, &raw_output).await {
                        Ok(s) => format!("[Summarized]\n{}", s), Err(_) => raw_output
                    }
                } else { raw_output };
                
                let _ = on_event.send(ChatStreamEvent::ToolEnd { id: id.clone(), result: output.clone() });
                tool_result_blocks.push(ContentBlock::ToolResult { tool_use_id: id.clone(), content: output, is_error: if is_error { Some(true) } else { None } });
            }
            conversation.push(ChatMessage { role: "user".to_string(), content: MessageContent::Blocks(tool_result_blocks) });
        } else { break; }
    }
    let _ = on_event.send(ChatStreamEvent::StreamEnd);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(None::<PkceState>))
        .manage(Arc::new(AtomicBool::new(false)))
        .manage(tokio::sync::Mutex::new(()))
        .invoke_handler(tauri::generate_handler![
            get_authorize_url, exchange_code, is_authenticated, logout, chat_send,
            send_feedback, abort_stream, ollama_is_installed, ollama_install,
            ollama_check, ollama_models, ollama_toggle, ollama_set_config,
            fetch_claude_usage, set_session_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}