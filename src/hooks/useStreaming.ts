/**
 * useStreaming — AI response streaming, handler-map architecture.
 *
 * Events are dispatched through a module-level Record<string, handler> map.
 * Per-turn state lives in a single TurnState closure object created by startTurn().
 * React state flushes are batched via requestAnimationFrame instead of setTimeout.
 */
import { useState, useCallback, useRef } from 'react';
import { invoke, createChannel } from '../utils/invoke-shim';
import type { Session, Message, ChatStreamEvent, ImageAttachment, MessageMode, ToolActivity } from '../types';
import { uid } from '../utils/uid';
import { playMakima } from './useMakimaSound';

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
  /** The session ID currently being streamed to (null when idle). */
  streamingSessionId: string | null;
  cancelledRef: React.MutableRefObject<boolean>;
  /** Cancels the active stream by setting cancelledRef AND invalidating the stream ID. */
  cancelStream: () => void;
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
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const lastStreamEndRef = useRef<number>(0);
  // Each streamResponse call gets a unique ID. The onmessage handler only
  // proceeds if activeStreamIdRef still matches the ID it was created with.
  // This prevents stale cancel signals from killing a new stream.
  const activeStreamIdRef = useRef<string | null>(null);

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
      setStreamingSessionId(sessionId);
      cancelledRef.current = false;
      const myStreamId = uid();
      activeStreamIdRef.current = myStreamId;
      console.log('[useStreaming] stream started, streamId:', myStreamId, 'cancelledRef set to FALSE');

      const replyId = uid();
      console.log('[useStreaming] streamResponse called, sessionId:', sessionId, 'replyId:', replyId, 'ocSessionId:', ocSessionId);
      const replyMsg: Message = {
        id: replyId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      updateSession(sessionId, (s) => {
        console.log('[useStreaming] Adding reply placeholder, session msgs:', s.messages.length, 'sessionId match:', s.id === sessionId);
        return {
          ...s,
          messages: [...s.messages, { ...replyMsg, statusText: 'thinking' }],
        };
      });

      // Per-turn mutable state
      const turn = startTurn();

      // Flush coalescing — uses rAF when tab is visible, setTimeout when hidden.
      // rAF pauses in background tabs, so we fall back to setTimeout(0) to keep
      // SSE-driven state updates (and especially finalize/sound) flowing.
      let flushId: number | null = null;
      let flushIsRAF = false;

      const flushToState = () => {
        flushId = null;
        flushIsRAF = false;
        console.log('[useStreaming] flushToState, turn.content length:', turn.content.length, 'done:', turn.done, 'tools:', turn.tools.length);
        updateSession(sessionId, (s) => {
          const found = s.messages.some((m) => m.id === replyId);
          console.log('[useStreaming] updateSession in flush, replyId found:', found, 'session.id:', s.id);
          return {
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
          };
        });
      };

      const cancelFlush = () => {
        if (flushId !== null) {
          if (flushIsRAF) cancelAnimationFrame(flushId);
          else clearTimeout(flushId);
          flushId = null;
          flushIsRAF = false;
        }
      };

      const scheduleFlush = () => {
        if (flushId !== null) return;
        if (document.hidden) {
          // Background tab — rAF won't fire, use setTimeout
          flushIsRAF = false;
          flushId = window.setTimeout(flushToState, 0);
        } else {
          flushIsRAF = true;
          flushId = requestAnimationFrame(flushToState);
        }
      };

      // Single end-of-stream function for all termination paths
      const finalize = (ts: TurnState) => {
        cancelFlush();

        if (ts.error) {
          // Truncate to prevent huge base64 image data from flooding the chat
          const errText = ts.error.length > 500
            ? ts.error.slice(0, 500) + '... (truncated)'
            : ts.error;
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId
                ? { ...m, content: `Error: ${errText}`, isStreaming: false, toolActivities: [...ts.tools] }
                : m
            ),
          }));
          playMakima('error');
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
          playMakima('done');
        }

        lastStreamEndRef.current = Date.now();
        setIsStreaming(false);
        setStreamingSessionId(null);
        // Trigger immediate save — bypasses useSessionStore's debounce
        window.dispatchEvent(new Event('winter-flush-save'));
      };

      const onEvent = createChannel<ChatStreamEvent>();
      onEvent.onmessage = (event: ChatStreamEvent) => {
        const isStale = activeStreamIdRef.current !== myStreamId;
        const isCancelled = cancelledRef.current;
        console.log('[useStreaming] onmessage received:', event.event,
          'cancelled:', isCancelled, 'stale:', isStale,
          'streamId:', myStreamId, 'activeStreamId:', activeStreamIdRef.current,
          'turn.done:', turn.done);
        // Only honour cancellation if BOTH the cancel flag is set AND this
        // stream is no longer the active one (stale).  A cancel flag alone
        // could be a leftover from a previous stream that raced with our
        // initialization.  An explicit abort (abortOpencode) sets cancel=true
        // AND clears activeStreamIdRef, so both conditions hold.
        if (isCancelled && isStale) {
          console.log('[useStreaming] stream cancelled+stale, finalizing');
          finalize(turn);
          return;
        }

        const key = event.event;
        if (key in HANDLERS) {
          const data = 'data' in event ? (event as { event: string; data: unknown }).data : {};
          (HANDLERS as Record<string, (d: unknown, s: TurnState, cb: UsageCb) => void>)[key](data, turn, onUsage);
        }

        if (turn.done) {
          console.log('[useStreaming] turn.done, calling finalize');
          finalize(turn);
        } else {
          console.log('[useStreaming] scheduleFlush, flushId:', flushId, 'hidden:', document.hidden, 'turn.content.length:', turn.content.length);
          scheduleFlush();
        }
      };

      const handleError = (err: unknown) => {
        cancelFlush();
        // Truncate error messages to prevent huge base64 data from flooding the UI
        let errMsg = String(err);
        if (errMsg.length > 500) {
          errMsg = errMsg.slice(0, 500) + '... (truncated)';
        }
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId
              ? { ...m, content: `Error: ${errMsg}`, isStreaming: false }
              : m
          ),
        }));
        playMakima('error');
        lastStreamEndRef.current = Date.now();
        setIsStreaming(false);
        setStreamingSessionId(null);
      };

      // ── OpenCode vs Claude invoke branching ───────────────────────────────

      if (opencodeConnected && ocSessionId) {
        const lastMsg = allMessages[allMessages.length - 1];
        // Convert images to [mediaType, base64Data] tuples for Rust → OpenCode "file" parts
        const imageTuples: [string, string][] | undefined =
          lastMsg.images && lastMsg.images.length > 0
            ? lastMsg.images.map((img: ImageAttachment) => [img.mediaType, img.data] as [string, string])
            : undefined;
        invoke('opencode_send', {
          ocSessionId,
          content: lastMsg.content,
          images: imageTuples,
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

  const cancelStream = useCallback(() => {
    console.log('[useStreaming] cancelStream called, clearing streamId:', activeStreamIdRef.current);
    cancelledRef.current = true;
    activeStreamIdRef.current = null;
  }, []);

  return { isStreaming, streamingSessionId, cancelledRef, cancelStream, streamResponse, setIsStreaming, lastStreamEndRef };
}
