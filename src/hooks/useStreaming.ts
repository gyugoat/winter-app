/**
 * useStreaming — AI response streaming, handler-map architecture.
 *
 * Events are dispatched through a module-level Record<string, handler> map.
 * Per-turn state lives in a single TurnState closure object created by startTurn().
 * React state flushes are batched via requestAnimationFrame instead of setTimeout.
 */
import { useState, useCallback, useRef } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { Session, Message, ChatStreamEvent, ImageAttachment, MessageMode, ToolActivity } from '../types';
import { uid } from '../utils/uid';

// ── Constants ──────────────────────────────────────────────────────────────

const TOOL_VERB_MAP: Record<string, string> = {
  bash: 'running...',
  read: 'reading...',
  write: 'writing...',
  edit: 'editing...',
  glob: 'searching...',
  grep: 'searching...',
};

function toolVerb(name: string): string {
  const isMcp = name.startsWith('mcp_');
  const base = name.replace(/^mcp_/, '');
  return TOOL_VERB_MAP[base] ?? (isMcp ? 'using tool...' : 'running...');
}

// ── TurnState ──────────────────────────────────────────────────────────────

interface TurnState {
  content: string;
  reasoning: string;
  status: string | undefined;
  tools: ToolActivity[];
  done: boolean;
  error: string | undefined;
}

function startTurn(): TurnState {
  return { content: '', reasoning: '', status: 'thinking', tools: [], done: false, error: undefined };
}

// ── Handler map (module-level — never recreated) ───────────────────────────

type UsageCb = (d: { input: number; output: number }) => void;

type HandlerMap = {
  [K in ChatStreamEvent['event']]: (
    data: Extract<ChatStreamEvent, { event: K }> extends { data: infer D } ? D : Record<string, never>,
    state: TurnState,
    onUsage: UsageCb
  ) => void;
};

const HANDLERS: HandlerMap = {
  delta(d: { text: string }, s) {
    s.content += d.text;
    s.status = undefined;
  },

  tool_start(d: { id: string; name: string }, s) {
    s.tools.push({ id: d.id, name: d.name, status: 'running' });
    s.status = toolVerb(d.name);
  },

  tool_end(d: { id: string; result: string }, s) {
    const t = s.tools.find((t) => t.id === d.id);
    if (t) { t.status = 'completed'; t.result = d.result; }
  },

  ollama_status(d: { status: string }, s) {
    const label =
      d.status === 'compressing' ? '\n*Compressing conversation history...*\n'
      : d.status === 'summarizing' ? '\n*Summarizing tool output...*\n'
      : '';
    if (label) s.content += label;
  },

  status(d: { text: string }, s) {
    s.status = d.text;
  },

  reasoning(d: { text: string }, s) {
    s.reasoning += d.text;
  },

  usage(d: { input_tokens: number; output_tokens: number }, _s, onUsage) {
    onUsage({ input: d.input_tokens, output: d.output_tokens });
  },

  stream_end(_d, s) {
    s.done = true;
  },

  stream_start(_d, _s) {},

  error(d: { message: string }, s) {
    s.error = d.message;
    s.done = true;
  },
};

// ── Public interface ───────────────────────────────────────────────────────

/** Public interface returned by useStreaming. */
export interface StreamingAPI {
  isStreaming: boolean;
  cancelledRef: React.MutableRefObject<boolean>;
  streamResponse: (
    sessionId: string,
    allMessages: Message[],
    updateSession: (id: string, updater: (s: Session) => Session) => void,
    onUsage: (delta: { input: number; output: number }) => void,
    ocSessionId?: string,
    mode?: MessageMode,
    opencodeConnected?: boolean
  ) => void;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  lastStreamEndRef: React.MutableRefObject<number>;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useStreaming(): StreamingAPI {
  const [isStreaming, setIsStreaming] = useState(false);
  const cancelledRef = useRef(false);
  const lastStreamEndRef = useRef<number>(0);

  const streamResponse = useCallback(
    (
      sessionId: string,
      allMessages: Message[],
      updateSession: (id: string, updater: (s: Session) => Session) => void,
      onUsage: (delta: { input: number; output: number }) => void,
      ocSessionId?: string,
      mode?: MessageMode,
      opencodeConnected?: boolean
    ) => {
      setIsStreaming(true);
      cancelledRef.current = false;

      const replyId = uid();
      const replyMsg: Message = {
        id: replyId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, { ...replyMsg, statusText: 'thinking' }],
      }));

