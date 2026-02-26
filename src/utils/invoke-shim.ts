/**
 * invoke-shim — drop-in replacement for `invoke` from `@tauri-apps/api/core`.
 *
 * In Tauri: delegates to the real invoke().
 * In Web: maps each Tauri command to an HTTP fetch to the proxy at the same origin.
 *
 * Also exports a web-compatible `Channel` class for SSE streaming.
 */
import { isTauri, getDirectory } from './platform';

// ── Types ──────────────────────────────────────────────────────────────────

type InvokeArgs = Record<string, unknown>;

// ── Real Tauri imports (lazy, only in Tauri context) ──────────────────────

let _realInvoke: ((cmd: string, args?: InvokeArgs) => Promise<unknown>) | null = null;
let _RealChannel: (new () => { onmessage: (msg: unknown) => void }) | null = null;

if (isTauri) {
  // Dynamic import — only loaded in Tauri context, tree-shaken in web builds
  import('@tauri-apps/api/core').then((mod) => {
    _realInvoke = mod.invoke;
    _RealChannel = mod.Channel as unknown as typeof _RealChannel;
  });
}

// ── Directory helper ──────────────────────────────────────────────────────

function dir(): string {
  return encodeURIComponent(getDirectory());
}

function dirSep(path: string): string {
  return path.includes('?') ? '&' : '?';
}

function withDir(path: string): string {
  return `${path}${dirSep(path)}directory=${dir()}`;
}

// ── Web fetch helpers ─────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

// ── Command handlers (web mode) ──────────────────────────────────────────

type CommandHandler = (args: InvokeArgs) => Promise<unknown>;

