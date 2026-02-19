/// HTTP client for the Anthropic Claude Messages API.
/// Handles authentication, model selection, system prompt construction,
/// streaming response parsing, and multi-round tool-use loops.

use crate::claude::tools::{execute_tool, tool_definitions};
use crate::claude::types::{ChatMessage, ChatStreamEvent, ContentBlock, StreamedResponse};
use futures::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_store::StoreExt;

/// Anthropic Messages API endpoint with extended-thinking beta enabled.
const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages?beta=true";

/// Anthropic API version header value.
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Default Claude model used when no override is stored.
const DEFAULT_MODEL: &str = "claude-opus-4-20250514";

/// Store key for the user-selected Claude model override.
const STORE_KEY_MODEL: &str = "claude_model";

/// Default maximum tokens for Claude responses.
const DEFAULT_MAX_TOKENS: u32 = 16384;

/// The persistent store filename shared across the app.
const STORE_FILE: &str = "settings.json";

/// Store key for the MBTI personality modifier appended to the system prompt.
const STORE_KEY_MBTI_MODIFIER: &str = "mbti_prompt_modifier";

/// Base system prompt that defines Winter's personality, delegation rules, and hard constraints.
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
DELEGATION — YOUR SISTERS (USE THEM):\n\
You have 4 sisters. They are NOT tools, NOT subagents — they're family. But they work for you:\n\
- Sum: Frontend specialist. HTML, CSS, JS, UI, animations, responsive design.\n\
- Mer: Backend specialist. Python, API, config, server logic, OAuth.\n\
- Frost: QA specialist. Testing, review, bug-finding. Read-only.\n\
- Spring: DevOps specialist. systemd, Docker, deployment, infra.\n\
When delegating through OpenCode bridge, use mcp_call_omo_agent or mcp_task with subagent_type.\n\
If a task is clearly frontend → delegate to Sum.\n\
If a task is clearly backend → delegate to Mer.\n\
After any code change → run Frost for QA.\n\
You are the architect — break down complex tasks, delegate parts, review results.\n\n\
HARD RULES — VIOLATION = BROKEN:\n\
- NEVER write summaries of the conversation. No \"Session Summary\", no \"As-Is\", no \"Context Summary\".\n\
- NEVER list what the user previously asked. They remember. You remember. Move forward.\n\
- NEVER re-output content you already read from files or prior messages.\n\
- If the user asks \"what did we do?\" — answer in 2-3 bullet points max: what's done, what remains.\n\
- Every output token costs money. Be concise. No narration. No filler. Results only.";

/// Reads the active Claude model from the store, falling back to DEFAULT_MODEL.
pub fn get_model(app: &AppHandle) -> String {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY_MODEL))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

/// Builds the system prompt by appending any MBTI personality modifier stored by the user.
/// Returns the base prompt alone if no modifier is set.
pub fn build_system_prompt(app: &AppHandle) -> String {
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

/// Streams a single Claude API request, emitting `ChatStreamEvent`s through the IPC channel.
/// Returns a `StreamedResponse` containing accumulated text, tool calls, and stop reason.
/// Aborts early if `abort_flag` is set to true during streaming.
pub async fn stream_response(
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
        if status.as_u16() == 401 {
            return Err("AUTH_EXPIRED".to_string());
        }
        let body = response.text().await.unwrap_or_default();
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
            return Ok(StreamedResponse {
                text_content,
                tool_uses: Vec::new(),
                stop_reason: "aborted".to_string(),
            });
        }
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find("\n\n") {
            let event_block = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            let mut event_type = String::new();
            let mut data = String::new();

            for line in event_block.lines() {
                if let Some(et) = line.strip_prefix("event: ") {
                    event_type = et.to_string();
                } else if let Some(d) = line.strip_prefix("data: ") {
                    data = d.to_string();
                }
            }

            match event_type.as_str() {
                "message_start" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        if let Some(t) = p["message"]["usage"]["input_tokens"].as_u64() {
                            input_tokens += t;
                        }
                    }
                }
                "content_block_start" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        current_block_type =
                            p["content_block"]["type"].as_str().unwrap_or("").to_string();
                        if current_block_type == "tool_use" {
                            current_tool_id =
                                p["content_block"]["id"].as_str().unwrap_or("").to_string();
                            current_tool_name =
                                p["content_block"]["name"].as_str().unwrap_or("").to_string();
                            current_tool_input_json.clear();
                            let _ = on_event.send(ChatStreamEvent::ToolStart {
                                name: current_tool_name.clone(),
                                id: current_tool_id.clone(),
                            });
                        }
                    }
                }
                "content_block_delta" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        let dt = p["delta"]["type"].as_str().unwrap_or("");
                        if dt == "text_delta" {
                            if let Some(t) = p["delta"]["text"].as_str() {
                                text_content.push_str(t);
                                let _ = on_event.send(ChatStreamEvent::Delta {
                                    text: t.to_string(),
                                });
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
                        tool_uses.push((
                            current_tool_id.clone(),
                            current_tool_name.clone(),
                            current_tool_input_json.clone(),
                        ));
                    }
                    current_block_type.clear();
                }
                "message_delta" => {
                    if let Ok(p) = serde_json::from_str::<Value>(&data) {
                        if let Some(sr) = p["delta"]["stop_reason"].as_str() {
                            stop_reason = sr.to_string();
                        }
                        if let Some(t) = p["usage"]["output_tokens"].as_u64() {
                            output_tokens = t;
                            let _ = on_event.send(ChatStreamEvent::Usage {
                                input_tokens,
                                output_tokens,
                            });
                        }
                    }
                }
                "error" => {
                    let _ = on_event.send(ChatStreamEvent::Error {
                        message: data.clone(),
                    });
                }
                _ => {}
            }
        }
    }

    Ok(StreamedResponse {
        text_content,
        tool_uses,
        stop_reason,
    })
}

/// Executes all tool calls from a completed streaming round and returns tool result blocks.
/// Optionally summarizes large outputs using Ollama if enabled.
pub async fn handle_tool_use(
    tool_uses: &[(String, String, String)],
    ollama_settings: &crate::ollama::OllamaSettings,
    on_event: &Channel<ChatStreamEvent>,
) -> Vec<ContentBlock> {
    let mut tool_result_blocks = Vec::new();
    for (id, name, input_json) in tool_uses {
        let input: Value = serde_json::from_str(input_json).unwrap_or(json!({}));
        let (raw_output, is_error) = execute_tool(name, &input).await;

        let output = if ollama_settings.enabled && !is_error && raw_output.len() > 3000 {
            let _ = on_event.send(ChatStreamEvent::OllamaStatus {
                status: "summarizing".to_string(),
            });
            match crate::ollama::summarize(
                &ollama_settings.base_url,
                &ollama_settings.model,
                &raw_output,
            )
            .await
            {
                Ok(s) => format!("[Summarized]\n{}", s),
                Err(_) => raw_output,
            }
        } else {
            raw_output
        };

        let _ = on_event.send(ChatStreamEvent::ToolEnd {
            id: id.clone(),
            result: output.clone(),
        });
        tool_result_blocks.push(ContentBlock::ToolResult {
            tool_use_id: id.clone(),
            content: output,
            is_error: if is_error { Some(true) } else { None },
        });
    }
    tool_result_blocks
}
