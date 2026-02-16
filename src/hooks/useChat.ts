import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Message, Session, ChatStreamEvent, ImageAttachment } from '../types';

const STORE_FILE = 'sessions.json';
const STORE_KEY_SESSIONS = 'sessions';
const STORE_KEY_ACTIVE = 'active_session_id';
const STORE_KEY_IS_DRAFT = 'is_draft';
const SAVE_DEBOUNCE_MS = 500;

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
      } catch {
        // Store doesn't exist or is corrupt — start fresh
      }
      setLoaded(true);
    })();
  }, []);

  // Debounced save to store whenever sessions/activeSessionId/isDraft change
  useEffect(() => {
    if (!loaded) return; // Don't save before initial load

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const store = storeRef.current;
      if (!store) return;
      try {
        // Strip isStreaming from messages before saving
        const toSave = sessions.map((s) => ({
          ...s,
          messages: s.messages.map(({ isStreaming: _, ...rest }) => rest),
        }));
        await store.set(STORE_KEY_SESSIONS, toSave);
        await store.set(STORE_KEY_ACTIVE, activeSessionId);
        await store.set(STORE_KEY_IS_DRAFT, isDraft);
        await store.save();
      } catch {
        // Silent fail on save — don't crash the app
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeSessionId, isDraft, loaded]);

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId) ?? null
    : null;

  const updateSession = useCallback(
    (id: string, updater: (s: Session) => Session) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    []
  );

  const streamResponse = useCallback(
    (sessionId: string, allMessages: Message[]) => {
      setIsStreaming(true);

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
        messages: [...s.messages, replyMsg],
      }));

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

      const onEvent = new Channel<ChatStreamEvent>();
      onEvent.onmessage = (event: ChatStreamEvent) => {
        if (event.event === 'delta') {
          const text = event.data.text;
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId ? { ...m, content: m.content + text } : m
            ),
          }));
        } else if (event.event === 'tool_start') {
          const { name } = event.data;
          const label = `\n\n---\n**[Tool: ${name}]** running...\n`;
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId ? { ...m, content: m.content + label } : m
            ),
          }));
        } else if (event.event === 'tool_end') {
          const { result } = event.data;
          const trimmed = result.length > 2000 ? result.slice(0, 2000) + '\n...(truncated)' : result;
          const block = `\n\`\`\`\n${trimmed}\n\`\`\`\n`;
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId ? { ...m, content: m.content + block } : m
            ),
          }));
        } else if (event.event === 'ollama_status') {
          const st = event.data.status;
          const label = st === 'compressing' ? '\n*Compressing conversation history...*\n'
            : st === 'summarizing' ? '\n*Summarizing tool output...*\n'
            : '';
          if (label) {
            updateSession(sessionId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === replyId ? { ...m, content: m.content + label } : m
              ),
            }));
          }
        } else if (event.event === 'usage') {
          setUsage((prev) => ({
            input: prev.input + event.data.input_tokens,
            output: prev.output + event.data.output_tokens,
          }));
        } else if (event.event === 'stream_end') {
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === replyId ? { ...m, isStreaming: false } : m
            ),
          }));
          setIsStreaming(false);
        } else if (event.event === 'error') {
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

      invoke('chat_send', { messages: apiMessages, onEvent }).catch((err) => {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === replyId
              ? { ...m, content: `Error: ${err}`, isStreaming: false }
              : m
          ),
        }));
        setIsStreaming(false);
      });
    },
    [updateSession]
  );

  const sendMessage = useCallback(
    (text: string, images?: ImageAttachment[]) => {
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
        setSessions((prev) => [...prev, newSession]);
        setActiveSessionId(newSession.id);
        setIsDraft(false);
        streamResponse(newSession.id, [userMsg]);
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
      streamResponse(activeSessionId, allMessages);
    },
    [activeSessionId, isDraft, isStreaming, sessions, updateSession, streamResponse]
  );

  const addSession = useCallback(() => {
    if (isDraft) return;
    setIsDraft(true);
    setActiveSessionId(null);
  }, [isDraft]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setIsDraft(false);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeSessionId) {
          if (next.length > 0) {
            setActiveSessionId(next[0].id);
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

  return {
    sessions: activeSessions,
    archivedSessions,
    activeSession: activeSession ?? draftSession,
    activeSessionId: activeSessionId ?? '__draft__',
    isDraft,
    isStreaming,
    loaded,
    usage,
    sendMessage,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession,
  };
}
