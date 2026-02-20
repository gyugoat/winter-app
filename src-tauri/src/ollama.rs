//! Ollama local-LLM integration for Winter App.
//!
//! Handles Ollama installation detection, server health checks, model listing,
//! and conversation-history compression.
//!
//! **Note:** As of the current release, Claude Haiku handles context compression
//! by default (see `compaction.rs`). Ollama remains available as an optional
//! alternative for users who prefer fully local inference.

use crate::claude::types::{ChatMessage, ContentBlock, MessageContent};
use crate::STORE_FILE;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use std::process::Command; 
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tauri_plugin_opener::OpenerExt;

/// Default Ollama server base URL (no trailing slash).
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

/// HTTP timeout for all Ollama API calls.
const OLLAMA_TIMEOUT: Duration = Duration::from_secs(30);

/// Minimum text length (bytes) to bother summarising; shorter content is returned as-is.
const MIN_SUMMARIZE_LEN: usize = 500;

/// Minimum number of messages in history before compression is attempted.
const HISTORY_COMPRESS_THRESHOLD: usize = 10;

/// Selects a default Ollama model based on available system RAM.
///
/// Allocates up to 25 % of free memory to the model:
/// - ≤ 2 GB → `qwen2.5:3b`
/// - 3–4 GB → `qwen2.5:7b`
/// - ≥ 5 GB → `qwen2.5:14b`
fn default_model_for_system() -> String {
    let sys = sysinfo::System::new_all();
    let avail_gb = sys.available_memory() / (1024 * 1024 * 1024);
    let budget_gb = avail_gb / 4;
    match budget_gb {
        0..=2 => "qwen2.5:3b",
        3..=4 => "qwen2.5:7b",
        _ => "qwen2.5:14b",
    }.to_string()
}

/// Runtime settings for the Ollama integration, read from the persistent store.
pub struct OllamaSettings {
    /// Whether Ollama-based compression is enabled by the user.
    pub enabled: bool,
    /// Base URL of the Ollama server (e.g. `"http://localhost:11434"`).
    pub base_url: String,
    /// Ollama model name to use for summarisation (e.g. `"qwen2.5:7b"`).
    pub model: String,
}

// ── Settings ───────────────────────────────────────────────────────

/// Loads Ollama settings from the Tauri persistent store.
///
/// Falls back to sensible defaults (disabled, localhost, RAM-appropriate model)
/// if the store is unavailable or keys are missing.
pub fn get_settings(app: &AppHandle) -> OllamaSettings {
    let store = match app.store(STORE_FILE) {
        Ok(s) => s,
        Err(_) => {
            return OllamaSettings {
                enabled: false,
                base_url: DEFAULT_OLLAMA_URL.to_string(),
                model: default_model_for_system(),
            };
        }
    };

    let enabled = store
        .get("ollama_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let base_url = store
        .get("ollama_url")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string());

    let model = store
        .get("ollama_model")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(default_model_for_system);

    OllamaSettings {
        enabled,
        base_url,
        model,
    }
}

// ── Installation ───────────────────────────────────────────────────

