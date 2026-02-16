use crate::ChatStreamEvent;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

// ── Types ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct OcSessionTime {
    pub created: u64,
    pub updated: u64,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct OcSession {
    pub id: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub time: Option<OcSessionTime>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SseMessagePart {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(rename = "messageID", default)]
    pub message_id: Option<String>,
    #[serde(rename = "type")]
    pub part_type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(rename = "callID", default)]
    pub call_id: Option<String>,
    #[serde(default)]
    pub state: Option<Value>,
}

// ── SSE Payload Types ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct SsePayload {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    properties: Value,
}

#[derive(Debug, Deserialize)]
struct SseEnvelope {
    payload: SsePayload,
}

// ── Client ─────────────────────────────────────────────────────────

pub struct OpenCodeClient {
    base_url: String,
    directory: String,
    client: Client,
}

impl OpenCodeClient {
    pub fn new(base_url: String, directory: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { base_url, directory, client }
    }

    /// Build URL with directory query parameter (matches mobile's api() behavior)
    fn url(&self, path: &str) -> String {
        let sep = if path.contains('?') { '&' } else { '?' };
        format!(
            "{}{}{}directory={}",
            self.base_url, path, sep, self.directory
        )
    }

    pub async fn health_check(&self) -> bool {
        let url = self.url("/global/health");
        match self.client.get(&url).send().await {
            Ok(resp) => {
                if let Ok(body) = resp.json::<Value>().await {
                    body.get("healthy").and_then(|v| v.as_bool()).unwrap_or(false)
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    }

    pub async fn create_session(&self) -> Result<OcSession, String> {
        let url = self.url("/session");
        let resp = self
            .client
            .post(&url)
            .header("content-type", "application/json")
            .body("{}")
            .send()
            .await
            .map_err(|e| format!("Failed to create session: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Create session failed: HTTP {} — {}", status, body));
        }

        resp.json::<OcSession>()
            .await
            .map_err(|e| format!("Failed to parse created session: {}", e))
    }

    pub async fn prompt_async(&self, session_id: &str, content: &str, system: Option<&str>) -> Result<(), String> {
        let url = self.url(&format!("/session/{}/prompt_async", session_id));
        let mut body = serde_json::json!({
            "parts": [{"type": "text", "text": content}]
        });
        if let Some(s) = system {
            body["system"] = serde_json::Value::String(s.to_string());
        }

        let resp = self
            .client
            .post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to send prompt: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!("Prompt failed: HTTP {} — {}", status, body_text));
        }

        Ok(())
    }

    pub async fn abort(&self, session_id: &str) -> Result<(), String> {
        let url = self.url(&format!("/session/{}/abort", session_id));
        let resp = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to abort: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Abort failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// Helper: send an idle "continue" ping to keep the session alive.
    async fn send_idle_ping(&self, session_id: &str, ping_num: u32, max_pings: u32) {
        eprintln!(
            "[winter-app] idle-ping {}/{} for session {}",
            ping_num, max_pings, session_id
        );
        if let Ok(pc) = Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            let ping_url = self.url(&format!(
                "/session/{}/prompt_async", session_id
            ));
            let body = serde_json::json!({
                "parts": [{"type": "text", "text": "continue"}]
            });
            let _ = pc
                .post(&ping_url)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await;
        }
    }

