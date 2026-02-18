use crate::{ChatMessage, MessageContent, ContentBlock, STORE_FILE};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use std::process::Command; 
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tauri_plugin_opener::OpenerExt;

const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const OLLAMA_TIMEOUT: Duration = Duration::from_secs(30);
const MIN_SUMMARIZE_LEN: usize = 500;
const HISTORY_COMPRESS_THRESHOLD: usize = 10;

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

pub struct OllamaSettings {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
}

// ── Settings ───────────────────────────────────────────────────────

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

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(OLLAMA_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

pub async fn check_health(base_url: &str) -> Result<String, String> {
    let client = build_client()?;
    let url = format!("{}/api/version", base_url);

    #[derive(Deserialize)]
    struct VersionResp { version: String }

    let resp = client.get(&url).send().await.map_err(|e| format!("Ollama unreachable: {}", e))?;
    let data: VersionResp = resp.json().await.map_err(|e| format!("Invalid version: {}", e))?;
    Ok(data.version)
}

pub async fn list_models(base_url: &str) -> Result<Vec<String>, String> {
    let client = build_client()?;
    let url = format!("{}/api/tags", base_url);

    #[derive(Deserialize)] struct Model { name: String }
    #[derive(Deserialize)] struct ModelsResp { models: Vec<Model> }

    let resp = client.get(&url).send().await.map_err(|e| format!("List failed: {}", e))?;
    let data: ModelsResp = resp.json().await.map_err(|e| format!("Invalid models: {}", e))?;
    Ok(data.models.into_iter().map(|m| m.name).collect())
}

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

const PRIOR_CONTEXT_PREFIX: &str = "[Prior context —";

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

fn extract_prev_count(messages: &[ChatMessage], compress_start: usize) -> usize {
    if compress_start < 2 { return 0; }
    if let MessageContent::Text(ref t) = messages[compress_start - 2].content {
        // Parse "[Prior context — 12 messages compressed]"
        if let Some(rest) = t.strip_prefix(PRIOR_CONTEXT_PREFIX) {
            if let Some(num_str) = rest.trim_start().split_whitespace().next() {
                return num_str.parse().unwrap_or(0);
            }
        }
    }
    0
}

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