/// Checks whether the `ollama` binary is present on the current system.
///
/// On Windows, probes `where ollama` via cmd and common install paths under `%LOCALAPPDATA%`.
/// On macOS, uses `which ollama` and checks the `.app` bundle path.
/// On Linux, uses `which ollama`.
pub async fn is_installed() -> bool {
    if cfg!(target_os = "windows") {
        // `where`는 cmd.exe 내장 명령이라 직접 실행 불가 → cmd /C로 감싸야 함
        let found_in_path = Command::new("cmd")
            .args(["/C", "where", "ollama"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if found_in_path { return true; }

        // PATH에 없을 수 있으므로 일반적인 설치 경로 직접 체크
        let home = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let common_paths = [
            format!("{}\\Programs\\Ollama\\ollama.exe", home),
            format!("{}\\Ollama\\ollama.exe", home),
            "C:\\Program Files\\Ollama\\ollama.exe".to_string(),
            "C:\\Program Files (x86)\\Ollama\\ollama.exe".to_string(),
        ];
        common_paths.iter().any(|p| std::path::Path::new(p).exists())
    } else if cfg!(target_os = "macos") {
        // which 먼저, 실패하면 .app 번들 경로 체크
        let found_in_path = Command::new("which")
            .arg("ollama")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if found_in_path { return true; }

        let app_paths = [
            "/Applications/Ollama.app/Contents/Resources/ollama",
            "/usr/local/bin/ollama",
        ];
        app_paths.iter().any(|p| std::path::Path::new(p).exists())
    } else {
        // Linux: which로 충분
        Command::new("which")
            .arg("ollama")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Attempts to install Ollama using the platform's preferred package manager.
///
/// - **Windows**: tries `winget install Ollama.Ollama`, then opens the download page.
/// - **macOS**: tries `brew install ollama`, then opens the download page.
/// - **Linux**: opens the download page directly (no silent install).
///
/// Returns a human-readable status string on success.
pub async fn install(app: &AppHandle) -> Result<String, String> {
    if cfg!(target_os = "windows") {
        // [Windows] winget 시도
        let output = tokio::process::Command::new("winget")
            .args(["install", "Ollama.Ollama"])
            .output()
            .await;

        match output {
            Ok(o) if o.status.success() => {
                Ok("Ollama installed via winget! Please restart the app.".to_string())
            }
            _ => {
                let _ = app.opener().open_url("https://ollama.com/download/windows", None::<&str>);
                Ok("Winget failed. Opened download page in browser.".to_string())
            }
        }
    } else if cfg!(target_os = "macos") {
        // [macOS] brew 시도
        let brew_check = tokio::process::Command::new("which")
            .arg("brew")
            .output()
            .await;

        if let Ok(o) = brew_check {
            if o.status.success() {
                let install_cmd = tokio::process::Command::new("brew")
                    .args(["install", "ollama"])
                    .output()
                    .await;
                
                match install_cmd {
                    Ok(out) if out.status.success() => {
                        return Ok("Ollama installed via Homebrew! Please restart.".to_string());
                    }
                    _ => { println!("Brew install failed."); }
                }
            }
        }
        let _ = app.opener().open_url("https://ollama.com/download/mac", None::<&str>);
        Ok("Homebrew not found or failed. Opened download page.".to_string())
    } else {
        // [Linux]
        let _ = app.opener().open_url("https://ollama.com/download/linux", None::<&str>);
        Ok("Opened download page for Linux.".to_string())
    }
}

// ── API Helpers ────────────────────────────────────────────────────

/// Builds a reusable `reqwest::Client` with [`OLLAMA_TIMEOUT`] applied.
fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(OLLAMA_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Checks if the Ollama server at `base_url` is reachable by hitting `/api/version`.
///
/// Returns the server's version string (e.g. `"0.3.14"`) on success.
pub async fn check_health(base_url: &str) -> Result<String, String> {
    let client = build_client()?;
    let url = format!("{}/api/version", base_url);

    #[derive(Deserialize)]
    struct VersionResp { version: String }

    let resp = client.get(&url).send().await.map_err(|e| format!("Ollama unreachable: {}", e))?;
    let data: VersionResp = resp.json().await.map_err(|e| format!("Invalid version: {}", e))?;
    Ok(data.version)
}

/// Returns the names of all locally available Ollama models via `/api/tags`.
pub async fn list_models(base_url: &str) -> Result<Vec<String>, String> {
    let client = build_client()?;
    let url = format!("{}/api/tags", base_url);

    #[derive(Deserialize)] struct Model { name: String }
    #[derive(Deserialize)] struct ModelsResp { models: Vec<Model> }

    let resp = client.get(&url).send().await.map_err(|e| format!("List failed: {}", e))?;
    let data: ModelsResp = resp.json().await.map_err(|e| format!("Invalid models: {}", e))?;
    Ok(data.models.into_iter().map(|m| m.name).collect())
}

/// Summarises `text` using the Ollama `/api/generate` endpoint.
///
/// Texts shorter than [`MIN_SUMMARIZE_LEN`] are returned unchanged.
/// The prompt instructs the model to emit only decisions, actions, and remaining
/// work — suppressing the "User asked X, then Y" pattern.
pub async fn summarize(base_url: &str, model: &str, text: &str) -> Result<String, String> {
    if text.len() < MIN_SUMMARIZE_LEN { return Ok(text.to_string()); }

    let client = build_client()?;
    let url = format!("{}/api/generate", base_url);
    let prompt = format!("Extract ONLY the key facts and decisions from this conversation. \
Do NOT list user requests. Do NOT write \"User asked X, then Y\". \
Output format: what was decided, what was done, what remains. Nothing else.\n\n{}", text);

    let body = json!({
        "model": model, "prompt": prompt, "stream": false,
        "options": { "temperature": 0.3, "num_predict": 512 }
    });

    #[derive(Deserialize)] struct GenResp { response: String }
    let resp = client.post(&url).json(&body).send().await.map_err(|e| format!("Gen failed: {}", e))?;
    
    if !resp.status().is_success() {
        return Err(format!("Ollama error: {}", resp.status()));
    }
    let data: GenResp = resp.json().await.map_err(|e| format!("Invalid json: {}", e))?;
    Ok(data.response.trim().to_string())
}

/// Sentinel prefix written at the start of a compressed-history message.
const PRIOR_CONTEXT_PREFIX: &str = "[Prior context —";

/// Compresses old chat history into a rolling summary using Ollama.
///
/// If the message list is shorter than [`HISTORY_COMPRESS_THRESHOLD`], it is
/// returned unchanged. Otherwise, the oldest messages (excluding the most recent
/// `keep` turns) are summarised and replaced with a single `[Prior context — N
/// messages compressed]` user/assistant pair. Existing summaries are merged
/// rather than re-processed from scratch to avoid compounding errors.
///
/// Returns the shortened message list on success, or the original list if the
/// text to compress is below the minimum length threshold.
pub async fn compress_history(base_url: &str, model: &str, messages: &[ChatMessage]) -> Result<Vec<ChatMessage>, String> {
    if messages.len() <= HISTORY_COMPRESS_THRESHOLD { return Ok(messages.to_vec()); }

    // Dynamic keep: at least 2 user+assistant turn pairs, min 4, max 8
    let keep = compute_keep(messages);
    if messages.len() <= keep { return Ok(messages.to_vec()); }

    // Find existing prior-context boundary to avoid re-compressing old summaries
    let compress_start = find_compress_start(messages);
    let compress_end = messages.len() - keep;
    if compress_start >= compress_end { return Ok(messages.to_vec()); }

    let existing_summary = extract_existing_summary(messages, compress_start);
    let to_compress = &messages[compress_start..compress_end];
    let to_keep = &messages[compress_end..];

    let mut transcript = String::new();
    for msg in to_compress {
        transcript.push_str(&format!("[{}]: {}\n\n", msg.role, extract_text_content(&msg.content)));
    }

    if transcript.len() < MIN_SUMMARIZE_LEN { return Ok(messages.to_vec()); }

    // Prepend existing summary so Ollama merges old + new context
    let input = if let Some(ref prev) = existing_summary {
        format!("[Previous summary]\n{}\n\n[New messages]\n{}", prev, transcript)
    } else {
        transcript
    };
    let summary = summarize(base_url, model, &input).await?;

    let total_compressed = if existing_summary.is_some() {
        // Count includes previously compressed messages
        let prev_count = extract_prev_count(messages, compress_start);
        prev_count + to_compress.len()
    } else {
        to_compress.len()
    };

    let mut result = Vec::with_capacity(2 + keep);
    result.push(ChatMessage {
        role: "user".to_string(),
        content: MessageContent::Text(format!("{} {} messages compressed]\n{}", PRIOR_CONTEXT_PREFIX, total_compressed, summary)),
    });
    result.push(ChatMessage {
        role: "assistant".to_string(),
        content: MessageContent::Text("Context received.".to_string()),
    });
    result.extend_from_slice(to_keep);
    Ok(result)
}

/// Computes how many recent messages to retain uncompressed.
///
/// Walks backwards through `messages` until at least 2 user turns and at least
/// 4 messages are covered, or 8 messages are reached (whichever comes first).
fn compute_keep(messages: &[ChatMessage]) -> usize {
    let mut turns = 0;
    let mut keep = 0;
    for msg in messages.iter().rev() {
        keep += 1;
        if msg.role == "user" { turns += 1; }
        if turns >= 2 && keep >= 4 { break; }
        if keep >= 8 { break; }
    }
    keep.max(4)
}

/// Returns the index of the first message that should be compressed in this pass.
///
/// If a previous `[Prior context —…]` summary exists, skips it and its
/// acknowledgement reply so they are not re-compressed.
fn find_compress_start(messages: &[ChatMessage]) -> usize {
    for (i, msg) in messages.iter().enumerate() {
        if let MessageContent::Text(ref t) = msg.content {
            if t.starts_with(PRIOR_CONTEXT_PREFIX) {
                // Skip the summary message + the "Context received." reply
                return (i + 2).min(messages.len());
            }
        }
    }
    0
}

/// Extracts the body of an existing prior-context summary, if present.
///
/// Returns `None` if there is no existing summary at `compress_start - 2`.
fn extract_existing_summary(messages: &[ChatMessage], compress_start: usize) -> Option<String> {
    if compress_start < 2 { return None; }
    if let MessageContent::Text(ref t) = messages[compress_start - 2].content {
        if t.starts_with(PRIOR_CONTEXT_PREFIX) {
            // Strip the header line, keep just the summary body
            return t.lines().skip(1).collect::<Vec<_>>().join("\n").into();
        }
    }
    None
}

/// Parses the count of previously compressed messages from the header line of
/// an existing `[Prior context — N messages compressed]` summary message.
fn extract_prev_count(messages: &[ChatMessage], compress_start: usize) -> usize {
    if compress_start < 2 { return 0; }
    if let MessageContent::Text(ref t) = messages[compress_start - 2].content {
        // Parse "[Prior context — 12 messages compressed]"
        if let Some(rest) = t.strip_prefix(PRIOR_CONTEXT_PREFIX) {
            if let Some(num_str) = rest.split_whitespace().next() {
                return num_str.parse().unwrap_or(0);
            }
        }
    }
    0
}

/// Extracts a plain-text representation from a [`MessageContent`] value.
///
/// Tool-result blocks are truncated to 200 characters to avoid bloating
/// the summarisation input.
fn extract_text_content(content: &MessageContent) -> String {
    match content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Blocks(blocks) => blocks.iter().map(|b| match b {
            ContentBlock::Text { text } => text.clone(),
            ContentBlock::ToolResult { content, .. } => {
                let preview: String = content.chars().take(200).collect();
                if content.len() > 200 { format!("[Tool result] {}...", preview) }
                else { format!("[Tool result] {}", preview) }
            }
            ContentBlock::ToolUse { name, .. } => format!("[Tool: {}]", name),
            _ => "[Image]".to_string(),
        }).collect::<Vec<_>>().join("\n"),
    }
}