    /// Subscribe to the global SSE event stream and emit ChatStreamEvents.
    /// Filters events to only those matching `session_id`.
    /// Returns when the assistant message completes (finish == "stop") or abort is signaled.
    /// Includes idle-ping: if no SSE activity for 60s, sends "continue" (max 3 times).
    /// Auto-reconnects on stream errors to maintain idle-ping capability.
    pub async fn subscribe_sse(
        &self,
        session_id: &str,
        on_event: &Channel<ChatStreamEvent>,
        abort_flag: &AtomicBool,
    ) -> Result<(), String> {
        const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
        const MAX_IDLE_PINGS: u32 = 3;
        const RECONNECT_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

        let url = self.url("/global/event");

        // State preserved across reconnections
        let mut text_lengths: HashMap<String, usize> = HashMap::new();
        let mut tool_started: HashMap<String, bool> = HashMap::new();
        let mut user_msg_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut idle_ping_count: u32 = 0;
        let mut last_session_activity = std::time::Instant::now();

        'reconnect: loop {
            if abort_flag.load(Ordering::SeqCst) {
                return Ok(());
            }

            // Give up if all pings exhausted and another full timeout passed with no response
            if idle_ping_count >= MAX_IDLE_PINGS
                && last_session_activity.elapsed() >= IDLE_TIMEOUT
            {
                let _ = on_event.send(ChatStreamEvent::Error {
                    message: "SSE connection lost, all idle pings exhausted".to_string(),
                });
                return Ok(());
            }

            // SSE needs no timeout — it's a long-lived connection
            let sse_client = match Client::builder().build() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[winter-app] Failed to create SSE client: {}, retrying...", e);
                    tokio::time::sleep(RECONNECT_DELAY).await;
                    continue 'reconnect;
                }
            };

            let resp = match sse_client
                .get(&url)
                .header("accept", "text/event-stream")
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[winter-app] SSE connection failed: {}, retrying...", e);
                    if idle_ping_count < MAX_IDLE_PINGS
                        && last_session_activity.elapsed() >= IDLE_TIMEOUT
                    {
                        idle_ping_count += 1;
                        self.send_idle_ping(session_id, idle_ping_count, MAX_IDLE_PINGS).await;
                        last_session_activity = std::time::Instant::now();
                    }
                    tokio::time::sleep(RECONNECT_DELAY).await;
                    continue 'reconnect;
                }
            };

            if !resp.status().is_success() {
                let status = resp.status();
                eprintln!("[winter-app] SSE HTTP {}, retrying...", status);
                if idle_ping_count < MAX_IDLE_PINGS
                    && last_session_activity.elapsed() >= IDLE_TIMEOUT
                {
                    idle_ping_count += 1;
                    self.send_idle_ping(session_id, idle_ping_count, MAX_IDLE_PINGS).await;
                    last_session_activity = std::time::Instant::now();
                }
                tokio::time::sleep(RECONNECT_DELAY).await;
                continue 'reconnect;
            }

            eprintln!("[winter-app] SSE connected for session {}", session_id);
            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();

            loop {
                if abort_flag.load(Ordering::SeqCst) {
                    return Ok(());
                }

                let chunk = match tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    stream.next(),
                )
                .await
                {
                    Ok(Some(chunk)) => chunk,
                    Ok(None) => {
                        // Stream closed — reconnect
                        eprintln!("[winter-app] SSE stream closed, reconnecting...");
                        tokio::time::sleep(RECONNECT_DELAY).await;
                        continue 'reconnect;
                    }
                    Err(_) => {
                        // 5s timeout — check idle ping
                        if idle_ping_count < MAX_IDLE_PINGS
                            && last_session_activity.elapsed() >= IDLE_TIMEOUT
                        {
                            idle_ping_count += 1;
                            self.send_idle_ping(session_id, idle_ping_count, MAX_IDLE_PINGS).await;
                            last_session_activity = std::time::Instant::now();
                        }
                        continue;
                    }
                };

                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        // Stream error (e.g. "Internal server error") — reconnect
                        eprintln!("[winter-app] SSE stream error: {}, reconnecting...", e);
                        tokio::time::sleep(RECONNECT_DELAY).await;
                        continue 'reconnect;
                    }
                };

                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find("\n\n") {
                    let event_block = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();

                    let data_line = event_block
                        .lines()
                        .find(|line| line.starts_with("data: "))
                        .map(|line| &line[6..]);

                    let data_str = match data_line {
                        Some(d) => d,
                        None => continue,
                    };

                    let envelope: SseEnvelope = match serde_json::from_str(data_str) {
                        Ok(e) => e,
                        Err(_) => continue,
                    };

                    let event_type = &envelope.payload.event_type;

                    match event_type.as_str() {
                        "server.connected" => {}

                        "message.part.updated" => {
                            let part: SseMessagePart =
                                match serde_json::from_value(envelope.payload.properties.get("part").cloned().unwrap_or(Value::Null)) {
                                    Ok(p) => p,
                                    Err(_) => continue,
                                };

                            if part.session_id != session_id {
                                continue;
                            }

                            last_session_activity = std::time::Instant::now();
                            idle_ping_count = 0;

                            if let Some(ref mid) = part.message_id {
                                if user_msg_ids.contains(mid) {
                                    continue;
                                }
                            }

                            match part.part_type.as_str() {
                                "text" => {
                                    if let Some(full_text) = &part.text {
                                        let prev_len = text_lengths.get(&part.id).copied().unwrap_or(0);
                                        if full_text.len() > prev_len {
                                            let delta = &full_text[prev_len..];
                                            let _ = on_event.send(ChatStreamEvent::Delta {
                                                text: delta.to_string(),
                                            });
                                            text_lengths.insert(part.id.clone(), full_text.len());
                                        }
                                    }
                                }

                                "tool" => {
                                    let call_id = part.call_id.clone().unwrap_or_default();
                                    let tool_name = part.tool.clone().unwrap_or_else(|| "unknown".to_string());

                                    if let Some(state) = &part.state {
                                        let status = state
                                            .get("status")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");

                                        let input_json = state.get("input").and_then(|v| v.as_str()).unwrap_or("");
                                        let is_delegation = tool_name == "mcp_task" || tool_name == "mcp_delegate_task";
                                        let is_summer = is_delegation && (
                                            input_json.contains("\"sum\"") || input_json.contains("\"mer\"")
                                            || input_json.contains("\"visual-engineering\"")
                                        );

                                        match status {
                                            "running" => {
                                                if let std::collections::hash_map::Entry::Vacant(e) = tool_started.entry(call_id.clone()) {
                                                    if is_summer {
                                                        let _ = on_event.send(ChatStreamEvent::Status {
                                                            text: "Delegating to Summer...".to_string(),
                                                        });
                                                    } else if is_delegation {
                                                        let agent = if input_json.contains("\"oracle\"") { "Oracle" }
                                                            else if input_json.contains("\"explore\"") { "exploring" }
                                                            else if input_json.contains("\"librarian\"") { "researching" }
                                                            else if input_json.contains("\"frost\"") { "Frost" }
                                                            else if input_json.contains("\"spring\"") { "Spring" }
                                                            else { "subagent" };
                                                        let _ = on_event.send(ChatStreamEvent::Status {
                                                            text: format!("Delegating to {}...", agent),
                                                        });
                                                    }
                                                    let _ = on_event.send(ChatStreamEvent::ToolStart {
                                                        name: tool_name,
                                                        id: call_id,
                                                    });
                                                    e.insert(true);
                                                }
                                            }
                                            "completed" => {
                                                if let std::collections::hash_map::Entry::Vacant(e) = tool_started.entry(call_id.clone()) {
                                                    let _ = on_event.send(ChatStreamEvent::ToolStart {
                                                        name: tool_name,
                                                        id: call_id.clone(),
                                                    });
                                                    e.insert(true);
                                                }

                                                let output = state
                                                    .get("metadata")
                                                    .and_then(|m| m.get("output"))
                                                    .and_then(|v| v.as_str())
                                                    .or_else(|| {
                                                        state.get("output").and_then(|v| v.as_str())
                                                    })
                                                    .unwrap_or("")
                                                    .to_string();

                                                let _ = on_event.send(ChatStreamEvent::ToolEnd {
                                                    id: call_id,
                                                    result: output,
                                                });
                                            }
                                            "error" => {
                                                let error_msg = state
                                                    .get("error")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("Tool execution failed")
                                                    .to_string();

                                                let _ = on_event.send(ChatStreamEvent::ToolEnd {
                                                    id: call_id,
                                                    result: format!("[error] {}", error_msg),
                                                });
                                            }
                                            _ => {}
                                        }
                                    }
                                }

                                "step-start" => {
                                    let _ = on_event.send(ChatStreamEvent::Status {
                                        text: "thinking".to_string(),
                                    });
                                }

                                "reasoning" => {}

                                _ => {}
                            }
                        }

                        "message.updated" => {
                            if let Some(props) = envelope.payload.properties.as_object() {
                                if let Some(info) = props.get("info") {
                                    let msg_session = info
                                        .get("sessionID")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    if msg_session != session_id {
                                        continue;
                                    }

                                    last_session_activity = std::time::Instant::now();
                                    idle_ping_count = 0;

                                    let role = info.get("role").and_then(|v| v.as_str()).unwrap_or("");
                                    let finish = info.get("finish").and_then(|v| v.as_str()).unwrap_or("");

                                    if role == "user" {
                                        if let Some(mid) = info.get("id").and_then(|v| v.as_str()) {
                                            user_msg_ids.insert(mid.to_string());
                                        }
                                    }

                                    if let Some(tokens) = info.get("tokens") {
                                        let input = tokens
                                            .get("input")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0);
                                        let output = tokens
                                            .get("output")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0);
                                        if input > 0 || output > 0 {
                                            let _ = on_event.send(ChatStreamEvent::Usage {
                                                input_tokens: input,
                                                output_tokens: output,
                                            });
                                        }
                                    }

                                    if role == "assistant" && finish == "stop" {
                                        let _ = on_event.send(ChatStreamEvent::StreamEnd);
                                        return Ok(());
                                    }
                                }
                            }
                        }

                        _ => {}
                    }
                }
            }
        }
    }
}
