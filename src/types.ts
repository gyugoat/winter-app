export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface Session {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  archived?: boolean;
}

export type ChatStreamEvent =
  | { event: 'stream_start' }
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool_start'; data: { name: string; id: string } }
  | { event: 'tool_end'; data: { id: string; result: string } }
  | { event: 'stream_end' }
  | { event: 'error'; data: { message: string } };
