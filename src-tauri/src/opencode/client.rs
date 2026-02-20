/// HTTP client for the OpenCode server API.
/// Manages sessions, prompt submission, SSE streaming, and file/question proxying.

use crate::claude::types::ChatStreamEvent;
use crate::opencode::types::{OcSession, SseEnvelope, SseMessagePart};
use futures::StreamExt;
use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

/// HTTP client for communicating with a running OpenCode server instance.
/// All requests include a `?directory=<workspace>` parameter to scope operations.
pub struct OpenCodeClient {
    /// Base URL of the OpenCode server (e.g. "http://127.0.0.1:6096").
    base_url: String,
    /// Workspace directory path sent as query param on every request.
    directory: String,
    /// Underlying reqwest HTTP client with 30s timeout.
    client: Client,
}

impl OpenCodeClient {
    /// Creates a new OpenCodeClient targeting the given base URL and workspace directory.
    pub fn new(base_url: String, directory: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            base_url,
            directory,
            client,
        }
    }

    /// Builds a full URL by appending `?directory=<workspace>` to the given path.
    fn url(&self, path: &str) -> String {
        let sep = if path.contains('?') { '&' } else { '?' };
        format!(
            "{}{}{}directory={}",
            self.base_url, path, sep, self.directory
        )
    }

    /// Checks if the OpenCode server is running and healthy.
    /// Returns true only if the health endpoint responds with `{"healthy": true}`.
    pub async fn health_check(&self) -> bool {
        let url = self.url("/global/health");
        match self.client.get(&url).send().await {
            Ok(resp) => {
                if let Ok(body) = resp.json::<Value>().await {
                    body.get("healthy")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    }

    /// Creates a new OpenCode session and returns its metadata.
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
            return Err(format!(
                "Create session failed: HTTP {} — {}",
                status, body
            ));
        }

        resp.json::<OcSession>()
            .await
            .map_err(|e| format!("Failed to parse created session: {}", e))
    }

    /// Sends a prompt to the given session asynchronously (fire-and-forget server-side).
    /// Optionally appends a system modifier. Returns immediately once the server accepts the prompt.
    pub async fn prompt_async(
        &self,
        session_id: &str,
        content: &str,
        system: Option<&str>,
    ) -> Result<(), String> {
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
            return Err(format!(
                "Prompt failed: HTTP {} — {}",
                status, body_text
            ));
        }

        Ok(())
    }

    /// Fetches all existing message IDs for a session to use as a deduplication baseline.
    /// Messages with IDs in this set will be skipped in SSE event handling.
    pub async fn get_known_message_ids(
        &self,
        session_id: &str,
    ) -> std::collections::HashSet<String> {
        let url = self.url(&format!("/session/{}/message", session_id));
        let mut ids = std::collections::HashSet::new();
        if let Ok(resp) = self.client.get(&url).send().await {
            if let Ok(messages) = resp.json::<Vec<Value>>().await {
                for msg in &messages {
                    if let Some(info) = msg.get("info") {
                        if let Some(mid) = info.get("id").and_then(|v| v.as_str()) {
                            ids.insert(mid.to_string());
                        }
                    }
                }
            }
        }
        ids
    }

    /// Sends an abort request to halt the current running prompt in the given session.
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

    /// Returns path info from the OpenCode server (working directory, etc.).
    pub async fn get_path_info(&self) -> Result<serde_json::Value, String> {
        let url = self.url("/path");
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Path request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Path request failed: HTTP {}", resp.status()));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Path parse failed: {}", e))
    }

    /// Lists files at the given path within the OpenCode workspace.
    pub async fn list_files(&self, path: &str) -> Result<serde_json::Value, String> {
        let url = self.url(&format!("/file?path={}", urlencoding::encode(path)));
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("List files failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("List files failed: HTTP {}", resp.status()));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("List files parse failed: {}", e))
    }

    /// Returns the content of a file at the given path in the OpenCode workspace.
    pub async fn file_content(
        &self,
        path: &str,
        opencode_dir: &str,
    ) -> Result<serde_json::Value, String> {
        let url = self.url(&format!(
            "/file/content?path={}",
            urlencoding::encode(path)
        ));
        let resp = self
            .client
            .get(&url)
            .header("x-opencode-directory", opencode_dir)
            .send()
            .await
            .map_err(|e| format!("File content failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("File content failed: HTTP {}", resp.status()));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("File content parse failed: {}", e))
    }

    /// Returns all pending questions awaiting user input in the OpenCode session.
    pub async fn get_questions(&self) -> Result<serde_json::Value, String> {
        let url = self.url("/question");
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Questions request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Questions request failed: HTTP {}",
                resp.status()
            ));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Questions parse failed: {}", e))
    }

    /// Submits answers to a pending question in the OpenCode session.
    pub async fn reply_question(
        &self,
        request_id: &str,
        answers: serde_json::Value,
    ) -> Result<(), String> {
        let url = self.url(&format!("/question/{}/reply", request_id));
        let resp = self
            .client
            .post(&url)
            .header("content-type", "application/json")
            .json(&serde_json::json!({ "answers": answers }))
            .send()
            .await
            .map_err(|e| format!("Reply failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Reply failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// Rejects a pending question in the OpenCode session without providing answers.
    pub async fn reject_question(&self, request_id: &str) -> Result<(), String> {
        let url = self.url(&format!("/question/{}/reject", request_id));
        let resp = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|e| format!("Reject failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Reject failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// Returns all messages in the given OpenCode session.
    pub async fn get_session_messages(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, String> {
        let url = self.url(&format!("/session/{}/message", session_id));
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Messages request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Messages request failed: HTTP {}",
                resp.status()
            ));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Messages parse failed: {}", e))
    }

    /// Lists all OpenCode sessions for the current workspace directory.
    pub async fn list_sessions(&self) -> Result<Vec<OcSession>, String> {
        let url = self.url("/session");
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to list sessions: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "List sessions failed: HTTP {} — {}",
                status, body
            ));
        }

        resp.json::<Vec<OcSession>>()
            .await
            .map_err(|e| format!("Failed to parse sessions: {}", e))
    }

    /// Deletes the given OpenCode session.
    pub async fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let url = self.url(&format!("/session/{}", session_id));
        let resp = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to delete session: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete session failed: HTTP {} — {}", status, body));
        }

        Ok(())
    }

    /// Renames the given OpenCode session to the specified title.
    pub async fn rename_session(&self, session_id: &str, title: &str) -> Result<(), String> {
        let url = self.url(&format!("/session/{}", session_id));
        let body = serde_json::json!({ "title": title });
        let resp = self
            .client
            .patch(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to rename session: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Rename session failed: HTTP {} — {}",
                status, body_text
            ));
        }

        Ok(())
    }

    /// Sends an idle "continue" ping to prevent session timeout.
    /// Used internally when no SSE activity is detected for IDLE_TIMEOUT seconds.
    async fn send_idle_ping(&self, session_id: &str, ping_num: u32, max_pings: u32) {
        eprintln!(
            "[winter-app] idle-ping {}/{} for session {}",
            ping_num, max_pings, session_id
        );
        if let Ok(pc) = Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            let ping_url = self.url(&format!("/session/{}/prompt_async", session_id));
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

    /// Subscribes to the global SSE event stream and emits `ChatStreamEvent`s via the IPC channel.
    /// Filters events to the given `session_id` only, skipping pre-existing message IDs.
    /// Includes idle-ping logic: if no activity for 60s, sends "continue" (max 3 times).
    /// Auto-reconnects on stream errors. Returns when the assistant message finishes or abort fires.
    pub async fn subscribe_sse(
        &self,
        session_id: &str,
        on_event: &Channel<ChatStreamEvent>,
        abort_flag: &AtomicBool,
        known_msg_ids: std::collections::HashSet<String>,
    ) -> Result<(), String> {
        const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
        const MAX_IDLE_PINGS: u32 = 3;
        const RECONNECT_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

        let url = self.url("/global/event");

        let mut text_lengths: HashMap<String, usize> = HashMap::new();
        let mut tool_started: HashMap<String, bool> = HashMap::new();
        let mut user_msg_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        let mut idle_ping_count: u32 = 0;
        let mut last_session_activity = std::time::Instant::now();

        'reconnect: loop {
            if abort_flag.load(Ordering::SeqCst) {
                return Ok(());
            }

            if idle_ping_count >= MAX_IDLE_PINGS
                && last_session_activity.elapsed() >= IDLE_TIMEOUT
            {
                let _ = on_event.send(ChatStreamEvent::Error {
                    message: "SSE connection lost, all idle pings exhausted".to_string(),
                });
                return Ok(());
            }

            let sse_client = match Client::builder().build() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!(
                        "[winter-app] Failed to create SSE client: {}, retrying...",
                        e
                    );
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
                        self.send_idle_ping(session_id, idle_ping_count, MAX_IDLE_PINGS)
                            .await;
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
                    self.send_idle_ping(session_id, idle_ping_count, MAX_IDLE_PINGS)
                        .await;
                    last_session_activity = std::time::Instant::now();
                }
                tokio::time::sleep(RECONNECT_DELAY).await;
                continue 'reconnect;
            }

            eprintln!(
                "[winter-app] SSE connected for session {}",
                session_id
            );

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
                        eprintln!("[winter-app] SSE stream closed, reconnecting...");
                        tokio::time::sleep(RECONNECT_DELAY).await;
                        continue 'reconnect;
                    }
                    Err(_) => {
                        if idle_ping_count < MAX_IDLE_PINGS
                            && last_session_activity.elapsed() >= IDLE_TIMEOUT
                        {
                            idle_ping_count += 1;
                            self.send_idle_ping(session_id, idle_ping_count, MAX_IDLE_PINGS)
                                .await;
                            last_session_activity = std::time::Instant::now();
                        }
                        continue;
                    }
                };

                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!(
                            "[winter-app] SSE stream error: {}, reconnecting...",
                            e
                        );
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
                            let part: SseMessagePart = match serde_json::from_value(
                                envelope
                                    .payload
                                    .properties
                                    .get("part")
                                    .cloned()
                                    .unwrap_or(Value::Null),
                            ) {
                                Ok(p) => p,
                                Err(_) => continue,
                            };

                            if part.session_id != session_id {
                                continue;
                            }

                            last_session_activity = std::time::Instant::now();
                            idle_ping_count = 0;

                            match &part.message_id {
                                Some(mid)
                                    if known_msg_ids.contains(mid.as_str())
                                        || user_msg_ids.contains(mid.as_str()) =>
                                {
                                    continue
                                }
                                _ => {}
                            }

                            match part.part_type.as_str() {
                                "text" => {
                                    if let Some(full_text) = &part.text {
                                        let prev_len =
                                            text_lengths.get(&part.id).copied().unwrap_or(0);
                                        if full_text.len() > prev_len {
                                            let delta = &full_text[prev_len..];
                                            let _ = on_event.send(ChatStreamEvent::Delta {
                                                text: delta.to_string(),
                                            });
                                            text_lengths
                                                .insert(part.id.clone(), full_text.len());
                                        }
                                    }
                                }

                                "tool" => {
                                    let call_id = part.call_id.clone().unwrap_or_default();
                                    let tool_name = part
                                        .tool
                                        .clone()
                                        .unwrap_or_else(|| "unknown".to_string());

                                    if let Some(state) = &part.state {
                                        let status = state
                                            .get("status")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");

                                        let input_json = state
                                            .get("input")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        let is_delegation = tool_name == "mcp_task"
                                            || tool_name == "mcp_delegate_task";
                                        let is_summer = is_delegation
                                            && (input_json.contains("\"sum\"")
                                                || input_json.contains("\"mer\"")
                                                || input_json
                                                    .contains("\"visual-engineering\""));

                                        match status {
                                            "running" => {
                                                if let std::collections::hash_map::Entry::Vacant(
                                                    e,
                                                ) = tool_started
                                                    .entry(call_id.clone())
                                                {
                                                    if is_summer {
                                                        let _ = on_event.send(
                                                            ChatStreamEvent::Status {
                                                                text: "Delegating to Summer..."
                                                                    .to_string(),
                                                            },
                                                        );
                                                    } else if is_delegation {
                                                        let agent = if input_json
                                                            .contains("\"oracle\"")
                                                        {
                                                            "Oracle"
                                                        } else if input_json
                                                            .contains("\"explore\"")
                                                        {
                                                            "exploring"
                                                        } else if input_json
                                                            .contains("\"librarian\"")
                                                        {
                                                            "researching"
                                                        } else if input_json
                                                            .contains("\"frost\"")
                                                        {
                                                            "Frost"
                                                        } else if input_json
                                                            .contains("\"spring\"")
                                                        {
                                                            "Spring"
                                                        } else {
                                                            "subagent"
                                                        };
                                                        let _ = on_event.send(
                                                            ChatStreamEvent::Status {
                                                                text: format!(
                                                                    "Delegating to {}...",
                                                                    agent
                                                                ),
                                                            },
                                                        );
                                                    }
                                                    let _ = on_event.send(
                                                        ChatStreamEvent::ToolStart {
                                                            name: tool_name,
                                                            id: call_id,
                                                        },
                                                    );
                                                    e.insert(true);
                                                }
                                            }
                                            "completed" => {
                                                if let std::collections::hash_map::Entry::Vacant(
                                                    e,
                                                ) = tool_started
                                                    .entry(call_id.clone())
                                                {
                                                    let _ = on_event.send(
                                                        ChatStreamEvent::ToolStart {
                                                            name: tool_name,
                                                            id: call_id.clone(),
                                                        },
                                                    );
                                                    e.insert(true);
                                                }

                                                let output = state
                                                    .get("metadata")
                                                    .and_then(|m| m.get("output"))
                                                    .and_then(|v| v.as_str())
                                                    .or_else(|| {
                                                        state
                                                            .get("output")
                                                            .and_then(|v| v.as_str())
                                                    })
                                                    .unwrap_or("")
                                                    .to_string();

                                                let _ = on_event.send(
                                                    ChatStreamEvent::ToolEnd {
                                                        id: call_id,
                                                        result: output,
                                                    },
                                                );
                                            }
                                            "error" => {
                                                let error_msg = state
                                                    .get("error")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("Tool execution failed")
                                                    .to_string();

                                                let _ = on_event.send(
                                                    ChatStreamEvent::ToolEnd {
                                                        id: call_id,
                                                        result: format!(
                                                            "[error] {}",
                                                            error_msg
                                                        ),
                                                    },
                                                );
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

                                "reasoning" => {
                                    if let Some(full_text) = &part.text {
                                        let prev_len =
                                            text_lengths.get(&part.id).copied().unwrap_or(0);
                                        if full_text.len() > prev_len {
                                            let delta = &full_text[prev_len..];
                                            let _ = on_event.send(ChatStreamEvent::Reasoning {
                                                text: delta.to_string(),
                                            });
                                            text_lengths
                                                .insert(part.id.clone(), full_text.len());
                                        }
                                    }
                                }

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

                                    let role =
                                        info.get("role").and_then(|v| v.as_str()).unwrap_or("");

                                    if role == "user" {
                                        if let Some(mid) =
                                            info.get("id").and_then(|v| v.as_str())
                                        {
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

                                    if role == "assistant" {
                                        let has_error =
                                            info.get("error").map_or(false, |e| !e.is_null());
                                        if has_error {
                                            let mid = info
                                                .get("id")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("");
                                            if !known_msg_ids.contains(mid) {
                                                let error_msg = info
                                                    .get("error")
                                                    .and_then(|e| e.get("name"))
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("Unknown error");
                                                eprintln!(
                                                    "[winter-app] message.updated error={} session={}",
                                                    error_msg, msg_session
                                                );
                                                let _ = on_event.send(ChatStreamEvent::StreamEnd);
                                                return Ok(());
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        "session.idle" => {
                            if let Some(props) = envelope.payload.properties.as_object() {
                                let idle_session = props.get("sessionID")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if idle_session == session_id {
                                    eprintln!("[winter-app] session.idle session={}", session_id);
                                    let _ = on_event.send(ChatStreamEvent::StreamEnd);
                                    return Ok(());
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
