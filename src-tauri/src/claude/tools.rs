/// Tool definitions and execution logic for Claude's function-calling interface.
/// Provides shell execution, file I/O, and directory listing capabilities.

use serde_json::{json, Value};
use std::time::Duration;

/// Maximum execution time for shell commands before timeout.
const SHELL_TIMEOUT: Duration = Duration::from_secs(120);

/// Maximum output size captured from shell commands (512 KB).
const MAX_OUTPUT: usize = 512 * 1024;

/// Returns the JSON schema definitions for all tools available to Claude.
/// These are sent with every API request to declare the callable tool set.
pub fn tool_definitions() -> Value {
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

/// Executes a named tool with the given JSON input arguments.
/// Returns `(output, is_error)` — if `is_error` is true, the output is an error message.
/// Dispatches to `shell_exec`, `file_read`, `file_write`, or `file_list`.
pub async fn execute_tool(name: &str, input: &Value) -> (String, bool) {
    match name {
        "shell_exec" => exec_shell(input).await,
        "file_read" => read_file(input).await,
        "file_write" => write_file(input).await,
        "file_list" => list_dir(input).await,
        _ => (format!("Unknown tool: {}", name), true),
    }
}

/// Executes a bash shell command with timeout and dangerous-pattern blocking.
/// Returns stdout/stderr merged, truncated to MAX_OUTPUT bytes.
async fn exec_shell(input: &Value) -> (String, bool) {
    let cmd = input["command"].as_str().unwrap_or("");

    let blocked = [
        "rm -rf /", "rm -rf ~", "mkfs.", "dd if=", ":(){", "fork bomb",
        "> /dev/sd", "chmod -R 777 /", "curl|bash", "wget|bash", "curl|sh", "wget|sh",
    ];
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

    match tokio::time::timeout(SHELL_TIMEOUT, child).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let mut result = String::new();
            if !stdout.is_empty() {
                result.push_str(&stdout);
            }
            if !stderr.is_empty() {
                if !result.is_empty() {
                    result.push('\n');
                }
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

/// Reads a file at the given path and returns its contents as a string.
async fn read_file(input: &Value) -> (String, bool) {
    let path = input["path"].as_str().unwrap_or("");
    match tokio::fs::read_to_string(path).await {
        Ok(content) => (content, false),
        Err(e) => (format!("Error reading {}: {}", path, e), true),
    }
}

/// Writes content to the given file path, creating parent directories as needed.
async fn write_file(input: &Value) -> (String, bool) {
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

/// Lists files and subdirectories at the given path, sorted alphabetically.
/// Directories are indicated with a trailing `/`.
async fn list_dir(input: &Value) -> (String, bool) {
    let path = input["path"].as_str().unwrap_or(".");
    match tokio::fs::read_dir(path).await {
        Ok(mut entries) => {
            let mut items = Vec::new();
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry
                    .file_type()
                    .await
                    .map(|ft| ft.is_dir())
                    .unwrap_or(false);
                items.push(if is_dir {
                    format!("{}/", name)
                } else {
                    name
                });
            }
            items.sort();
            (items.join("\n"), false)
        }
        Err(e) => (format!("Error listing {}: {}", path, e), true),
    }
}
