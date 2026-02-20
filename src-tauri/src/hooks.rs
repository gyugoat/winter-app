/// Hookify integration — checks tool calls against `.winter/hooks/check.py`
/// before execution. Fail-open: any error returns `allow`.
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Hook timeout — if the check.py process doesn't respond in 5s, fail-open.
const HOOK_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Serialize)]
struct HookInput {
    tool_name: String,
    tool_input: serde_json::Value,
}

/// The parsed result from `.winter/hooks/check.py`.
#[derive(Debug, Deserialize)]
pub struct HookResult {
    /// "block", "warn", or "allow"
    pub action: String,
    pub message: Option<String>,
    pub rule: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    pub error: bool,
}

impl HookResult {
    fn allow() -> Self {
        HookResult {
            action: "allow".to_string(),
            message: None,
            rule: None,
            error: false,
        }
    }

    #[allow(dead_code)]
    fn block(message: String) -> Self {
        HookResult {
            action: "block".to_string(),
            message: Some(message),
            rule: None,
            error: false,
        }
    }
}

pub struct HookGuard;

impl HookGuard {
    /// Check a tool call against hookify rules.
    /// Spawns `python3 {workspace}/.winter/hooks/check.py`, pipes JSON to stdin,
    /// reads JSON from stdout. Times out after 5 seconds. Any failure → allow.
    pub fn check(tool_name: &str, tool_input: &serde_json::Value, workspace: &str) -> HookResult {
        let hook_script = format!("{}/.winter/hooks/check.py", workspace);

        // If the hook script doesn't exist, allow immediately.
        if !std::path::Path::new(&hook_script).exists() {
            return HookResult::allow();
        }

        let input = HookInput {
            tool_name: tool_name.to_string(),
            tool_input: tool_input.clone(),
        };
        let input_json = match serde_json::to_string(&input) {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[hooks] Failed to serialize hook input: {}", e);
                return HookResult::allow();
            }
        };

        // Spawn python3 with stdin/stdout piped.
        let mut child = match Command::new("python3")
            .arg(&hook_script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[hooks] Failed to spawn check.py: {}", e);
                return HookResult::allow();
            }
        };

        // Write JSON to stdin.
        if let Some(stdin) = child.stdin.take() {
            let mut stdin = stdin;
            if let Err(e) = stdin.write_all(input_json.as_bytes()) {
                eprintln!("[hooks] Failed to write to check.py stdin: {}", e);
                let _ = child.kill();
                return HookResult::allow();
            }
        }

        // Wait with timeout using a thread + channel.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = child.wait_with_output();
            let _ = tx.send(result);
        });

        let output = match rx.recv_timeout(Duration::from_secs(HOOK_TIMEOUT_SECS)) {
            Ok(Ok(out)) => out,
            Ok(Err(e)) => {
                eprintln!("[hooks] check.py process error: {}", e);
                return HookResult::allow();
            }
            Err(_) => {
                eprintln!("[hooks] check.py timed out after {}s", HOOK_TIMEOUT_SECS);
                return HookResult::allow();
            }
        };

        if !output.status.success() {
            eprintln!(
                "[hooks] check.py exited with status {}",
                output.status.code().unwrap_or(-1)
            );
            return HookResult::allow();
        }

        let stdout = match std::str::from_utf8(&output.stdout) {
            Ok(s) => s.trim(),
            Err(e) => {
                eprintln!("[hooks] check.py output is not valid UTF-8: {}", e);
                return HookResult::allow();
            }
        };

        if stdout.is_empty() {
            return HookResult::allow();
        }

        match serde_json::from_str::<HookResult>(stdout) {
            Ok(result) => {
                if result.action == "block" {
                    let msg = result.message.clone().unwrap_or_else(|| "Blocked by hook".to_string());
                    eprintln!("[hooks] BLOCKED tool '{}': {}", tool_name, msg);
                } else if result.action == "warn" {
                    eprintln!(
                        "[hooks] WARN tool '{}': {}",
                        tool_name,
                        result.message.as_deref().unwrap_or("no message")
                    );
                }
                result
            }
            Err(e) => {
                eprintln!("[hooks] Failed to parse check.py output: {} (raw: {})", e, stdout);
                HookResult::allow()
            }
        }
    }

    /// Returns a blocked tool result content string for use in the conversation.
    pub fn block_message(result: &HookResult, tool_name: &str) -> String {
        let msg = result
            .message
            .as_deref()
            .unwrap_or("Tool execution blocked by hookify rules.");
        let rule = result.rule.as_deref().unwrap_or("unknown");
        format!(
            "[BLOCKED] Tool '{}' was blocked by hookify (rule: {}). Message: {}",
            tool_name, rule, msg
        )
    }
}
