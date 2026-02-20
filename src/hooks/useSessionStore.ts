/**
 * useSessionStore — session CRUD and persistence.
 *
 * Owns all `sessions` state.  Handles:
 * - Loading from / saving to the Tauri Store (`sessions.json`)
 * - OpenCode session list synchronisation on startup and reload
 * - Create, delete, rename, archive, and reorder operations
 * - Weekly token-usage persistence
 *
 * State is saved to disk with a 500 ms debounce after every change (skipped
 * while streaming or when OpenCode is connected, since OC owns persistence
 * in that mode).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Session, Message } from '../types';
import { getWeekStart } from '../utils/time';
import { isValidSessions } from '../utils/validators';

// ── Tauri Store keys ──────────────────────────────────────────────────────────

const STORE_FILE = 'sessions.json';
const STORE_KEY_SESSIONS = 'sessions';
const STORE_KEY_ACTIVE = 'active_session_id';
const STORE_KEY_IS_DRAFT = 'is_draft';
const STORE_KEY_WEEKLY_USAGE = 'weekly_usage';
const STORE_KEY_WEEKLY_RESET = 'weekly_reset_at';
const STORE_KEY_ARCHIVED_IDS = 'archived_session_ids';
const SAVE_DEBOUNCE_MS = 500;

// ── Internal types ────────────────────────────────────────────────────────────

/** Raw session shape returned by `opencode_list_sessions`. */
export type OcSessionRaw = {
  id: string;
  title?: string;
  slug?: string;
  parentID?: string;
  time?: { created: number; updated: number };
};

/** Public interface returned by useSessionStore. */
export interface SessionStoreAPI {
  sessions: Session[];
  archivedSessions: Session[];
  activeSession: Session | null;
  activeSessionId: string | null;
  isDraft: boolean;
  loaded: boolean;
  weeklyUsage: { input: number; output: number };
  storeRef: React.MutableRefObject<Store | null>;
  setActiveSessionId: (id: string | null) => void;
  setIsDraft: (v: boolean) => void;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  updateSession: (id: string, updater: (s: Session) => Session) => void;
  addSession: () => void;
  switchSession: (id: string, ocConnected: boolean) => void;
  deleteSession: (id: string, ocConnected: boolean) => void;
  renameSession: (id: string, name: string, ocConnected: boolean) => void;
  archiveSession: (id: string) => void;
  reorderSessions: (fromIdx: number, toIdx: number) => void;
  reloadSessionsFromOC: () => Promise<void>;
  loadFromStore: (store: Store) => Promise<void>;
  ocToSession: (oc: OcSessionRaw) => Session;
  ocMsgToMessage: (ocMsg: OcMessage) => Message | null;
  bumpWeeklyUsage: (delta: { input: number; output: number }) => void;
  sessionCounter: React.MutableRefObject<number>;
}

