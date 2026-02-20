/**
 * useChat — facade hook for the chat feature.
 *
 * Composes three focused sub-hooks into the single interface that all
 * consuming components depend on:
 *
 * - {@link useSessionStore} — session CRUD, persistence, weekly usage
 * - {@link useStreaming}    — AI response streaming + throttled flushes
 * - {@link useOpenCode}     — OC server connectivity + session bridge
 *
 * The public return type is identical to the original monolithic hook so that
 * `Chat.tsx` and any other consumers require zero import changes.
 */
import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Message, ImageAttachment, MessageMode, Session } from '../types';
import { uid } from '../utils/uid';
import { useSessionStore } from './useSessionStore';
import { useStreaming } from './useStreaming';
import { useOpenCode } from './useOpenCode';

/**
 * Central chat hook.
 *
 * Delegates all state ownership to the three sub-hooks and wires them
 * together: `sendMessage` is the main coordinator that decides whether to
 * create a new session, call OpenCode, or fall back to the direct Claude API.
 *
 * @returns The full chat interface (unchanged from the original useChat).
 */
export function useChat() {
  const [usage, setUsage] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [opencodeConnected, setOpencodeConnected] = useState(false);

  const streaming = useStreaming();

  const sessionStore = useSessionStore(streaming.isStreaming, opencodeConnected);

  // Stable getter refs so polling intervals never capture stale values.
  const sessionsRef = useRef<Session[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  sessionsRef.current = sessionStore.sessions;
  activeSessionIdRef.current = sessionStore.activeSessionId;
  isStreamingRef.current = streaming.isStreaming;

  const openCode = useOpenCode(
    {
      storeRef: sessionStore.storeRef,
      setActiveSessionId: sessionStore.setActiveSessionId,
      setIsDraft: sessionStore.setIsDraft,
      setSessions: sessionStore.setSessions,
      sessionCounter: sessionStore.sessionCounter,
      ocToSession: sessionStore.ocToSession,
      ocMsgToMessage: sessionStore.ocMsgToMessage,
      updateSession: sessionStore.updateSession,
      getActiveSessions: useCallback(() => sessionsRef.current, []),
      getActiveSessionId: useCallback(() => activeSessionIdRef.current, []),
      getIsStreaming: useCallback(() => isStreamingRef.current, []),
      getLastStreamEnd: useCallback(() => streaming.lastStreamEndRef.current, []),
      storeLoaded: sessionStore.loaded,
    },
    sessionStore.loadFromStore,
    setOpencodeConnected
  );

  const handleUsage = useCallback((delta: { input: number; output: number }) => {
    setUsage((prev) => ({ input: prev.input + delta.input, output: prev.output + delta.output }));
    sessionStore.bumpWeeklyUsage(delta);
  }, [sessionStore.bumpWeeklyUsage]);

  /**
   * Sends a user message, optionally with image attachments.
   *
   * Handles the "draft → real session" transition, OpenCode session creation,
   * and delegates to `streamResponse` for the AI reply.
   *
   * @param text - The text the user typed.
   * @param images - Optional image attachments (base64 encoded).
   * @param mode - Message mode (`normal` | `search` | `analyze`).
   */
  const sendMessage = useCallback(
    async (text: string, images?: ImageAttachment[], mode?: MessageMode) => {
      if (streaming.isStreaming) return;

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        images: images && images.length > 0 ? images : undefined,
      };

      if (sessionStore.isDraft) {
        sessionStore.sessionCounter.current += 1;
        const trimmed = text.trim();
        const sessionName =
          trimmed.length === 0
            ? `Session ${sessionStore.sessionCounter.current}`
            : trimmed.length > 25
            ? trimmed.slice(0, 25) + '...'
            : trimmed;

        const newSession: Session = {
          id: uid(),
          name: sessionName,
          messages: [userMsg],
          createdAt: Date.now(),
        };

        if (opencodeConnected) {
          try {
            const ocId = await invoke<string>('opencode_create_session');
            newSession.ocSessionId = ocId;
          } catch {
            // Fall back to standalone if session creation fails
          }
        }

        sessionStore.setSessions((prev: Session[]) => [...prev, newSession]);
        sessionStore.setActiveSessionId(newSession.id);
        sessionStore.setIsDraft(false);
        streaming.streamResponse(
          newSession.id,
          [userMsg],
          sessionStore.updateSession,
          handleUsage,
          newSession.ocSessionId,
          mode,
          opencodeConnected
        );
        return;
      }

      if (!sessionStore.activeSessionId) return;

      sessionStore.updateSession(sessionStore.activeSessionId, (s) => ({
        ...s,
        messages: [...s.messages, userMsg],
      }));

      const currentSession = sessionStore.sessions.find(
        (s: Session) => s.id === sessionStore.activeSessionId
      );
      const allMessages = currentSession ? [...currentSession.messages, userMsg] : [userMsg];
      const ocSessionId = currentSession?.ocSessionId;

      if (opencodeConnected && !ocSessionId) {
        try {
          const ocId = await invoke<string>('opencode_create_session');
          sessionStore.updateSession(sessionStore.activeSessionId, (s) => ({ ...s, ocSessionId: ocId }));
          streaming.streamResponse(
            sessionStore.activeSessionId,
            allMessages,
            sessionStore.updateSession,
            handleUsage,
            ocId,
            mode,
            opencodeConnected
          );
        } catch {
          streaming.streamResponse(
            sessionStore.activeSessionId,
            allMessages,
            sessionStore.updateSession,
            handleUsage,
            undefined,
            mode,
            opencodeConnected
          );
        }
      } else {
        streaming.streamResponse(
          sessionStore.activeSessionId,
          allMessages,
          sessionStore.updateSession,
          handleUsage,
          ocSessionId,
          mode,
          opencodeConnected
        );
      }
    },
    [streaming, sessionStore, opencodeConnected, handleUsage]
  );

  /**
   * Cancels any in-progress streaming response.
   *
   * Sets the cancel flag, clears the streaming state, and sends an abort
   * command to the OpenCode server if a session is active.
   */
  const abortOpencode = useCallback(() => {
    streaming.cancelledRef.current = true;
    streaming.setIsStreaming(false);

    const activeId = sessionStore.activeSessionId;
    if (activeId) {
      sessionStore.updateSession(activeId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false, statusText: undefined } : m
        ),
      }));
    }

    const session = sessionStore.activeSession;
    if (session?.ocSessionId) {
      invoke('opencode_abort', { ocSessionId: session.ocSessionId }).catch(() => {});
    }
    invoke('abort_stream').catch(() => {});
  }, [streaming, sessionStore]);

  const switchSession = useCallback((id: string) => {
    streaming.cancelledRef.current = true;
    sessionStore.switchSession(id, opencodeConnected);
  }, [streaming.cancelledRef, sessionStore.switchSession, opencodeConnected]);

  const deleteSession = useCallback((id: string) => {
    sessionStore.deleteSession(id, opencodeConnected);
  }, [sessionStore.deleteSession, opencodeConnected]);

  const renameSession = useCallback((id: string, name: string) => {
    sessionStore.renameSession(id, name, opencodeConnected);
  }, [sessionStore.renameSession, opencodeConnected]);

  const draftSession: Session = {
    id: '__draft__',
    name: 'New session',
    messages: [],
    createdAt: Date.now(),
  };

  return {
    sessions: sessionStore.sessions,
    archivedSessions: sessionStore.archivedSessions,
    activeSession: sessionStore.activeSession ?? draftSession,
    activeSessionId: sessionStore.activeSessionId ?? '__draft__',
    isDraft: sessionStore.isDraft,
    isStreaming: streaming.isStreaming,
    loaded: sessionStore.loaded,
    usage,
    weeklyUsage: sessionStore.weeklyUsage,
    opencodeConnected,
    sendMessage,
    addSession: sessionStore.addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession: sessionStore.archiveSession,
    reorderSessions: sessionStore.reorderSessions,
    abortOpencode,
    reloadSessions: openCode.reloadSessions,
    updateSession: sessionStore.updateSession,
  };
}
