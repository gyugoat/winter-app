/// Conversation history compaction module.
/// Primary provider: Claude Haiku (API) — fast, preserves context.
/// Fallback provider: Ollama (local) — used when explicitly configured.
use crate::claude::types::{ChatMessage, ContentBlock, MessageContent};
use crate::STORE_FILE;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

// ── Constants ───────────────────────────────────────────────────────

const HAIKU_MODEL: &str = "claude-haiku-4-5-20250710";
const HAIKU_API_URL: &str = "https://api.anthropic.com/v1/messages";
const HAIKU_TIMEOUT: Duration = Duration::from_secs(60);
const HAIKU_MAX_TOKENS: u32 = 512;

const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const OLLAMA_TIMEOUT: Duration = Duration::from_secs(30);

const MIN_SUMMARIZE_LEN: usize = 500;
const HISTORY_COMPRESS_THRESHOLD: usize = 10;

const PRIOR_CONTEXT_PREFIX: &str = "[Prior context —";

const SUMMARIZE_PROMPT: &str = "Extract ONLY the key facts and decisions from this conversation. \
Do NOT list user requests. Do NOT write \"User asked X, then Y\". \
Output format: what was decided, what was done, what remains. Nothing else.";

// ── Provider ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum CompactionProvider {
    Haiku,
    Ollama,
}

impl CompactionProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            CompactionProvider::Haiku => "haiku",
            CompactionProvider::Ollama => "ollama",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "ollama" => CompactionProvider::Ollama,
            _ => CompactionProvider::Haiku, // default
        }
    }
}

// ── Settings ────────────────────────────────────────────────────────

pub struct CompactionSettings {
    pub provider: CompactionProvider,
    pub enabled: bool,
    pub ollama_url: String,
    pub ollama_model: String,
}

pub fn get_settings(app: &AppHandle) -> CompactionSettings {
    let store = match app.store(STORE_FILE) {
        Ok(s) => s,
        Err(_) => {
            return CompactionSettings {
                provider: CompactionProvider::Haiku,
                enabled: true,
                ollama_url: DEFAULT_OLLAMA_URL.to_string(),
                ollama_model: "qwen2.5:7b".to_string(),
            };
        }
    };

    // provider key takes precedence. If not set, derive from legacy ollama_enabled.
    let provider = store
        .get("compaction_provider")
        .and_then(|v| v.as_str().map(CompactionProvider::from_str))
        .unwrap_or_else(|| {
            // Migrate: if ollama_enabled was true, keep Ollama; otherwise default to Haiku
            let ollama_on = store
                .get("ollama_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if ollama_on {
                CompactionProvider::Ollama
            } else {
                CompactionProvider::Haiku
            }
        });

    // enabled: true by default (Haiku is free to call with existing OAuth token)
    let enabled = store
        .get("compaction_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let ollama_url = store
        .get("ollama_url")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string());

    let ollama_model = store
        .get("ollama_model")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "qwen2.5:7b".to_string());

    CompactionSettings {
        provider,
        enabled,
        ollama_url,
        ollama_model,
    }
}

// ── Haiku Summarizer ────────────────────────────────────────────────

/// Reads the Anthropic OAuth access token from the app's persistent store.
fn read_access_token(app: &AppHandle) -> Option<String> {
    use crate::{STORE_KEY_ACCESS, STORE_KEY_EXPIRES};
    let store = app.store(STORE_FILE).ok()?;

    // Check expiry
    let expires = store
        .get(STORE_KEY_EXPIRES)
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if now_ms > expires {
        return None;
    }

    store
        .get(STORE_KEY_ACCESS)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

async fn summarize_with_haiku(app: &AppHandle, text: &str) -> Result<String, String> {
    if text.len() < MIN_SUMMARIZE_LEN {
        return Ok(text.to_string());
    }

    let access_token = read_access_token(app)
        .ok_or_else(|| "No valid access token for Haiku compaction".to_string())?;

    let client = Client::builder()
        .timeout(HAIKU_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let body = json!({
        "model": HAIKU_MODEL,
        "max_tokens": HAIKU_MAX_TOKENS,
        "temperature": 0.3,
        "system": SUMMARIZE_PROMPT,
        "messages": [
            { "role": "user", "content": text }
        ]
    });

    #[derive(Deserialize)]
    struct TextBlock {
        #[serde(rename = "type")]
        block_type: String,
        text: Option<String>,
    }
    #[derive(Deserialize)]
    struct HaikuResp {
        content: Vec<TextBlock>,
    }

    let resp = client
        .post(HAIKU_API_URL)
        .header("authorization", format!("Bearer {}", access_token))
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("x-app", "cli")
        .header("user-agent", "winter-app/1.0.0")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Haiku request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("Haiku API error {}: {}", status, body_text));
    }

    let data: HaikuResp = resp
        .json()
        .await
        .map_err(|e| format!("Haiku response parse error: {}", e))?;

    let summary = data
        .content
        .into_iter()
        .find(|b| b.block_type == "text")
        .and_then(|b| b.text)
        .ok_or_else(|| "Haiku returned empty response".to_string())?;

    Ok(summary.trim().to_string())
}

// ── Ollama Summarizer ───────────────────────────────────────────────

async fn summarize_with_ollama(base_url: &str, model: &str, text: &str) -> Result<String, String> {
    if text.len() < MIN_SUMMARIZE_LEN {
        return Ok(text.to_string());
    }

    let client = Client::builder()
        .timeout(OLLAMA_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let url = format!("{}/api/generate", base_url);
    let prompt = format!("{}\n\n{}", SUMMARIZE_PROMPT, text);

    let body = json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "temperature": 0.3, "num_predict": 512 }
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
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama error: {}", resp.status()));
    }

    let data: GenResp = resp
        .json()
        .await
        .map_err(|e| format!("Ollama response parse error: {}", e))?;

    Ok(data.response.trim().to_string())
}

