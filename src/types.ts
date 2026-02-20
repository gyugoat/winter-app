/**
 * Core type definitions for the Winter app.
 * Shared across components and hooks.
 */

/** A single image attachment encoded as base64 */
export interface ImageAttachment {
  /** MIME type of the image (e.g. "image/png") */
  mediaType: string;
  /** Base64-encoded image data (no data: URL prefix) */
  data: string;
}

/** A single chat message, either from the user or the AI assistant */
export interface Message {
  /** Unique message ID (used as React key and markdown cache key) */
  id: string;
  /** Who sent this message */
  role: 'user' | 'assistant';
  /** Text content of the message */
  content: string;
  /** Unix timestamp (ms) when the message was created */
  timestamp: number;
  /** True while the AI is still generating this message */
  isStreaming?: boolean;
  /** Short status label shown during streaming (e.g. "thinking") */
  statusText?: string;
  /** Images attached to this message (user uploads) */
  images?: ImageAttachment[];
  /** Tool calls made during generation */
  toolActivities?: ToolActivity[];
  /** AI reasoning/thinking text — shown in collapsible "Inner voice" */
  reasoning?: string;
}

/** A chat session containing an ordered list of messages */
export interface Session {
  /** Unique session ID */
  id: string;
  /** Human-readable session name (derived from first message) */
  name: string;
  /** All messages in this session, in chronological order */
  messages: Message[];
  /** Unix timestamp (ms) when the session was created */
  createdAt: number;
  /** If true, this session has been moved to the archive */
  archived?: boolean;
  /** OpenCode server session ID for server-side context */
  ocSessionId?: string;
}

/**
 * Union type for all SSE events streamed from the backend during AI generation.
 * Each variant has a discriminant `event` field for narrowing.
 */
export type ChatStreamEvent =
  | { event: 'stream_start' }
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool_start'; data: { name: string; id: string } }
  | { event: 'tool_end'; data: { id: string; result: string } }
  | { event: 'stream_end' }
  | { event: 'error'; data: { message: string } }
  | { event: 'ollama_status'; data: { status: string } }
  | { event: 'status'; data: { text: string } }
  | { event: 'usage'; data: { input_tokens: number; output_tokens: number } }
  | { event: 'reasoning'; data: { text: string } };

// ── Tool Activity ──

/** Current execution state of a tool call */
export type ToolStatus = 'running' | 'completed' | 'error';

/** Represents a single tool invocation during AI generation */
export interface ToolActivity {
  /** Unique tool call ID matching tool_start/tool_end events */
  id: string;
  /** Raw tool name (e.g. "mcp_bash", "read") */
  name: string;
  /** Current execution state */
  status: ToolStatus;
  /** Tool output/result, available after completion */
  result?: string;
}

// ── File Changes ──

/** Represents a file that was modified during the session */
export interface FileChange {
  /** Relative path from working directory */
  path: string;
  /** Absolute filesystem path */
  absolute?: string;
  /** Type of change made to this file */
  status: 'added' | 'modified' | 'deleted';
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
}

/** Full diff for a single file, split into hunks */
export interface FileDiff {
  /** File path */
  path: string;
  /** Full file content before changes (null for new files) */
  before: string | null;
  /** Full file content after changes (null for deleted files) */
  after: string | null;
  /** Individual diff hunks */
  hunks: DiffHunk[];
}

/** A contiguous block of changed lines in a diff */
export interface DiffHunk {
  /** Unified diff header (e.g. "@@ -10,7 +10,8 @@") */
  header: string;
  /** All lines in this hunk, including context lines */
  lines: DiffLine[];
}

/** A single line within a diff hunk */
export interface DiffLine {
  /** Whether this line was added, deleted, or unchanged context */
  type: 'addition' | 'deletion' | 'context';
  /** The line content (without the +/- prefix) */
  content: string;
  /** Line number in the original file (undefined for additions) */
  oldLineNumber?: number;
  /** Line number in the new file (undefined for deletions) */
  newLineNumber?: number;
}

/** A node in the file tree, representing either a file or directory */
export interface FileTreeNode {
  /** Display name (last segment of the path) */
  name: string;
  /** Full path (relative or absolute depending on view mode) */
  path: string;
  /** Whether this node is a file or a directory */
  type: 'file' | 'directory';
  /** Child nodes (only present for directories) */
  children?: FileTreeNode[];
  /** Associated file change, if any (shows colored status dot) */
  change?: FileChange;
}

// ── Agent System ──

/** AI agent configuration for multi-agent switching */
export interface Agent {
  /** Unique agent identifier (used for routing and storage) */
  id: string;
  /** Human-readable display name (may include emoji) */
  name: string;
  /** Avatar image path or URL */
  avatar: string;
  /** Proxy port this agent listens on */
  proxyPort: number;
  /** Working directory for this agent's workspace */
  workspace: string;
  /** Accent color for the agent tab (hex string) */
  color: string;
  /** Agent runtime type */
  type: 'opencode' | 'external';
}

/** Message send mode — controls prefix injection behavior on the backend */
export type MessageMode = 'normal' | 'search' | 'analyze';
