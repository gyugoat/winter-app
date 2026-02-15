import { useState, useCallback, useRef } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { Message, Session, ChatStreamEvent } from '../types';

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

export function useChat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionCounter = useRef(0);

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

      const apiMessages = allMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

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
    (text: string) => {
      if (isStreaming) return;

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };

      if (isDraft) {
        sessionCounter.current += 1;
        const newSession = createSession(`Session ${sessionCounter.current}`);
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

  const draftSession: Session = {
    id: '__draft__',
    name: 'New session',
    messages: [],
    createdAt: Date.now(),
  };

  return {
    sessions,
    activeSession: activeSession ?? draftSession,
    activeSessionId: activeSessionId ?? '__draft__',
    isDraft,
    isStreaming,
    sendMessage,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
  };
}