// ── Public API ──────────────────────────────────────────────────────

/// Summarizes text using the configured provider (Haiku by default, Ollama as fallback).
/// Falls back to Ollama if Haiku fails.
pub async fn summarize(
    app: &AppHandle,
    settings: &CompactionSettings,
    text: &str,
) -> Result<String, String> {
    if text.len() < MIN_SUMMARIZE_LEN {
        return Ok(text.to_string());
    }

    match settings.provider {
        CompactionProvider::Haiku => {
            match summarize_with_haiku(app, text).await {
                Ok(s) => Ok(s),
                Err(e) => {
                    // Haiku failed → try Ollama as fallback
                    println!("[compaction] Haiku failed ({}), falling back to Ollama", e);
                    summarize_with_ollama(&settings.ollama_url, &settings.ollama_model, text).await
                        .map_err(|ollama_err| {
                            format!("Both Haiku and Ollama failed. Haiku: {}. Ollama: {}", e, ollama_err)
                        })
                }
            }
        }
        CompactionProvider::Ollama => {
            summarize_with_ollama(&settings.ollama_url, &settings.ollama_model, text).await
        }
    }
}

/// Compresses conversation history when it exceeds the threshold.
/// Identical logic to the previous `ollama::compress_history()`.
pub async fn compress_history(
    app: &AppHandle,
    settings: &CompactionSettings,
    messages: &[ChatMessage],
) -> Result<Vec<ChatMessage>, String> {
    if messages.len() <= HISTORY_COMPRESS_THRESHOLD {
        return Ok(messages.to_vec());
    }

    let keep = compute_keep(messages);
    if messages.len() <= keep {
        return Ok(messages.to_vec());
    }

    let compress_start = find_compress_start(messages);
    let compress_end = messages.len() - keep;
    if compress_start >= compress_end {
        return Ok(messages.to_vec());
    }

    let existing_summary = extract_existing_summary(messages, compress_start);
    let to_compress = &messages[compress_start..compress_end];
    let to_keep = &messages[compress_end..];

    let mut transcript = String::new();
    for msg in to_compress {
        transcript.push_str(&format!(
            "[{}]: {}\n\n",
            msg.role,
            extract_text_content(&msg.content)
        ));
    }

    if transcript.len() < MIN_SUMMARIZE_LEN {
        return Ok(messages.to_vec());
    }

    // Prepend existing summary so the provider merges old + new context
    let input = if let Some(ref prev) = existing_summary {
        format!(
            "[Previous summary]\n{}\n\n[New messages]\n{}",
            prev, transcript
        )
    } else {
        transcript
    };

    let summary = summarize(app, settings, &input).await?;

    let total_compressed = if existing_summary.is_some() {
        let prev_count = extract_prev_count(messages, compress_start);
        prev_count + to_compress.len()
    } else {
        to_compress.len()
    };

    let mut result = Vec::with_capacity(2 + keep);
    result.push(ChatMessage {
        role: "user".to_string(),
        content: MessageContent::Text(format!(
            "{} {} messages compressed]\n{}",
            PRIOR_CONTEXT_PREFIX, total_compressed, summary
        )),
    });
    result.push(ChatMessage {
        role: "assistant".to_string(),
        content: MessageContent::Text("Context received.".to_string()),
    });
    result.extend_from_slice(to_keep);
    Ok(result)
}

// ── Private Helpers ─────────────────────────────────────────────────

fn compute_keep(messages: &[ChatMessage]) -> usize {
    let mut turns = 0;
    let mut keep = 0;
    for msg in messages.iter().rev() {
        keep += 1;
        if msg.role == "user" {
            turns += 1;
        }
        if turns >= 2 && keep >= 4 {
            break;
        }
        if keep >= 8 {
            break;
        }
    }
    keep.max(4)
}

fn find_compress_start(messages: &[ChatMessage]) -> usize {
    for (i, msg) in messages.iter().enumerate() {
        if let MessageContent::Text(ref t) = msg.content {
            if t.starts_with(PRIOR_CONTEXT_PREFIX) {
                return (i + 2).min(messages.len());
            }
        }
    }
    0
}

fn extract_existing_summary(messages: &[ChatMessage], compress_start: usize) -> Option<String> {
    if compress_start < 2 {
        return None;
    }
    if let MessageContent::Text(ref t) = messages[compress_start - 2].content {
        if t.starts_with(PRIOR_CONTEXT_PREFIX) {
            return t.lines().skip(1).collect::<Vec<_>>().join("\n").into();
        }
    }
    None
}

fn extract_prev_count(messages: &[ChatMessage], compress_start: usize) -> usize {
    if compress_start < 2 {
        return 0;
    }
    if let MessageContent::Text(ref t) = messages[compress_start - 2].content {
        if let Some(rest) = t.strip_prefix(PRIOR_CONTEXT_PREFIX) {
            if let Some(num_str) = rest.split_whitespace().next() {
                return num_str.parse().unwrap_or(0);
            }
        }
    }
    0
}

fn extract_text_content(content: &MessageContent) -> String {
    match content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Blocks(blocks) => blocks
            .iter()
            .map(|b| match b {
                ContentBlock::Text { text } => text.clone(),
                ContentBlock::ToolResult { content, .. } => {
                    let preview: String = content.chars().take(200).collect();
                    if content.len() > 200 {
                        format!("[Tool result] {}...", preview)
                    } else {
                        format!("[Tool result] {}", preview)
                    }
                }
                ContentBlock::ToolUse { name, .. } => format!("[Tool: {}]", name),
                _ => "[Image]".to_string(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}
