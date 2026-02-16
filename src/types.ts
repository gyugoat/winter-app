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
