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
import { invoke } from '@tauri-apps/api/core';
import type { Store } from '@tauri-apps/plugin-store';
import type { OcSessionRaw, OcMessage } from './useSessionStore';
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
          if (typeof savedActive === 'string' && converted.some((s) => s.id === savedActive)) {
            setActiveSessionId(savedActive);
            setIsDraft(false);
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

  // ── 10-second active-session message poll (focus-gated) ──────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!document.hasFocus()) return;
      if (!ocConnectedRef.current) return;
      if (getIsStreaming()) return;
      const lastEnd = getLastStreamEnd();
      if (lastEnd > 0 && Date.now() - lastEnd < 15_000) return;
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
        const existingIds = new Set(session.messages.map((m) => m.id));
        const newMsgs = converted.filter((m) => !existingIds.has(m.id));
        if (newMsgs.length > 0) {
          updateSession(activeId, (s) => ({ ...s, messages: [...s.messages, ...newMsgs] }));
        }
      } catch {
        // silently ignore — server may be temporarily unreachable
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [getActiveSessionId, getActiveSessions, getIsStreaming, getLastStreamEnd, ocMsgToMessage, updateSession]);

  // ── 30-second session-list poll (catches sessions from other clients) ─────────

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!document.hasFocus()) return;
      if (!ocConnectedRef.current) return;
      if (getIsStreaming()) return;
      try {
        const store = storeRef.current;
        const archivedIds = new Set(
          store ? (await store.get<string[]>(STORE_KEY_ARCHIVED_IDS)) ?? [] : []
        );
        const ocSessions = await invoke<OcSessionRaw[]>('opencode_list_sessions');
        const converted = ocSessions.filter((oc) => !oc.parentID).map((oc) => {
          const s = ocToSession(oc);
          if (archivedIds.has(s.id)) s.archived = true;
          return s;
        });
        const currentSessions = getActiveSessions();
        const currentIds = new Set(currentSessions.map((s) => s.id));
        const newSessions = converted.filter((s) => !currentIds.has(s.id));
        if (newSessions.length > 0) {
          setSessions((prev: Session[]) => [...newSessions, ...prev]);
          sessionCounter.current = converted.length;
        }
      } catch {
        // silently ignore
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [storeRef, getActiveSessions, getIsStreaming, ocToSession, setSessions, sessionCounter]);

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
        } else {
          setActiveSessionId(null);
          setIsDraft(true);
        }
      } catch (e) {
        console.error('[useOpenCode] Failed to reload OpenCode sessions:', e);
      }
    }
  }, [storeRef, setActiveSessionId, setIsDraft, setSessions, sessionCounter, ocToSession]);

  return { reloadSessions };
}