const WEB_COMMANDS: Record<string, CommandHandler> = {
  // ── Health ──
  async opencode_check() {
    try {
      const data = await fetchJson<{ healthy?: boolean }>(withDir('/global/health'));
      return data.healthy === true;
    } catch {
      return false;
    }
  },

  // ── Sessions ──
  async opencode_list_sessions() {
    return fetchJson(withDir('/session'));
  },

  async opencode_create_session() {
    const data = await fetchJson<{ id: string }>(withDir('/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return data.id;
  },

  async opencode_delete_session(args) {
    const sessionId = args.sessionId as string;
    await fetch(withDir(`/session/${sessionId}`), { method: 'DELETE' });
  },

  async opencode_rename_session(args) {
    const sessionId = args.sessionId as string;
    const title = args.title as string;
    await fetch(withDir(`/session/${sessionId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  },

  // ── Messages ──
  async opencode_get_messages(args) {
    const sessionId = args.sessionId as string;
    return fetchJson(withDir(`/session/${sessionId}/message`));
  },

  // ── Streaming send (see opencode_send below) ──

  // ── Abort ──
  async opencode_abort(args) {
    const ocSessionId = args.ocSessionId as string;
    await fetch(withDir(`/session/${ocSessionId}/abort`), { method: 'POST' });
  },

  // ── Path info ──
  async opencode_get_path() {
    return fetchJson(withDir('/path'));
  },

  // ── File listing ──
  async opencode_list_files(args) {
    const path = args.path as string;
    return fetchJson(withDir(`/file?path=${encodeURIComponent(path)}`));
  },

  // ── File content ──
  async opencode_file_content(args) {
    const path = args.path as string;
    return fetchJson(withDir(`/file/content?path=${encodeURIComponent(path)}`));
  },

  // ── Questions ──
  async opencode_get_questions() {
    return fetchJson(withDir('/question'));
  },

  async opencode_reply_question(args) {
    const requestId = args.requestId as string;
    const answers = args.answers;
    await fetch(withDir(`/question/${requestId}/reply`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
  },

  async opencode_reject_question(args) {
    const requestId = args.requestId as string;
    await fetch(withDir(`/question/${requestId}/reject`), { method: 'POST' });
  },

  // ── Auth (web mode — always authenticated via proxy) ──
  async is_authenticated() {
    return true;
  },

  async get_authorize_url() {
    return '/reauth';
  },

  async exchange_code() {
    // No-op in web mode
  },

  async logout() {
    // No-op in web mode
  },

  // ── abort_stream — no-op, SSE abort handled by WebChannel ──
  async abort_stream() {},

  // ── chat_send — not used when opencode is connected ──
  async chat_send() {
    throw new Error('chat_send is not supported in web mode — use OpenCode');
  },

  // ── Folder browser helpers (Tauri-only, best-effort in web) ──
  async search_directories(args) {
    // Use proxy /api/ls to list parent directory, then filter by query
    const root = (args.root as string) || '/home';
    const query = ((args.query as string) || '').toLowerCase();
    const maxResults = (args.maxResults as number) || 20;
    try {
      const resp = await fetch(`/api/ls?path=${encodeURIComponent(root)}`);
      if (!resp.ok) return [];
      const entries = await resp.json() as Array<{ name: string; absolute: string; type: string }>;
      return entries
        .filter(e => e.type === 'directory' && e.name.toLowerCase().includes(query))
        .slice(0, maxResults)
        .map(e => ({ name: e.name, absolute: e.absolute }));
    } catch {
      return [];
    }
  },

  async create_directory() {
    // Not supported in web mode — would need a backend endpoint
    throw new Error('create_directory is not supported in web mode');
  },

  // ── Session key ──
  async set_session_key() {
    // In web mode, auth is managed by the proxy
  },

  // ── Working directory ──
  async get_working_directory() {
    const data = await fetchJson<{ directory?: string }>(withDir('/path'));
    return data.directory || getDirectory() || '/home';
  },

  async set_working_directory() {
    // In web mode, directory is managed server-side via config.json
  },

  // ── Feedback ──
  async send_feedback() {
    // Not available in web mode
  },

  // ── Ollama commands (Tauri-only, stubs in web) ──
  async ollama_is_installed() { return false; },
  async ollama_check() { return false; },
  async ollama_models() { return []; },
  async ollama_install() {},
  async ollama_toggle() {},
  async ollama_set_config() {},

  // ── Service/scheduler commands (Tauri-only, stubs) ──
  async get_services_status() { return []; },
  async get_scheduler_status() { return []; },
  async control_service() {},
  async toggle_task() {},
  async run_task_now() {},
  async delete_task() {},
  async create_task() {},
};

// ── SSE-based streaming (opencode_send replacement) ──────────────────────

/**
 * Web implementation of opencode_send:
 * 1. POST prompt to /session/{id}/prompt_async
 * 2. Subscribe to SSE at /global/event
 * 3. Parse events and dispatch to the Channel's onmessage
 */
async function webOpencodeSend(args: InvokeArgs): Promise<void> {
  const ocSessionId = args.ocSessionId as string;
  const content = args.content as string;
  const images = (args.images as [string, string][] | undefined) ?? [];
  const onEvent = args.onEvent as WebChannel;

  // Build prompt parts (same format as Rust client)
  const parts: unknown[] = [];

  // Images first
  for (let i = 0; i < images.length; i++) {
    const [mime, b64] = images[i];
    parts.push({
      type: 'file',
      mime,
      url: `data:${mime};base64,${b64}`,
      filename: `image_${i}.${mime.split('/').pop() || 'png'}`,
    });
  }

  // Text part
  if (content) {
    parts.push({ type: 'text', text: content });
  }

   // Get known message IDs for dedup
  let knownMsgIds = new Set<string>();
  try {
    const msgs = await fetchJson<Array<{ info?: { id?: string } }>>(
      withDir(`/session/${ocSessionId}/message`)
    );
    for (const msg of msgs) {
      if (msg.info?.id) knownMsgIds.add(msg.info.id);
    }
  } catch {
    // best-effort
  }
  console.log('[invoke-shim] ocSessionId:', ocSessionId, 'knownMsgIds:', [...knownMsgIds]);

  // Subscribe to SSE BEFORE sending prompt (match Rust handler ordering)
  // This prevents race condition where early events are lost
  const eventUrl = withDir('/global/event');
  console.log('[invoke-shim] Opening SSE:', eventUrl);
  let eventSource = new EventSource(eventUrl);

  // Wait for SSE connection to be established before sending prompt
  await new Promise<void>((resolve) => {
    const onOpen = () => {
      console.log('[invoke-shim] SSE connection opened (readyState:', eventSource.readyState, ')');
      eventSource.removeEventListener('open', onOpen);
      resolve();
    };
    eventSource.addEventListener('open', onOpen);
    // Fallback: resolve after 200ms even if open event doesn't fire
    setTimeout(() => {
      console.log('[invoke-shim] SSE open timeout fallback (readyState:', eventSource.readyState, ')');
      resolve();
    }, 200);
  });

  // Send prompt AFTER SSE is connected
  await fetch(withDir(`/session/${ocSessionId}/prompt_async`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
  });

  // Shared state across reconnections — survives EventSource replacement
  const textLengths = new Map<string, number>();
  const toolStarted = new Set<string>();
  const userMsgIds = new Set<string>();
  let sseErrorCount = 0;
  let reconnectAttempts = 0;
  let streamFinalized = false;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BACKOFF_BASE_MS = 3000;
  const BACKOFF_MAX_MS = 30000;

  const emit = (event: unknown) => {
    if (onEvent?.onmessage) {
      onEvent.onmessage(event);
    }
  };

  eventSource.onmessage = (ev: MessageEvent) => {
    // Reset error count on successful message receipt
    sseErrorCount = 0;

    let envelope: {
      payload: {
        type: string;
        properties: Record<string, unknown>;
      };
    };
    try {
      envelope = JSON.parse(ev.data);
    } catch {
      console.warn('[invoke-shim] SSE parse error, raw:', ev.data?.slice?.(0, 200));
      return;
    }

    const eventType = envelope.payload.type;
    console.log('[invoke-shim] SSE event:', eventType);

    if (eventType === 'message.part.delta') {
      // Streaming delta — lightweight event with just the new text chunk
      const props = envelope.payload.properties;
      const sesId = (props.sessionID as string) ?? '';
      if (sesId !== ocSessionId) {
        console.log('[invoke-shim] SKIP delta: sesId mismatch', sesId, '!=', ocSessionId);
        return;
      }

      const partId = (props.partID as string) ?? '';
      const field = (props.field as string) ?? '';
      const delta = (props.delta as string) ?? '';

      if (field === 'text' && delta) {
        console.log('[invoke-shim] EMIT delta:', delta.slice(0, 50));
        emit({ event: 'delta', data: { text: delta } });
        // Track length so message.part.updated doesn't re-emit
        const prevLen = textLengths.get(partId) ?? 0;
        textLengths.set(partId, prevLen + delta.length);
      } else {
        console.log('[invoke-shim] delta field/empty:', field, delta?.length);
      }
    } else if (eventType === 'message.part.updated') {
      const part = (envelope.payload.properties.part || {}) as {
        id: string;
        sessionID?: string;
        messageID?: string;
        type: string;
        text?: string;
        tool?: string;
        call_id?: string;
        state?: Record<string, unknown>;
      };

      if (part.sessionID !== ocSessionId) {
        console.log('[invoke-shim] SKIP part.updated: sesId mismatch', part.sessionID, '!=', ocSessionId);
        return;
      }

      // Skip known messages
      if (part.messageID && (knownMsgIds.has(part.messageID) || userMsgIds.has(part.messageID))) {
        console.log('[invoke-shim] SKIP part.updated: known/user msgId', part.messageID, 'type:', part.type);
        return;
      }
      console.log('[invoke-shim] PROCESS part.updated type:', part.type, 'msgId:', part.messageID);

      switch (part.type) {
        case 'text': {
          // Full text snapshot — use for catch-up if deltas were missed
          if (part.text) {
            const prevLen = textLengths.get(part.id) ?? 0;
            if (part.text.length > prevLen) {
              const delta = part.text.slice(prevLen);
              emit({ event: 'delta', data: { text: delta } });
              textLengths.set(part.id, part.text.length);
            }
          }
          break;
        }
        case 'tool': {
          const callId = part.call_id ?? '';
          const toolName = part.tool ?? 'unknown';
          const state = part.state;
          if (!state) break;

          const status = (state.status as string) ?? '';
          const inputJson = (state.input as string) ?? '';

          if (status === 'running') {
            if (!toolStarted.has(callId)) {
              const isDelegation = toolName === 'mcp_task' || toolName === 'mcp_delegate_task';
              if (isDelegation) {
                let agent = 'subagent';
                if (typeof inputJson === 'string') {
                  if (inputJson.includes('"oracle"')) agent = 'Oracle';
                  else if (inputJson.includes('"explore"')) agent = 'exploring';
                }
                emit({ event: 'status', data: { text: `Delegating to ${agent}...` } });
              }
              emit({ event: 'tool_start', data: { name: toolName, id: callId } });
              toolStarted.add(callId);
            }
          } else if (status === 'completed') {
            if (!toolStarted.has(callId)) {
              emit({ event: 'tool_start', data: { name: toolName, id: callId } });
              toolStarted.add(callId);
            }
            const output =
              (state.metadata as Record<string, unknown>)?.output as string ??
              (state.output as string) ?? '';
            emit({ event: 'tool_end', data: { id: callId, result: output } });
          } else if (status === 'error') {
            const errorMsg = (state.error as string) ?? 'Tool execution failed';
            emit({ event: 'tool_end', data: { id: callId, result: `[error] ${errorMsg}` } });
          }
          break;
        }
        case 'step-start': {
          emit({ event: 'status', data: { text: 'thinking' } });
          break;
        }
        case 'step-finish': {
          // Step completed — useful for UI status
          break;
        }
        case 'reasoning': {
          if (part.text) {
            const prevLen = textLengths.get(part.id) ?? 0;
            if (part.text.length > prevLen) {
              const delta = part.text.slice(prevLen);
              emit({ event: 'reasoning', data: { text: delta } });
              textLengths.set(part.id, part.text.length);
            }
          }
          break;
        }
      }
    } else if (eventType === 'message.updated') {
      const props = envelope.payload.properties as Record<string, unknown>;
      const info = props.info as Record<string, unknown> | undefined;
      if (!info) return;

      const msgSession = (info.sessionID as string) ?? '';
      if (msgSession !== ocSessionId) return;

      const role = (info.role as string) ?? '';
      if (role === 'user' && info.id) {
        userMsgIds.add(info.id as string);
      }

      // Token usage
      const tokens = info.tokens as Record<string, number> | undefined;
      if (tokens) {
        const input = tokens.input ?? 0;
        const output = tokens.output ?? 0;
        if (input > 0 || output > 0) {
          emit({ event: 'usage', data: { input_tokens: input, output_tokens: output } });
        }
      }

      // Error check — only errors terminate the stream
      if (role === 'assistant' && info.error) {
        const mid = (info.id as string) ?? '';
        if (!knownMsgIds.has(mid)) {
          streamFinalized = true;
          emit({ event: 'stream_end' });
          eventSource.close();
          return;
        }
      }

      // NOTE: Do NOT terminate on info.finish — it fires on intermediate
      // assistant turns (e.g., between tool calls) while the session is still
      // active. Only session.idle / session.status.idle reliably indicate
      // the full response is complete. This matches the Rust handler behavior.
    } else if (eventType === 'session.idle') {
      const props = envelope.payload.properties as Record<string, unknown>;
      const idleSession = (props.sessionID as string) ?? '';
      console.log('[invoke-shim] session.idle for:', idleSession, '(ours:', ocSessionId, ')');
      if (idleSession === ocSessionId) {
        streamFinalized = true;
        console.log('[invoke-shim] Stream finalized — emitting stream_end');
        emit({ event: 'stream_end' });
        eventSource.close();
      }
    } else if (eventType === 'session.status') {
      const props = envelope.payload.properties as Record<string, unknown>;
      const sesId = (props.sessionID as string) ?? '';
      const status = props.status as Record<string, unknown> | undefined;
      console.log('[invoke-shim] session.status:', status?.type, 'for:', sesId, '(ours:', ocSessionId, ')');
      if (sesId !== ocSessionId) return;
      if (status?.type === 'idle') {
        streamFinalized = true;
        console.log('[invoke-shim] Stream finalized via session.status — emitting stream_end');
        emit({ event: 'stream_end' });
        eventSource.close();
      }
    }
  };

  // ── SSE reconnection with exponential backoff ────────────────────────
  const attachErrorHandler = (es: EventSource) => {
    es.onerror = () => {
      console.warn('[invoke-shim] SSE error event, readyState:', es.readyState, 'finalized:', streamFinalized, 'errorCount:', sseErrorCount + 1);
      if (streamFinalized) return;
      sseErrorCount++;

      // EventSource auto-reconnects on its own, but after consecutive
      // failures we take manual control: close and reopen with backoff.
      if (sseErrorCount >= 5) {
        es.close();
        reconnectAttempts++;

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.warn(`[invoke-shim] SSE reconnection exhausted (${MAX_RECONNECT_ATTEMPTS} attempts), finalizing`);
          streamFinalized = true;
          emit({ event: 'stream_end' });
          return;
        }

        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, reconnectAttempts - 1), BACKOFF_MAX_MS);
        console.warn(`[invoke-shim] SSE reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

        setTimeout(() => {
          if (streamFinalized) return;
          const newEs = new EventSource(eventUrl);
          // Re-attach the stored onmessage handler (closure captures shared state)
          newEs.onmessage = messageHandler;
          attachErrorHandler(newEs);
          eventSource = newEs;
          sseErrorCount = 0;
          // Update channel reference so abort can close the new one
          if (onEvent && '_eventSource' in onEvent) {
            (onEvent as WebChannel)._eventSource = newEs;
          }
        }, delay);
      }
    };
  };

  // Store onmessage reference so reconnection can re-attach it
  const messageHandler = eventSource.onmessage;
  attachErrorHandler(eventSource);

  // Store the eventSource on the channel so abort can close it
  if (onEvent && '_eventSource' in onEvent) {
    (onEvent as WebChannel)._eventSource = eventSource;
  }
}

WEB_COMMANDS['opencode_send'] = webOpencodeSend;

/**
 * Queue a message to an existing OpenCode session without opening a new SSE
 * stream.  Used when the user sends additional messages while AI is already
 * streaming — OpenCode queues them and the AI reads them between tool calls.
 */
async function webOpencodeQueue(args: InvokeArgs): Promise<void> {
  const ocSessionId = args.ocSessionId as string;
  const content = args.content as string;
  const images = (args.images as [string, string][] | undefined) ?? [];

  const parts: unknown[] = [];
  for (let i = 0; i < images.length; i++) {
    const [mime, b64] = images[i];
    parts.push({
      type: 'file',
      mime,
      url: `data:${mime};base64,${b64}`,
      filename: `image_${i}.${mime.split('/').pop() || 'png'}`,
    });
  }
  if (content) {
    parts.push({ type: 'text', text: content });
  }

  console.log('[invoke-shim] opencode_queue: posting to session', ocSessionId);
  await fetch(withDir(`/session/${ocSessionId}/prompt_async`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
  });
}

WEB_COMMANDS['opencode_queue'] = webOpencodeQueue;

// ── Main invoke function ─────────────────────────────────────────────────

/**
 * Universal invoke — works in both Tauri and web contexts.
 *
 * In Tauri: delegates to the real `invoke()` from @tauri-apps/api/core.
 * In Web: looks up the command in WEB_COMMANDS and executes the HTTP equivalent.
 */
export async function invoke<T = unknown>(cmd: string, args?: InvokeArgs): Promise<T> {
  if (isTauri && _realInvoke) {
    return _realInvoke(cmd, args) as Promise<T>;
  }

  const handler = WEB_COMMANDS[cmd];
  if (!handler) {
    console.warn(`[invoke-shim] Unknown command: ${cmd}`);
    throw new Error(`Command not supported in web mode: ${cmd}`);
  }

  return handler(args ?? {}) as Promise<T>;
}

// ── WebChannel — web-compatible replacement for Tauri Channel ────────────

/**
 * In Tauri, `Channel` is an IPC callback channel. In web mode, it's just
 * a callback holder. The SSE handler in webOpencodeSend calls onmessage directly.
 */
export class WebChannel<T = unknown> {
  onmessage: ((message: T) => void) | null = null;
  _eventSource: EventSource | null = null;

  close(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }
}

/**
 * Channel constructor — returns a real Tauri Channel or a WebChannel.
 */
export function createChannel<T>(): WebChannel<T> {
  if (isTauri && _RealChannel) {
    return new (_RealChannel as unknown as { new(): WebChannel<T> })();
  }
  return new WebChannel<T>();
}

// Re-export Channel type for compatibility
export { WebChannel as Channel };
