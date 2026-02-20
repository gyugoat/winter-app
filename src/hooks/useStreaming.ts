/**
 * useStreaming — AI response streaming with throttled state flushes.
 *
 * Owns `isStreaming` state and the cancel flag.  Handles all Tauri Channel
 * events during a streaming response:
 * - `delta` — appends text (throttled, flushed every 80 ms)
 * - `tool_start` / `tool_end` — appends inline tool output to message
 * - `ollama_status` — appends compression/summarisation notices
 * - `status` — updates the per-message status label (e.g. "thinking")
 * - `usage` — forwards token counts to the provided callback
 * - `stream_end` / `error` — finalises the message and clears streaming flag
 */
import { useState, useCallback, useRef } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { Session, Message, ChatStreamEvent, ImageAttachment, MessageMode, ToolActivity } from '../types';
import { uid } from '../utils/uid';

const TOOL_VERB_MAP: Record<string, string> = {
  bash: 'running...',
  read: 'reading...',
  write: 'writing...',
  edit: 'editing...',
  glob: 'searching...',
  grep: 'searching...',
};

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
}

/**
 * Streaming state and the `streamResponse` action.
 *
 * @returns {@link StreamingAPI} — streaming state + action.
 */
export function useStreaming(): StreamingAPI {
  const [isStreaming, setIsStreaming] = useState(false);
  const cancelledRef = useRef(false);

  /**
   * Initiates an AI streaming response for the given session.
   *
   * Creates a placeholder assistant message immediately, then incrementally
   * updates its `content` as `delta` events arrive (throttled to every 80 ms).
   * Calls `onUsage` with each `usage` event so token counters stay current.
   *
   * @param sessionId - ID of the local session to append the reply to.
   * @param allMessages - All messages in the session including the new user message.
   * @param updateSession - Updater callback from `useSessionStore`.
   * @param onUsage - Callback to forward token-usage deltas.
   * @param ocSessionId - OpenCode session ID; when set, uses `opencode_send`.
   * @param mode - Message mode (`normal` | `search` | `analyze`).
   * @param opencodeConnected - Whether OC is reachable (determines which invoke to call).
   */
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

      // Accumulate content in closure; throttle setState flushes to 80 ms.
      let accumulatedContent = '';
      let currentStatusText: string | undefined = 'thinking';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const toolActivities: ToolActivity[] = [];

      const flushToState = () => {
        flushTimer = null;
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId
              ? { ...m, content: accumulatedContent, statusText: currentStatusText, toolActivities: [...toolActivities] }
              : m
          ),
        }));
      };

      const scheduleFlush = () => {
        if (!flushTimer) {
          flushTimer = setTimeout(flushToState, 80);
        }
      };

      const onEvent = new Channel<ChatStreamEvent>();
      onEvent.onmessage = (event: ChatStreamEvent) => {
        if (cancelledRef.current) return;

        if (event.event === 'delta') {
          accumulatedContent += event.data.text;
          currentStatusText = undefined;
          scheduleFlush();
        } else if (event.event === 'tool_start') {
          const { name, id } = event.data;
          const isMcp = name.startsWith('mcp_');
          const baseName = name.replace(/^mcp_/, '');
          const verb = TOOL_VERB_MAP[baseName] ?? (isMcp ? 'using tool...' : 'running...');
          const activity: ToolActivity = { id, name, status: 'running' };
          currentStatusText = verb;
          toolActivities.push(activity);
          scheduleFlush();
        } else if (event.event === 'tool_end') {
          const { id, result } = event.data;
          const idx = toolActivities.findIndex((t) => t.id === id);
          if (idx !== -1) {
            toolActivities[idx] = { ...toolActivities[idx], status: 'completed', result };
          }
          scheduleFlush();
        } else if (event.event === 'ollama_status') {
          const st = event.data.status;
          const label =
            st === 'compressing' ? '\n*Compressing conversation history...*\n'
            : st === 'summarizing' ? '\n*Summarizing tool output...*\n'
            : '';
          if (label) {
            accumulatedContent += label;
            scheduleFlush();
          }
        } else if (event.event === 'status') {
          currentStatusText = event.data.text;
          scheduleFlush();
        } else if (event.event === 'usage') {
          onUsage({ input: event.data.input_tokens, output: event.data.output_tokens });
        } else if (event.event === 'stream_end') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId
                ? { ...m, content: accumulatedContent, isStreaming: false, statusText: undefined, toolActivities: [...toolActivities] }
                : m
            ),
          }));
          setIsStreaming(false);
        } else if (event.event === 'error') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          const errText = event.data.message;
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId
                ? { ...m, content: `Error: ${errText}`, isStreaming: false, toolActivities: [...toolActivities] }
                : m
            ),
          }));
          setIsStreaming(false);
        }
      };

      const handleError = (err: unknown) => {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId
              ? { ...m, content: `Error: ${err}`, isStreaming: false }
              : m
          ),
        }));
        setIsStreaming(false);
      };

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
          setIsStreaming(false);
          return;
        }
        invoke('opencode_send', {
          ocSessionId,
          content: lastMsg.content,
          mode: mode || 'normal',
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
            if (m.content) {
              blocks.push({ type: 'text', text: m.content });
            }
            return { role: m.role, content: blocks };
          }
          return { role: m.role, content: m.content };
        });

        invoke('chat_send', { messages: apiMessages, onEvent }).catch(handleError);
      }
    },
    []
  );

  return { isStreaming, cancelledRef, streamResponse, setIsStreaming };
}
