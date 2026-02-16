use crate::{ChatMessage, MessageContent, ContentBlock, STORE_FILE};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

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
    tokio::process::Command::new("which")
        .arg("ollama")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub async fn install() -> Result<String, String> {
    let output = tokio::process::Command::new("bash")
        .arg("-c")
        .arg("curl -fsSL https://ollama.com/install.sh | sh 2>&1")
        .output()
        .await
        .map_err(|e| format!("Failed to run installer: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
    } else {
        Err(format!("Install failed (exit {}):\n{}\n{}", output.status.code().unwrap_or(-1), stdout, stderr))
    }
}

// ── API Helpers ────────────────────────────────────────────────────

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(OLLAMA_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Check if Ollama is running, return version string.
pub async fn check_health(base_url: &str) -> Result<String, String> {
    let client = build_client()?;
    let url = format!("{}/api/version", base_url);

    #[derive(Deserialize)]
    struct VersionResp {
        version: String,
    }

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable: {}", e))?;

    let data: VersionResp = resp
        .json()
        .await
        .map_err(|e| format!("Invalid version response: {}", e))?;

    Ok(data.version)
}

/// List locally available model names.
pub async fn list_models(base_url: &str) -> Result<Vec<String>, String> {
    let client = build_client()?;
    let url = format!("{}/api/tags", base_url);

    #[derive(Deserialize)]
    struct Model {
        name: String,
    }

    #[derive(Deserialize)]
    struct ModelsResp {
        models: Vec<Model>,
    }

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to list models: {}", e))?;

    let data: ModelsResp = resp
        .json()
        .await
        .map_err(|e| format!("Invalid models response: {}", e))?;

    Ok(data.models.into_iter().map(|m| m.name).collect())
}

/// Summarize text using Ollama. Skips if text is short.
pub async fn summarize(base_url: &str, model: &str, text: &str) -> Result<String, String> {
    if text.len() < MIN_SUMMARIZE_LEN {
        return Ok(text.to_string());
    }

    let client = build_client()?;
    let url = format!("{}/api/generate", base_url);

    let prompt = format!(
        "Summarize the following content concisely, preserving key details. \
         Use the same language as the original content. Output ONLY the summary:\n\n{}",
        text
    );

    let body = json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": {
            "temperature": 0.3,
            "num_predict": 512
        }
    });

    #[derive(Deserialize)]
    struct GenResp {
        response: String,
    }

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama generate failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {}: {}", status, body_text));
    }

    let data: GenResp = resp
        .json()
        .await
        .map_err(|e| format!("Invalid generate response: {}", e))?;

    Ok(data.response.trim().to_string())
}

/// Compress conversation history if it exceeds the threshold.
/// Keeps last `keep` messages intact, summarizes the rest.
pub async fn compress_history(
    base_url: &str,
    model: &str,
    messages: &[ChatMessage],
) -> Result<Vec<ChatMessage>, String> {
    if messages.len() <= HISTORY_COMPRESS_THRESHOLD {
        return Ok(messages.to_vec());
    }

    let keep = 4;
    let to_compress = &messages[..messages.len() - keep];
    let to_keep = &messages[messages.len() - keep..];

    let mut transcript = String::new();
    for msg in to_compress {
        let role = &msg.role;
        let text = extract_text_content(&msg.content);
        if !text.is_empty() {
            transcript.push_str(&format!("[{}]: {}\n\n", role, text));
        }
    }

    if transcript.len() < MIN_SUMMARIZE_LEN {
        return Ok(messages.to_vec());
    }

    let summary = summarize(base_url, model, &transcript).await?;

    let mut result = Vec::with_capacity(1 + keep);
    result.push(ChatMessage {
        role: "user".to_string(),
        content: MessageContent::Text(format!(
            "[Previous conversation summary — {} messages compressed]\n{}",
            to_compress.len(),
            summary
        )),
    });
    result.push(ChatMessage {
        role: "assistant".to_string(),
        content: MessageContent::Text("Understood, I have the context from our previous conversation.".to_string()),
    });
    result.extend_from_slice(to_keep);

    Ok(result)
}

/// Extract text from MessageContent (handles both Text and Blocks).
fn extract_text_content(content: &MessageContent) -> String {
    match content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Blocks(blocks) => {
            let mut parts = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text } => parts.push(text.clone()),
                    ContentBlock::ToolResult { content, .. } => {
                        if content.len() > 200 {
                            parts.push(format!("[tool result: {}... ({} chars)]", &content[..100], content.len()));
                        } else {
                            parts.push(content.clone());
                        }
                    }
                    ContentBlock::ToolUse { name, .. } => {
                        parts.push(format!("[called tool: {}]", name));
                    }
                    ContentBlock::Image { .. } => {
                        parts.push("[image]".to_string());
                    }
                }
            }
            parts.join("\n")
        }
    }
}
