import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Message, Session, ChatStreamEvent, ImageAttachment } from '../types';

const STORE_FILE = 'sessions.json';
const STORE_KEY_SESSIONS = 'sessions';
const STORE_KEY_ACTIVE = 'active_session_id';
const STORE_KEY_IS_DRAFT = 'is_draft';
const STORE_KEY_WEEKLY_USAGE = 'weekly_usage';
const STORE_KEY_WEEKLY_RESET = 'weekly_reset_at';
const SAVE_DEBOUNCE_MS = 500;

function getWeekStart(): number {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
  return monday.getTime();
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createSession(name: string): Session {
  return {
    id: uid(),
    name,
    messages: [],
    createdAt: Date.now(),
  };
}

/** Validate that loaded data is actually a Session[] */
function isValidSessions(data: unknown): data is Session[] {
  if (!Array.isArray(data)) return false;
  return data.every(
    (s) =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as Session).id === 'string' &&
      typeof (s as Session).name === 'string' &&
      Array.isArray((s as Session).messages) &&
      typeof (s as Session).createdAt === 'number'
  );
}

export function useChat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [usage, setUsage] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [weeklyUsage, setWeeklyUsage] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [opencodeConnected, setOpencodeConnected] = useState(false);
  const sessionCounter = useRef(0);
  const storeRef = useRef<Store | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load sessions from store on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        storeRef.current = store;

        const savedSessions = await store.get<Session[]>(STORE_KEY_SESSIONS);
        const savedActive = await store.get<string | null>(STORE_KEY_ACTIVE);
        const savedIsDraft = await store.get<boolean>(STORE_KEY_IS_DRAFT);

        if (isValidSessions(savedSessions) && savedSessions.length > 0) {
          // Strip isStreaming from any messages (in case app crashed mid-stream)
          const cleanSessions = savedSessions.map((s) => ({
            ...s,
            messages: s.messages.map((m) => ({ ...m, isStreaming: false })),
          }));
          setSessions(cleanSessions);
          sessionCounter.current = cleanSessions.length;

          if (savedIsDraft === true) {
            setIsDraft(true);
            setActiveSessionId(null);
          } else if (
            typeof savedActive === 'string' &&
            cleanSessions.some((s) => s.id === savedActive)
          ) {
            setActiveSessionId(savedActive);
            setIsDraft(false);
          } else {
            // Active session not found, show last session
            setActiveSessionId(cleanSessions[cleanSessions.length - 1].id);
            setIsDraft(false);
          }
        }
        const weekStart = getWeekStart();
        const savedReset = await store.get<number>(STORE_KEY_WEEKLY_RESET);
        if (savedReset && savedReset >= weekStart) {
          const saved = await store.get<{ input: number; output: number }>(STORE_KEY_WEEKLY_USAGE);
          if (saved) setWeeklyUsage(saved);
        } else {
          await store.set(STORE_KEY_WEEKLY_USAGE, { input: 0, output: 0 });
          await store.set(STORE_KEY_WEEKLY_RESET, weekStart);
          await store.save();
        }
      } catch {
        // Store doesn't exist or is corrupt — start fresh
      }
      setLoaded(true);

      invoke<boolean>('opencode_check').then((ok) => setOpencodeConnected(ok)).catch(() => setOpencodeConnected(false));
    })();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      invoke<boolean>('opencode_check').then((ok) => setOpencodeConnected(ok)).catch(() => setOpencodeConnected(false));
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!loaded || isStreaming) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const store = storeRef.current;
      if (!store) return;
      try {
          const toSave = sessions.map((s) => ({
            ...s,
            messages: s.messages.map(({ isStreaming: _, statusText: _st, ...rest }) => rest),
          }));
        await store.set(STORE_KEY_SESSIONS, toSave);
        await store.set(STORE_KEY_ACTIVE, activeSessionId);
        await store.set(STORE_KEY_IS_DRAFT, isDraft);
        await store.save();
      } catch {
        // Silent fail on save
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeSessionId, isDraft, loaded, isStreaming]);

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId) ?? null
    : null;

  const updateSession = useCallback(
    (id: string, updater: (s: Session) => Session) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    []
  );

  const cancelledRef = useRef(false);

  const streamResponse = useCallback(
    (sessionId: string, allMessages: Message[], ocSessionId?: string) => {
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

      // Accumulate content in closure, throttle setState to every 80ms
      let accumulatedContent = '';
      let currentStatusText: string | undefined = 'thinking';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushToState = () => {
        flushTimer = null;
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId ? { ...m, content: accumulatedContent, statusText: currentStatusText } : m
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
          const { name } = event.data;
          accumulatedContent += `\n\n---\n**[Tool: ${name}]** running...\n`;
          scheduleFlush();
        } else if (event.event === 'tool_end') {
          const { result } = event.data;
          const trimmed = result.length > 2000 ? result.slice(0, 2000) + '\n...(truncated)' : result;
          accumulatedContent += `\n\`\`\`\n${trimmed}\n\`\`\`\n`;
          scheduleFlush();
        } else if (event.event === 'ollama_status') {
          const st = event.data.status;
          const label = st === 'compressing' ? '\n*Compressing conversation history...*\n'
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
          const delta = { input: event.data.input_tokens, output: event.data.output_tokens };
          setUsage((prev) => ({ input: prev.input + delta.input, output: prev.output + delta.output }));
          setWeeklyUsage((prev) => {
            const next = { input: prev.input + delta.input, output: prev.output + delta.output };
            if (storeRef.current) {
              storeRef.current.set(STORE_KEY_WEEKLY_USAGE, next);
              storeRef.current.save();
            }
            return next;
          });
        } else if (event.event === 'stream_end') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId ? { ...m, content: accumulatedContent, isStreaming: false, statusText: undefined } : m
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
                ? { ...m, content: `Error: ${errText}`, isStreaming: false }
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
        invoke('opencode_send', {
          ocSessionId,
          content: lastMsg.content,
          onEvent,
        }).catch(handleError);
      } else {
        const apiMessages = allMessages.map((m) => {
          if (m.images && m.images.length > 0) {
            const blocks: Array<
              | { type: 'image'; source: { type: string; media_type: string; data: string } }
              | { type: 'text'; text: string }
            > = m.images.map((img) => ({
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
    [updateSession, opencodeConnected]
  );

  const sendMessage = useCallback(
    async (text: string, images?: ImageAttachment[]) => {
      if (isStreaming) return;

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        images: images && images.length > 0 ? images : undefined,
      };

      if (isDraft) {
        sessionCounter.current += 1;
        const trimmed = text.trim();
        const sessionName = trimmed.length === 0
          ? `Session ${sessionCounter.current}`
          : trimmed.length > 25 ? trimmed.slice(0, 25) + '...' : trimmed;
        const newSession = createSession(sessionName);
        newSession.messages = [userMsg];

        if (opencodeConnected) {
          try {
            const ocId = await invoke<string>('opencode_create_session');
            newSession.ocSessionId = ocId;
          } catch {
            // Fall back to standalone if session creation fails
          }
        }

        setSessions((prev) => [...prev, newSession]);
        setActiveSessionId(newSession.id);
        setIsDraft(false);
        streamResponse(newSession.id, [userMsg], newSession.ocSessionId);
        return;
      }

      if (!activeSessionId) return;

      updateSession(activeSessionId, (s) => ({
        ...s,
        messages: [...s.messages, userMsg],
      }));

      const currentSession = sessions.find((s) => s.id === activeSessionId);
      const allMessages = currentSession
        ? [...currentSession.messages, userMsg]
        : [userMsg];

      const ocSessionId = currentSession?.ocSessionId;

      if (opencodeConnected && !ocSessionId) {
        try {
          const ocId = await invoke<string>('opencode_create_session');
          updateSession(activeSessionId, (s) => ({ ...s, ocSessionId: ocId }));
          streamResponse(activeSessionId, allMessages, ocId);
        } catch {
          streamResponse(activeSessionId, allMessages);
        }
      } else {
        streamResponse(activeSessionId, allMessages, ocSessionId);
      }
    },
    [activeSessionId, isDraft, isStreaming, sessions, updateSession, streamResponse, opencodeConnected]
  );

  const addSession = useCallback(() => {
    if (isDraft) return;
    setIsDraft(true);
    setActiveSessionId(null);
  }, [isDraft]);

  const switchSession = useCallback((id: string) => {
    cancelledRef.current = true;
    setActiveSessionId(id);
    setIsDraft(false);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeSessionId) {
          const remaining = next.filter((s) => !s.archived);
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
            setIsDraft(false);
          } else {
            setActiveSessionId(null);
            setIsDraft(true);
          }
        }
        return next;
      });
    },
    [activeSessionId]
  );

  const renameSession = useCallback(
    (id: string, name: string) => {
      updateSession(id, (s) => ({ ...s, name }));
    },
    [updateSession]
  );

  const archiveSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, archived: true } : s));
        if (id === activeSessionId) {
          const remaining = next.filter((s) => !s.archived);
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
            setIsDraft(false);
          } else {
            setActiveSessionId(null);
            setIsDraft(true);
          }
        }
        return next;
      });
    },
    [activeSessionId]
  );

  const activeSessions = sessions.filter((s) => !s.archived);
  const archivedSessions = sessions.filter((s) => s.archived);

  const draftSession: Session = {
    id: '__draft__',
    name: 'New session',
    messages: [],
    createdAt: Date.now(),
  };

  const abortOpencode = useCallback(() => {
    cancelledRef.current = true;
    setIsStreaming(false);

    if (activeSessionId) {
      updateSession(activeSessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false, statusText: undefined } : m
        ),
      }));
    }

    const session = activeSession;
    if (session?.ocSessionId) {
      invoke('opencode_abort', { ocSessionId: session.ocSessionId }).catch(() => {});
    }
    invoke('abort_stream').catch(() => {});
  }, [activeSession, activeSessionId, updateSession]);

  return {
    sessions: activeSessions,
    archivedSessions,
    activeSession: activeSession ?? draftSession,
    activeSessionId: activeSessionId ?? '__draft__',
    isDraft,
    isStreaming,
    loaded,
    usage,
    weeklyUsage,
    opencodeConnected,
    sendMessage,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession,
    abortOpencode,
  };
}
