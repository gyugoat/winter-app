export interface ImageAttachment {
  mediaType: string;
  data: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  statusText?: string;
  images?: ImageAttachment[];
}

export interface Session {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  archived?: boolean;
  ocSessionId?: string;
}

export type ChatStreamEvent =
  | { event: 'stream_start' }
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool_start'; data: { name: string; id: string } }
  | { event: 'tool_end'; data: { id: string; result: string } }
  | { event: 'stream_end' }
  | { event: 'error'; data: { message: string } }
  | { event: 'ollama_status'; data: { status: string } }
  | { event: 'status'; data: { text: string } }
  | { event: 'usage'; data: { input_tokens: number; output_tokens: number } };

// ── Tool Activity ──

export type ToolStatus = 'running' | 'completed' | 'error';

export interface ToolActivity {
  id: string;
  name: string;
  status: ToolStatus;
  result?: string;
}

// ── File Changes ──

export interface FileChange {
  path: string;
  absolute?: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  before: string | null;
  after: string | null;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'addition' | 'deletion' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  change?: FileChange;
}
