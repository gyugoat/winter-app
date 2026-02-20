/// Core message and streaming types for the Claude API.
/// All types here are serialized/deserialized as part of the Anthropic Messages API contract.
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── Message Content ────────────────────────────────────────────────

/// The content of a chat message — either plain text or a list of structured blocks.
/// Used when constructing messages for the Claude API.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum MessageContent {
    /// A simple text string message.
    Text(String),
    /// A list of typed content blocks (text, images, tool use/results).
    Blocks(Vec<ContentBlock>),
}

// ── Image ──────────────────────────────────────────────────────────

/// Source descriptor for an inline image in a Claude message.
/// Contains base64-encoded image data and its MIME type.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageSource {
    /// The source type (always "base64" for inline images).
    #[serde(rename = "type")]
    pub source_type: String,
    /// MIME type of the image (e.g. "image/png", "image/jpeg").
    pub media_type: String,
    /// Base64-encoded image data.
    pub data: String,
}

// ── Content Blocks ─────────────────────────────────────────────────

/// A single typed block within a structured message.
/// Used in multi-modal messages and tool-use conversations.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum ContentBlock {
    /// A text fragment in the conversation.
    #[serde(rename = "text")]
    Text {
        /// The text content.
        text: String,
    },
    /// An inline image.
    #[serde(rename = "image")]
    Image {
        /// Source descriptor with encoded image data.
        source: ImageSource,
    },
    /// A tool invocation by the assistant.
    #[serde(rename = "tool_use")]
    ToolUse {
        /// Unique identifier for this tool call, used to match with ToolResult.
        id: String,
        /// Name of the tool being invoked.
        name: String,
        /// JSON input arguments for the tool.
        input: Value,
    },
    /// The result of a previous tool invocation, sent back to the assistant.
    #[serde(rename = "tool_result")]
    ToolResult {
        /// ID of the matching ToolUse block.
        tool_use_id: String,
        /// String output from the tool execution.
        content: String,
        /// If true, indicates the tool returned an error.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

// ── Chat Message ───────────────────────────────────────────────────

/// A single message in a Claude conversation.
/// The `role` is either "user" or "assistant".
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    /// The role of the speaker — "user" or "assistant".
    pub role: String,
    /// The message content, either plain text or structured blocks.
    pub content: MessageContent,
}

// ── Streaming Events ───────────────────────────────────────────────

/// Events emitted from the Claude streaming API to the Tauri frontend via IPC channel.
/// Each variant maps to a UI update (delta text, tool notification, usage stats, etc.).
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum ChatStreamEvent {
    /// Emitted once at the start of a new streaming response.
    #[serde(rename = "stream_start")]
    StreamStart,
    /// A text delta — append to the current assistant message.
    #[serde(rename = "delta")]
    Delta {
        /// Incremental text to append.
        text: String,
    },
    /// A tool call has started.
    #[serde(rename = "tool_start")]
    ToolStart {
        /// Name of the tool being invoked.
        name: String,
        /// Unique ID for this tool call.
        id: String,
    },
    /// A tool call has completed.
    #[serde(rename = "tool_end")]
    ToolEnd {
        /// ID of the completed tool call.
        id: String,
        /// String output from the tool.
        result: String,
    },
    /// The streaming response has finished.
    #[serde(rename = "stream_end")]
    StreamEnd,
    /// An error occurred during streaming.
    #[serde(rename = "error")]
    Error {
        /// Human-readable error description.
        message: String,
    },
    /// Ollama local model status update (compression, summarization).
    /// Kept for backward compatibility — new code emits CompactionStatus instead.
    #[allow(dead_code)]
    #[serde(rename = "ollama_status")]
    OllamaStatus {
        /// Status string (e.g. "compressing", "done", "compression_failed").
        status: String,
    },
    #[serde(rename = "compaction_status")]
    CompactionStatus {
        status: String,
        provider: String,
    },
    #[serde(rename = "reasoning")]
    Reasoning { text: String },
    /// General status text (e.g. "thinking", agent delegation status).
    #[serde(rename = "status")]
    Status {
        /// Status message to display in the UI.
        text: String,
    },
    /// Token usage report for the current message turn.
    #[serde(rename = "usage")]
    Usage {
        /// Number of input tokens consumed.
        input_tokens: u64,
        /// Number of output tokens generated.
        output_tokens: u64,
    },
}

// ── Internal Streaming Result ──────────────────────────────────────

/// Internal result type accumulated during a single Claude streaming request.
/// Contains all text output, tool calls, and the stop reason from one API round.
#[derive(Debug)]
pub struct StreamedResponse {
    /// All text content produced by the assistant in this round.
    pub text_content: String,
    /// Tool calls as `(id, name, input_json)` tuples.
    pub tool_uses: Vec<(String, String, String)>,
    /// API stop reason (e.g. "end_turn", "tool_use", "aborted").
    pub stop_reason: String,
}
