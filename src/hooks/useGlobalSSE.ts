/**
 * useGlobalSSE — persistent SSE connection for real-time updates.
 *
 * Maintains an always-on EventSource to `/global/event` that tracks:
 * - Which sessions are currently streaming (busy/idle transitions)
 * - Which sessions have new unread messages
 *
 * This is separate from the per-stream SSE in invoke-shim, which only
 * opens during active streaming. This hook provides ambient awareness.
 *
 * Resilience features:
 * - Exponential backoff on disconnect (1s → 2s → 4s → 8s → 16s → 30s max)
 * - Resets backoff on successful connection (first message received)
 * - Reconnects on tab visibility change (focus regain)
 * - Initial state hydration via REST /session/status on SSE connect
 * - Preserves last-known busySessions on disconnect (no flash-idle)
 * - Event-based keepalive for busy timestamps (prevents false stale cleanup)
 * - Dispatches 'winter-sse-reconnected' event on successful reconnect
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { isTauri, getDirectory } from '../utils/platform';

// ── Types ──────────────────────────────────────────────────────────────────

export interface GlobalSSEState {
  /** Set of session IDs currently streaming (busy). */
  busySessions: Set<string>;
  /** Set of session IDs with unread messages (not currently viewed). */
  unreadSessions: Set<string>;
  /** Whether the SSE connection is currently alive. */
  sseConnected: boolean;
  /** Mark a session as read (user switched to it). */
  markRead: (sessionId: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract sessionID from an SSE event's properties.
 * Each event type nests sessionID differently.
 */
function extractSessionId(
  eventType: string,
  props: Record<string, unknown>
): string {
  if (eventType === 'message.updated') {
    return (
      ((props.info as Record<string, unknown>)?.sessionID as string) ?? ''
    );
  }
  if (eventType === 'message.part.updated') {
    return (
      ((props.part as Record<string, unknown>)?.sessionID as string) ??
      (props.sessionID as string) ??
      ''
    );
  }
  // session.status, session.idle, message.part.delta, etc.
  return (props.sessionID as string) ?? '';
}

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * Persistent SSE connection for sidebar status indicators.
 *
 * @param activeSessionId - The session currently being viewed (messages here are auto-read).
 * @param opencodeConnected - Whether OpenCode server is reachable.
 */
export function useGlobalSSE(
  activeSessionId: string | null,
  opencodeConnected: boolean
): GlobalSSEState {
  const [busySessions, setBusySessions] = useState<Set<string>>(new Set());
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const [sseConnected, setSseConnected] = useState(false);
  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;
  const busyTimestamps = useRef<Map<string, number>>(new Map());

  const markRead = useCallback((sessionId: string) => {
    setUnreadSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  // Auto-mark active session as read
  useEffect(() => {
    if (activeSessionId) {
      markRead(activeSessionId);
    }
  }, [activeSessionId, markRead]);

  useEffect(() => {
    // Only run in web mode — Tauri has its own event system
    if (isTauri) return;
    if (!opencodeConnected) return;

    const dir = encodeURIComponent(getDirectory());
    const url = `/global/event?directory=${dir}`;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let backoffMs = INITIAL_BACKOFF_MS;
    let hadSuccessfulMessage = false;

    // ── Initial state hydration via REST ────────────────────────────────
    // SSE is a change-notification channel, not a state source.
    // On (re)connect we fetch /session/status to know which sessions are
    // currently busy — this closes the "hot join" gap that caused the
    // false-idle bug on page refresh and mobile→desktop switches.
    function fetchInitialBusyState() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      fetch(`/session/status?directory=${dir}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : {}))
        .then((statusMap: Record<string, { type: string }>) => {
          const now = Date.now();
          // MERGE, don't replace — preserve any busy sessions SSE already added
          setBusySessions((prev) => {
            const merged = new Set(prev);
            for (const [sesId, info] of Object.entries(statusMap)) {
              if (info.type === 'busy') {
                merged.add(sesId);
                busyTimestamps.current.set(sesId, now);
              }
            }
            return merged.size !== prev.size ? merged : prev;
          });
        })
        .catch(() => {}) // best-effort — SSE events still work as fallback
        .finally(() => clearTimeout(timer));
    }

    function connect() {
      if (closed) return;

      // Clean up any existing connection
      if (es) {
        try { es.close(); } catch {}
      }

      es = new EventSource(url);
      hadSuccessfulMessage = false;

      es.onopen = () => {
        console.log('[GlobalSSE] Connection opened');
        // SSE TCP connection confirmed → same server's REST API is reachable.
        // Fetch current busy state immediately instead of waiting up to 10s
        // for the first SSE heartbeat event.
        fetchInitialBusyState();
      };

      es.onmessage = (ev: MessageEvent) => {
        // First successful message = connection is healthy
        if (!hadSuccessfulMessage) {
          hadSuccessfulMessage = true;
          backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on success
          setSseConnected(true);
          console.log('[GlobalSSE] Connected — receiving events');
          // Notify other hooks that SSE is back
          window.dispatchEvent(new Event('winter-sse-reconnected'));
        }

        let envelope: {
          payload: {
            type: string;
            properties: Record<string, unknown>;
          };
        };
        try {
          envelope = JSON.parse(ev.data);
        } catch {
          return;
        }

        const eventType = envelope.payload.type;
        const props = envelope.payload.properties;

        // ── Keepalive: refresh busy timestamp on ANY event for that session ──
        // This prevents the stale-busy cleanup from incorrectly clearing
        // sessions that are actively streaming (e.g. long tool calls that
        // emit message.part.delta but no new session.status:busy).
        const sesIdFromEvent = extractSessionId(eventType, props);
        if (sesIdFromEvent && busyTimestamps.current.has(sesIdFromEvent)) {
          busyTimestamps.current.set(sesIdFromEvent, Date.now());
        }

        if (eventType === 'session.status') {
          const sesId = (props.sessionID as string) ?? '';
          const status = props.status as Record<string, unknown> | undefined;
          if (!sesId || !status) return;

          if (status.type === 'busy') {
            busyTimestamps.current.set(sesId, Date.now());
            setBusySessions((prev) => {
              if (prev.has(sesId)) return prev;
              const next = new Set(prev);
              next.add(sesId);
              return next;
            });
          } else if (status.type === 'idle') {
            busyTimestamps.current.delete(sesId);
            setBusySessions((prev) => {
              if (!prev.has(sesId)) return prev;
              const next = new Set(prev);
              next.delete(sesId);
              return next;
            });
          }
        } else if (eventType === 'session.idle') {
          const sesId = (props.sessionID as string) ?? '';
          if (sesId) {
            busyTimestamps.current.delete(sesId);
            setBusySessions((prev) => {
              if (!prev.has(sesId)) return prev;
              const next = new Set(prev);
              next.delete(sesId);
              return next;
            });
          }
        } else if (
          eventType === 'message.updated' ||
          eventType === 'message.part.updated' ||
          eventType === 'message.part.delta'
        ) {
          // Extract session ID from various event shapes
          let sesId = '';
          if (eventType === 'message.updated') {
            const info = props.info as Record<string, unknown> | undefined;
            sesId = (info?.sessionID as string) ?? '';
            // Only mark unread for assistant messages
            const role = (info?.role as string) ?? '';
            if (role !== 'assistant') return;
          } else if (eventType === 'message.part.updated') {
            const part = props.part as Record<string, unknown> | undefined;
            sesId = (part?.sessionID as string) ?? (props.sessionID as string) ?? '';
          } else {
            sesId = (props.sessionID as string) ?? '';
          }

          if (!sesId) return;

          // Only mark unread if NOT the currently viewed session
          if (sesId !== activeSessionRef.current) {
            setUnreadSessions((prev) => {
              if (prev.has(sesId)) return prev;
              const next = new Set(prev);
              next.add(sesId);
              return next;
            });
          }
        }
      };

      es.onerror = () => {
        if (closed) return;
        es?.close();
        setSseConnected(false);
        // Preserve last-known busySessions — don't flash idle on network blips.
        // The fetchInitialBusyState() on reconnect will correct any drift,
        // and the stale-busy cleanup (5min) is the final safety net.

        console.warn(
          `[GlobalSSE] Connection lost — reconnecting in ${backoffMs}ms`
        );

        reconnectTimer = setTimeout(connect, backoffMs);
        // Exponential backoff with cap
        backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      };
    }

    connect();

    // ── Reconnect / refresh on tab focus ──────────────────────────────────
    // When the user returns to the tab, either force a fresh SSE connection
    // (if it died) or at least re-fetch busy state (if SSE is alive but
    // state may have drifted while the tab was in the background).
    function handleVisibility() {
      if (document.hidden || closed) return;

      if (es && es.readyState === EventSource.OPEN && hadSuccessfulMessage) {
        // SSE is alive — just refresh busy state in case it drifted
        fetchInitialBusyState();
        return;
      }

      console.log('[GlobalSSE] Tab focused — forcing reconnect');
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on manual reconnect
      connect();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      closed = true;
      es?.close();
      setSseConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [opencodeConnected]);

  // ── Stale busy cleanup — auto-clear sessions busy for >5min ─────────────────
  // Fallback for missed SSE idle events. 60s was too aggressive — long tool
  // calls (builds, large reads, MCP delegations) easily exceed that.
  // With event-based keepalive above, 5min of zero events = truly stale.
  useEffect(() => {
    const STALE_BUSY_TIMEOUT_MS = 300_000;
    const interval = setInterval(() => {
      setBusySessions((prev) => {
        if (prev.size === 0) return prev;
        const now = Date.now();
        let changed = false;
        const next = new Set(prev);
        for (const id of prev) {
          const ts = busyTimestamps.current.get(id);
          if (ts && now - ts > STALE_BUSY_TIMEOUT_MS) {
            next.delete(id);
            busyTimestamps.current.delete(id);
            changed = true;
            console.warn(`[GlobalSSE] Auto-cleared stale busy session: ${id}`);
          }
        }
        return changed ? next : prev;
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  return { busySessions, unreadSessions, sseConnected, markRead };
}
