/// Types for the OpenCode session API and SSE event stream.
/// These map directly to the JSON structures returned by the OpenCode server.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── Session Types ──────────────────────────────────────────────────

/// Timestamps for when an OpenCode session was created and last updated.
#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct OcSessionTime {
    /// Unix timestamp (milliseconds) when the session was created.
    pub created: u64,
    /// Unix timestamp (milliseconds) of the last session update.
    pub updated: u64,
}

/// An OpenCode session object returned by the session API.
#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct OcSession {
    /// Unique session identifier used in all subsequent API calls.
    pub id: String,
    /// URL-safe slug for the session (optional).
    #[serde(default)]
    pub slug: Option<String>,
    /// Human-readable session title (optional).
    #[serde(default)]
    pub title: Option<String>,
    /// Session timestamps (optional).
    #[serde(default)]
    pub time: Option<OcSessionTime>,
}

// ── SSE Event Parts ────────────────────────────────────────────────

/// A single message part from the OpenCode SSE event stream.
/// Represents incremental text, tool calls, or step markers from the assistant.
#[derive(Debug, Deserialize, Clone)]
pub struct SseMessagePart {
    /// Unique ID of this message part.
    pub id: String,
    /// The session this part belongs to.
    #[serde(rename = "sessionID")]
    pub session_id: String,
    /// The message this part is attached to (optional until committed).
    #[serde(rename = "messageID", default)]
    pub message_id: Option<String>,
    /// Part type: "text", "tool", "step-start", "reasoning", etc.
    #[serde(rename = "type")]
    pub part_type: String,
    /// Text content for "text" parts.
    #[serde(default)]
    pub text: Option<String>,
    /// Tool name for "tool" parts.
    #[serde(default)]
    pub tool: Option<String>,
    /// Tool call ID for "tool" parts.
    #[serde(rename = "callID", default)]
    pub call_id: Option<String>,
    /// Tool state JSON (input, output, status) for "tool" parts.
    #[serde(default)]
    pub state: Option<Value>,
}

// ── SSE Envelope ──────────────────────────────────────────────────

/// The inner payload of an SSE event from OpenCode.
#[derive(Debug, Deserialize)]
pub struct SsePayload {
    /// Event type string (e.g. "message.part.updated", "message.updated").
    #[serde(rename = "type")]
    pub event_type: String,
    /// Event-specific properties, structure varies by event_type.
    #[serde(default)]
    pub properties: Value,
}

/// The outer wrapper of an OpenCode SSE event.
/// The stream sends `data: <json>` lines where each JSON is this structure.
#[derive(Debug, Deserialize)]
pub struct SseEnvelope {
    /// The inner event payload.
    pub payload: SsePayload,
}
