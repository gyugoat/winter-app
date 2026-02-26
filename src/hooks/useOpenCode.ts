/**
 * useOpenCode — OpenCode server connectivity and session bridge.
 *
 * Owns `opencodeConnected` state.  Responsibilities:
 * - One-time connectivity check + session load on mount
 * - 30-second polling interval to keep `opencodeConnected` current
 * - 10-second message polling for the active session (focus-gated)
 * - 30-second session-list polling to catch sessions from other clients
 * - Exposing `reloadSessions` to re-sync with OC on demand
 *
 * When OC is reachable, sessions are loaded from the OC server.
 * When OC is unreachable, sessions are loaded from the Tauri Store fallback.
 */
import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '../utils/invoke-shim';
import type { Store, OcSessionRaw, OcMessage } from './useSessionStore';
import type { Message, Session } from '../types';

/** Callbacks the caller must supply so useOpenCode can populate session state. */
export interface OpenCodeBridge {
  storeRef: React.MutableRefObject<Store | null>;
  setActiveSessionId: (id: string | null) => void;
  setIsDraft: (v: boolean) => void;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  sessionCounter: React.MutableRefObject<number>;
  ocToSession: (oc: OcSessionRaw) => Session;
  ocMsgToMessage: (ocMsg: OcMessage) => Message | null;
  updateSession: (id: string, updater: (s: Session) => Session) => void;
  getActiveSessions: () => Session[];
  getActiveSessionId: () => string | null;
  getIsStreaming: () => boolean;
  getLastStreamEnd: () => number;
  /** Whether useSessionStore has finished its own async init (store is open). */
  storeLoaded: boolean;
}

/** Public interface returned by useOpenCode. */
export interface OpenCodeAPI {
  reloadSessions: () => Promise<void>;
}

const STORE_KEY_ACTIVE = 'active_session_id';
const STORE_KEY_ARCHIVED_IDS = 'archived_session_ids';

/**
 * OpenCode connectivity hook.
 *
 * Performs the initial connection check and coordinates loading sessions from
 * the correct source (OC server vs local Tauri Store).
 *
 * @param bridge - Callbacks into the session store so this hook can set state
 *   without owning it directly.
 * @param onLoadFromStore - Called with the open store when OC is unavailable,
 *   so the session store can restore sessions from disk.
 * @param setOpencodeConnected - Setter for the `opencodeConnected` flag, owned
 *   by the calling facade (useChat) so it can be shared with useSessionStore.
 * @returns {@link OpenCodeAPI} — reload action.
 */
