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
const DEFAULT_OLLAMA_MODEL: &str = "qwen2.5:14b";
const OLLAMA_TIMEOUT: Duration = Duration::from_secs(30);
const MIN_SUMMARIZE_LEN: usize = 500;
const HISTORY_COMPRESS_THRESHOLD: usize = 10;

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
                model: DEFAULT_OLLAMA_MODEL.to_string(),
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
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());

    OllamaSettings {
        enabled,
        base_url,
        model,
    }
}

// ── Installation ───────────────────────────────────────────────────

pub async fn is_installed() -> bool {
    if cfg!(target_os = "windows") {
        Command::new("where")
            .arg("ollama")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
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
    let prompt = format!("Summarize concisely:\n\n{}", text);

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

pub async fn compress_history(base_url: &str, model: &str, messages: &[ChatMessage]) -> Result<Vec<ChatMessage>, String> {
    if messages.len() <= HISTORY_COMPRESS_THRESHOLD { return Ok(messages.to_vec()); }

    let keep = 4;
    let to_compress = &messages[..messages.len() - keep];
    let to_keep = &messages[messages.len() - keep..];

    let mut transcript = String::new();
    for msg in to_compress {
        transcript.push_str(&format!("[{}]: {}\n\n", msg.role, extract_text_content(&msg.content)));
    }

    if transcript.len() < MIN_SUMMARIZE_LEN { return Ok(messages.to_vec()); }
    let summary = summarize(base_url, model, &transcript).await?;

    let mut result = Vec::with_capacity(2 + keep);
    result.push(ChatMessage {
        role: "user".to_string(),
        content: MessageContent::Text(format!("[Summary of {} messages]\n{}", to_compress.len(), summary)),
    });
    result.push(ChatMessage {
        role: "assistant".to_string(),
        content: MessageContent::Text("Context received.".to_string()),
    });
    result.extend_from_slice(to_keep);
    Ok(result)
}

fn extract_text_content(content: &MessageContent) -> String {
    match content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Blocks(blocks) => blocks.iter().map(|b| match b {
            ContentBlock::Text { text } => text.clone(),
            _ => "[Tool/Image]".to_string(),
        }).collect::<Vec<_>>().join("\n"),
    }
}