      // Per-turn mutable state
      const turn = startTurn();

      // rAF-based flush — coalesces rapid updates into a single paint
      let rafId: number | null = null;

      const flushToState = () => {
        rafId = null;
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId
              ? {
                  ...m,
                  content: turn.content,
                  statusText: turn.status,
                  toolActivities: [...turn.tools],
                  reasoning: turn.reasoning || undefined,
                }
              : m
          ),
        }));
      };

      const scheduleFlush = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(flushToState);
      };

      // Single end-of-stream function for all termination paths
      const finalize = (ts: TurnState) => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

        if (ts.error) {
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId
                ? { ...m, content: `Error: ${ts.error}`, isStreaming: false, toolActivities: [...ts.tools] }
                : m
            ),
          }));
        } else if (!ts.content.trim()) {
          // No text received — remove placeholder rather than leave an empty diamond
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.filter((m) => m.id !== replyId),
          }));
        } else {
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId
                ? {
                    ...m,
                    content: ts.content,
                    isStreaming: false,
                    statusText: undefined,
                    toolActivities: [...ts.tools],
                    reasoning: ts.reasoning || undefined,
                  }
                : m
            ),
          }));
        }

        lastStreamEndRef.current = Date.now();
        setIsStreaming(false);
      };

      const onEvent = new Channel<ChatStreamEvent>();
      onEvent.onmessage = (event: ChatStreamEvent) => {
        if (cancelledRef.current) {
          finalize(turn);
          return;
        }

        const key = event.event;
        if (key in HANDLERS) {
          const data = 'data' in event ? (event as { event: string; data: unknown }).data : {};
          (HANDLERS as Record<string, (d: unknown, s: TurnState, cb: UsageCb) => void>)[key](data, turn, onUsage);
        }

        if (turn.done) {
          finalize(turn);
        } else {
          scheduleFlush();
        }
      };

      const handleError = (err: unknown) => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId
              ? { ...m, content: `Error: ${err}`, isStreaming: false }
              : m
          ),
        }));
        lastStreamEndRef.current = Date.now();
        setIsStreaming(false);
      };

      // ── OpenCode vs Claude invoke branching ───────────────────────────────

      if (opencodeConnected && ocSessionId) {
        const lastMsg = allMessages[allMessages.length - 1];
        if (lastMsg.images && lastMsg.images.length > 0) {
          console.warn('[useStreaming] Images are not supported in OpenCode mode and will not be sent.');
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId
                ? { ...m, content: '⚠️ Image attachments are not supported in OpenCode mode.', isStreaming: false }
                : m
            ),
          }));
          lastStreamEndRef.current = Date.now();
          setIsStreaming(false);
          return;
        }
        invoke('opencode_send', {
          ocSessionId,
          content: lastMsg.content,
          mode: mode ?? 'normal',
          onEvent,
        }).catch(handleError);
      } else {
        const apiMessages = allMessages.map((m) => {
          if (m.images && m.images.length > 0) {
            const blocks: Array<
              | { type: 'image'; source: { type: string; media_type: string; data: string } }
              | { type: 'text'; text: string }
            > = m.images.map((img: ImageAttachment) => ({
              type: 'image' as const,
              source: { type: 'base64', media_type: img.mediaType, data: img.data },
            }));
            if (m.content) blocks.push({ type: 'text', text: m.content });
            return { role: m.role, content: blocks };
          }
          return { role: m.role, content: m.content };
        });

        invoke('chat_send', { messages: apiMessages, onEvent }).catch(handleError);
      }
    },
    []
  );

  return { isStreaming, cancelledRef, streamResponse, setIsStreaming, lastStreamEndRef };
}