export function useOpenCode(
  bridge: OpenCodeBridge,
  onLoadFromStore: (store: Store) => Promise<void>,
  setOpencodeConnected: (v: boolean) => void
): OpenCodeAPI {
  const {
    storeRef, setActiveSessionId, setIsDraft, setSessions, sessionCounter,
    ocToSession, ocMsgToMessage, updateSession,
    getActiveSessions, getActiveSessionId, getIsStreaming, getLastStreamEnd, storeLoaded,
  } = bridge;
  const ocConnectedRef = useRef(false);
  const missedActiveRef = useRef<string | null>(null);

  // ── Initial load — runs once the Tauri Store is open (storeLoaded = true) ────

  useEffect(() => {
    if (!storeLoaded) return;
    (async () => {
      let isOcConnected = false;
      try {
        isOcConnected = await invoke<boolean>('opencode_check');
      } catch (_) {}
      ocConnectedRef.current = isOcConnected;
      setOpencodeConnected(isOcConnected);

      if (isOcConnected) {
        try {
          const store = storeRef.current;
          const savedActive = store ? await store.get<string | null>(STORE_KEY_ACTIVE) : null;
          const archivedIds = new Set(
            store ? (await store.get<string[]>(STORE_KEY_ARCHIVED_IDS)) ?? [] : []
          );
          const ocSessions = await invoke<OcSessionRaw[]>('opencode_list_sessions');
          const converted = ocSessions.filter((oc) => !oc.parentID).map((oc) => {
            const s = ocToSession(oc);
            if (archivedIds.has(s.id)) s.archived = true;
            return s;
          });
          setSessions(converted);
          sessionCounter.current = converted.length;

          // Determine which session to activate
          let activeId: string | null = null;
          if (typeof savedActive === 'string' && converted.some((s) => s.id === savedActive)) {
            activeId = savedActive;
          } else if (converted.length > 0) {
            activeId = converted[0].id;
          }

          if (activeId) {
            setActiveSessionId(activeId);
            setIsDraft(false);

            // Immediately load messages for the active session
            // (switchSession is only called on sidebar click, not on initial load)
            const target = converted.find((s) => s.id === activeId);
            if (target?.ocSessionId) {
              try {
                const ocMsgs = await invoke<unknown[]>('opencode_get_messages', { sessionId: target.ocSessionId });
                const messages = ocMsgs
                  .map((m) => ocMsgToMessage(m as OcMessage))
                  .filter((m): m is Message => m !== null);
                if (messages.length > 0) {
                  setSessions((prev: Session[]) =>
                    prev.map((s) => s.id === activeId ? { ...s, messages } : s)
                  );
                }
              } catch (e) {
                console.error('[useOpenCode] Failed to load initial messages:', e);
              }
            }
          }
        } catch (e) {
          console.error('[useOpenCode] Failed to load OpenCode sessions:', e);
        }
      } else if (storeRef.current) {
        await onLoadFromStore(storeRef.current);
      }
    })();
  }, [storeLoaded]);

  // ── 30-second connectivity poll ───────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const ok = await invoke<boolean>('opencode_check');
        ocConnectedRef.current = ok;
        setOpencodeConnected(ok);
      } catch {
        ocConnectedRef.current = false;
        setOpencodeConnected(false);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── 3-second active-session message poll ──────────────────────────────────────
  // Reduced from 10s to 3s as backup for SSE gaps. No focus gate — runs in background too.
  // Uses full replacement (not append) to prevent duplicate messages from stale closures.

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!ocConnectedRef.current) return;
      // Skip during active streaming — SSE handles it in real-time
      if (getIsStreaming()) return;
      const lastEnd = getLastStreamEnd();
      if (lastEnd > 0 && Date.now() - lastEnd < 5_000) return;
      const activeId = getActiveSessionId();
      if (!activeId) return;
      const sessions = getActiveSessions();
      const session = sessions.find((s) => s.id === activeId);
      if (!session?.ocSessionId) return;
      try {
        const ocMsgs = await invoke<unknown[]>('opencode_get_messages', { sessionId: session.ocSessionId });
        const converted = ocMsgs
          .map((m) => ocMsgToMessage(m as OcMessage))
          .filter((m): m is Message => m !== null);
        // Replace entire message list — prevents duplicates from stale state.
        // Use updater function to always read the latest session state.
        updateSession(activeId, (s) => {
          // Only replace if server has different message count or IDs
          const currentIds = new Set(s.messages.map((m) => m.id));
          const serverIds = new Set(converted.map((m) => m.id));
          const hasNew = converted.some((m) => !currentIds.has(m.id));
          const hasRemoved = s.messages.some((m) => !serverIds.has(m.id) && !m.isStreaming);
          if (!hasNew && !hasRemoved) return s; // no change
          // Preserve any in-flight streaming message (not yet on server)
          const streamingMsgs = s.messages.filter((m) => m.isStreaming);
          return { ...s, messages: [...converted, ...streamingMsgs] };
        });
      } catch {
        // silently ignore — server may be temporarily unreachable
      }
    }, 3_000);
    return () => clearInterval(interval);
  }, [getActiveSessionId, getActiveSessions, getIsStreaming, getLastStreamEnd, ocMsgToMessage, updateSession]);

  // ── 10-second session-list poll with full merge ────────────────────────────────
  // Merges server session metadata into client state while preserving local data.
  // Also handles: deleted session cleanup + active session auto-switch.

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!ocConnectedRef.current) return;
      try {
        const store = storeRef.current;
        const archivedIds = new Set(
          store ? (await store.get<string[]>(STORE_KEY_ARCHIVED_IDS)) ?? [] : []
        );
        const ocSessions = await invoke<OcSessionRaw[]>('opencode_list_sessions');
        const serverSessions = ocSessions.filter((oc) => !oc.parentID).map((oc) => {
          const s = ocToSession(oc);
          if (archivedIds.has(s.id)) s.archived = true;
          return s;
        });

        const serverMap = new Map(serverSessions.map((s) => [s.id, s]));
        const serverIds = new Set(serverSessions.map((s) => s.id));

        setSessions((prev: Session[]) => {
          // 1. Update existing + remove deleted OC sessions (keep local-only)
          let changed = false;
          const kept = prev
            .filter((s) => {
              if (!s.ocSessionId) return true; // local-only session
              if (!serverIds.has(s.id)) { changed = true; return false; } // deleted
              return true;
            })
            .map((s) => {
              const server = serverMap.get(s.id);
              if (!server) return s; // local-only
              if (s.name === server.name && s.createdAt === server.createdAt) return s;
              changed = true;
              return { ...s, name: server.name, createdAt: server.createdAt };
            });

          // 2. Add new sessions from server
          const existingIds = new Set(kept.map((s) => s.id));
          const newOnes = serverSessions.filter((s) => !existingIds.has(s.id));
          if (newOnes.length > 0) changed = true;

          if (!changed) return prev; // No re-render if nothing changed
          return [...newOnes, ...kept];
        });
        sessionCounter.current = serverSessions.length;

        // Active session auto-switch with grace period (2 consecutive misses)
        const activeId = getActiveSessionId();
        if (activeId) {
          if (!serverIds.has(activeId)) {
            if (missedActiveRef.current === activeId) {
              console.warn('[useOpenCode] Active session gone from server — switching');
              const fallback = serverSessions.filter((s) => !archivedIds.has(s.id));
              if (fallback.length > 0) {
                setActiveSessionId(fallback[0].id);
                setIsDraft(false);
              } else if (serverSessions.length > 0) {
                setActiveSessionId(serverSessions[0].id);
                setIsDraft(false);
              } else {
                setActiveSessionId(null);
                setIsDraft(true);
              }
              missedActiveRef.current = null;
            } else {
              missedActiveRef.current = activeId; // first miss — wait for confirmation
            }
          } else {
            missedActiveRef.current = null;
          }
        }
      } catch {
        // silently ignore
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [storeRef, getActiveSessions, getActiveSessionId, setActiveSessionId, setIsDraft, ocToSession, setSessions, sessionCounter]);

  // ── SSE reconnection handler ─────────────────────────────────────────────────
  // When the global SSE reconnects after a break, force-reload messages for the
  // active session to catch anything missed during the gap.

  useEffect(() => {
    function handleSSEReconnected() {
      if (!ocConnectedRef.current) return;
      const activeId = getActiveSessionId();
      if (!activeId) return;
      const sessions = getActiveSessions();
      const session = sessions.find((s) => s.id === activeId);
      if (!session?.ocSessionId) return;

      console.log('[useOpenCode] SSE reconnected — force-reloading messages for', activeId);
      invoke<unknown[]>('opencode_get_messages', { sessionId: session.ocSessionId })
        .then((ocMsgs) => {
          const converted = ocMsgs
            .map((m) => ocMsgToMessage(m as OcMessage))
            .filter((m): m is Message => m !== null);
          updateSession(activeId, (s) => {
            const streamingMsgs = s.messages.filter((m) => m.isStreaming);
            return { ...s, messages: [...converted, ...streamingMsgs] };
          });
        })
        .catch((err) => {
          console.error('[useOpenCode] SSE reconnect message reload failed:', err);
        });
    }

    window.addEventListener('winter-sse-reconnected', handleSSEReconnected);
    return () => window.removeEventListener('winter-sse-reconnected', handleSSEReconnected);
  }, [getActiveSessionId, getActiveSessions, ocMsgToMessage, updateSession]);

  // ── On-demand reload ──────────────────────────────────────────────────────────

  /**
   * Re-checks connectivity and reloads sessions from the OC server.
   *
   * Updates `opencodeConnected` and replaces the full session list.
   * No-op if OC is unreachable after the re-check.
   */
  const reloadSessions = useCallback(async () => {
    let isOcConnected = false;
    try {
      isOcConnected = await invoke<boolean>('opencode_check');
    } catch (_) {}
    setOpencodeConnected(isOcConnected);

    if (isOcConnected) {
      try {
        const store = storeRef.current;
        const savedActive = store ? await store.get<string | null>(STORE_KEY_ACTIVE) : null;
        const archivedIds = new Set(
          store ? (await store.get<string[]>(STORE_KEY_ARCHIVED_IDS)) ?? [] : []
        );
        const ocSessions = await invoke<OcSessionRaw[]>('opencode_list_sessions');
        const converted = ocSessions.filter((oc) => !oc.parentID).map((oc) => {
          const s = ocToSession(oc);
          if (archivedIds.has(s.id)) s.archived = true;
          return s;
        });
        setSessions(converted);
        sessionCounter.current = converted.length;
        if (converted.length > 0) {
          const restoredId =
            typeof savedActive === 'string' && converted.some((s) => s.id === savedActive)
              ? savedActive
              : converted[0].id;
          setActiveSessionId(restoredId);
          setIsDraft(false);

          // Load messages for the active session immediately
          const target = converted.find((s) => s.id === restoredId);
          if (target?.ocSessionId) {
            try {
              const ocMsgs = await invoke<unknown[]>('opencode_get_messages', { sessionId: target.ocSessionId });
              const messages = ocMsgs
                .map((m) => ocMsgToMessage(m as OcMessage))
                .filter((m): m is Message => m !== null);
              if (messages.length > 0) {
                setSessions((prev: Session[]) =>
                  prev.map((s) => s.id === restoredId ? { ...s, messages } : s)
                );
              }
            } catch (e) {
              console.error('[useOpenCode] Failed to load messages on reload:', e);
            }
          }
        } else {
          setActiveSessionId(null);
          setIsDraft(true);
        }
      } catch (e) {
        console.error('[useOpenCode] Failed to reload OpenCode sessions:', e);
      }
    }
  }, [storeRef, setActiveSessionId, setIsDraft, setSessions, sessionCounter, ocToSession, ocMsgToMessage]);

  return { reloadSessions };
}