/** Raw message shape returned by `opencode_get_messages`. */
export type OcMessage = {
  info: { id: string; role: string; time?: { created: number } };
  parts?: Record<string, { type: string; text?: string }>;
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Core session-management hook.
 *
 * @param isStreaming - Whether the AI is currently generating a response.
 *   Saving is skipped while streaming to avoid excessive writes.
 * @param opencodeConnected - Whether the OpenCode server is reachable.
 *   When connected, sessions come from OC rather than the local store.
 * @returns {@link SessionStoreAPI} — session state and all CRUD operations.
 */
export function useSessionStore(
  isStreaming: boolean,
  opencodeConnected: boolean
): SessionStoreAPI {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [weeklyUsage, setWeeklyUsage] = useState<{ input: number; output: number }>({ input: 0, output: 0 });

  const storeRef = useRef<Store | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionCounter = useRef(0);
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;

  // ── Converters ──────────────────────────────────────────────────────────────

  /**
   * Converts a raw OpenCode session record into the app's `Session` shape.
   *
   * @param oc - Raw session data from the OpenCode API.
   * @returns A `Session` with an empty `messages` array (populated lazily).
   */
  function ocToSession(oc: OcSessionRaw): Session {
    return {
      id: oc.id,
      name: oc.title || 'Untitled',
      messages: [],
      createdAt: oc.time?.created || Date.now(),
      ocSessionId: oc.id,
    };
  }

  /**
   * Converts a raw OpenCode message into the app's `Message` shape.
   *
   * Only `user` and `assistant` roles are mapped; other roles return `null`.
   * Text parts are concatenated in iteration order.
   *
   * @param ocMsg - Raw message from `opencode_get_messages`.
   * @returns A `Message`, or `null` if the role is unsupported.
   */
  function ocMsgToMessage(ocMsg: OcMessage): Message | null {
    const info = ocMsg.info;
    const role = info.role === 'user' || info.role === 'assistant' ? info.role : null;
    if (!role) return null;
    const parts = Object.values(ocMsg.parts || {});
    const textParts = parts.filter((p) => p.type === 'text');
    const content = textParts.map((p) => p.text || '').join('');
    return {
      id: info.id,
      role,
      content,
      timestamp: info.time?.created || Date.now(),
    };
  }

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const store = await load(STORE_FILE).catch(() => null);
      if (store) storeRef.current = store;

      // Restore weekly usage (reset if the stored figure is from a past week)
      if (store) {
        try {
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
        } catch (_) {}
      }

      setLoaded(true);
    })();
  }, []);

  // ── Debounced persistence ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!loaded || isStreaming || opencodeConnected) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const store = storeRef.current;
      if (!store) return;
      try {
        const toSave = sessions
          .filter((s) => !s.ocSessionId || s.messages.length > 0)
          .map((s) => ({
            ...s,
            messages: s.messages.map(({ isStreaming: _, statusText: _st, ...rest }) => rest),
          }));
        await store.set(STORE_KEY_SESSIONS, toSave);
        await store.set(STORE_KEY_ACTIVE, activeSessionId);
        await store.set(STORE_KEY_IS_DRAFT, isDraft);
        await store.save();
      } catch (_) {}
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeSessionId, isDraft, loaded, isStreaming, opencodeConnected]);

  // ── updateSession helper ──────────────────────────────────────────────────────

  /**
   * Applies an updater function to a single session by ID.
   *
   * @param id - ID of the session to update.
   * @param updater - Pure function that returns the new session value.
   */
  const updateSession = useCallback(
    (id: string, updater: (s: Session) => Session) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    []
  );

  // ── Session CRUD ──────────────────────────────────────────────────────────────

  /**
   * Transitions to the "draft" state so the next message creates a new session.
   * No-op if already in draft mode.
   */
  const addSession = useCallback(() => {
    if (isDraft) return;
    setIsDraft(true);
    setActiveSessionId(null);
  }, [isDraft]);

  /**
   * Switches the active session and lazily loads its messages from OpenCode
   * if they haven't been fetched yet.
   *
   * @param id - ID of the session to activate.
   * @param ocConnected - Whether the OpenCode server is currently reachable.
   */
  const switchSession = useCallback((id: string, ocConnected: boolean) => {
    setActiveSessionId(id);
    setIsDraft(false);

    const target = sessionsRef.current.find((s) => s.id === id);
    if (ocConnected && target?.ocSessionId && target.messages.length === 0) {
      invoke<unknown[]>('opencode_get_messages', { sessionId: target.ocSessionId })
        .then((ocMsgs) => {
          const converted = ocMsgs
            .map((m) => ocMsgToMessage(m as OcMessage))
            .filter((m): m is Message => m !== null);
          setSessions((cur) =>
            cur.map((s) => s.id === id ? { ...s, messages: converted } : s)
          );
        })
        .catch(() => {});
    }
  }, []);

  /**
   * Permanently deletes a session (and its OC counterpart if connected).
   * Selects the next available non-archived session, or resets to draft.
   *
   * @param id - ID of the session to delete.
   * @param ocConnected - Whether to also call `opencode_delete_session`.
   */
  const deleteSession = useCallback(
    (id: string, ocConnected: boolean) => {
      setSessions((prev) => {
        const target = prev.find((s) => s.id === id);
        if (ocConnected && target?.ocSessionId) {
          invoke('opencode_delete_session', { sessionId: target.ocSessionId }).catch(() => {});
        }
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

  /**
   * Renames a session and propagates the change to the OC server when connected.
   *
   * @param id - ID of the session to rename.
   * @param name - New display name.
   * @param ocConnected - Whether to also call `opencode_rename_session`.
   */
  const renameSession = useCallback(
    (id: string, name: string, ocConnected: boolean) => {
      updateSession(id, (s) => {
        if (ocConnected && s.ocSessionId) {
          invoke('opencode_rename_session', { sessionId: s.ocSessionId, title: name }).catch(() => {});
        }
        return { ...s, name };
      });
    },
    [updateSession]
  );

  /**
   * Moves a session to the archive and persists the archived-IDs list.
   * Selects the next non-archived session, or resets to draft.
   *
   * @param id - ID of the session to archive.
   */
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
        const archivedIds = next.filter((s) => s.archived).map((s) => s.id);
        if (storeRef.current) {
          storeRef.current.set(STORE_KEY_ARCHIVED_IDS, archivedIds);
          storeRef.current.save();
        }
        return next;
      });
    },
    [activeSessionId]
  );

  /**
   * Reorders sessions by moving the item at `fromIdx` to `toIdx`.
   * Only the non-archived (active) sessions are reordered; archived sessions
   * remain appended at the end.
   *
   * @param fromIdx - Source index within the active sessions list.
   * @param toIdx - Destination index within the active sessions list.
   */
  const reorderSessions = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setSessions(prev => {
      const active = prev.filter(s => !s.archived);
      const archived = prev.filter(s => s.archived);
      const next = [...active];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return [...next, ...archived];
    });
  }, []);

  // ── OC session reload ─────────────────────────────────────────────────────────

  /**
   * Re-fetches all sessions from the OpenCode server and replaces local state.
   * Called when the user triggers a manual refresh or reconnects to OC.
   */
  const reloadSessionsFromOC = useCallback(async () => {
    try {
      const savedActive = storeRef.current ? await storeRef.current.get<string | null>(STORE_KEY_ACTIVE) : null;
      const archivedIds = new Set(
        storeRef.current ? (await storeRef.current.get<string[]>(STORE_KEY_ARCHIVED_IDS)) ?? [] : []
      );
      const ocSessions = await invoke<OcSessionRaw[]>('opencode_list_sessions');
      const converted = ocSessions.filter(oc => !oc.parentID).map(oc => {
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
      console.error('[useSessionStore] Failed to reload OpenCode sessions:', e);
    }
  }, []);

  // ── Load sessions from store (fallback, non-OC mode) ─────────────────────────

  /**
   * Loads sessions from the Tauri Store when OpenCode is unavailable.
   * Called once by `useOpenCode` during the initial connectivity check.
   *
   * @param store - The already-opened Tauri Store instance.
   */
  const loadFromStore = useCallback(async (store: Store) => {
    try {
      const savedSessions = await store.get<Session[]>(STORE_KEY_SESSIONS);
      const savedActive = await store.get<string | null>(STORE_KEY_ACTIVE);
      const savedIsDraft = await store.get<boolean>(STORE_KEY_IS_DRAFT);

      if (isValidSessions(savedSessions) && savedSessions.length > 0) {
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
          setActiveSessionId(cleanSessions[cleanSessions.length - 1].id);
          setIsDraft(false);
        }
      }
    } catch (_) {}
  }, []);

  // ── Weekly usage helper ───────────────────────────────────────────────────────

  /**
   * Adds a token-usage delta to the current weekly total and persists it.
   *
   * @param delta - New tokens to add (`input` and `output` counts).
   */
  const bumpWeeklyUsage = useCallback((delta: { input: number; output: number }) => {
    setWeeklyUsage((prev) => {
      const next = { input: prev.input + delta.input, output: prev.output + delta.output };
      if (storeRef.current) {
        storeRef.current.set(STORE_KEY_WEEKLY_USAGE, next);
        storeRef.current.save();
      }
      return next;
    });
  }, []);

  const activeSessions = sessions.filter((s) => !s.archived);
  const archivedSessions = sessions.filter((s) => s.archived);
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) ?? null : null;

  return {
    sessions: activeSessions,
    archivedSessions,
    activeSession,
    activeSessionId,
    isDraft,
    loaded,
    weeklyUsage,
    storeRef,
    setActiveSessionId,
    setIsDraft,
    setSessions,
    updateSession,
    addSession,
    switchSession,
    deleteSession,
    renameSession,
    archiveSession,
    reorderSessions,
    reloadSessionsFromOC,
    loadFromStore,
    ocToSession,
    ocMsgToMessage,
    bumpWeeklyUsage,
    sessionCounter,
  };
}
