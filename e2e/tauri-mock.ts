export function installTauriMock(): void {
  function uid(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  const SESSION_A_ID = 'sess-aaa111';
  const SESSION_B_ID = 'sess-bbb222';
  const SESSION_C_ID = 'sess-ccc333';

  const FAKE_SESSIONS = [
    {
      id: SESSION_A_ID,
      name: 'Build a REST API server',
      createdAt: Date.now() - 3_600_000 * 2,
      messages: [
        { id: uid(), role: 'user', content: 'Build me a REST API server in Node.js', timestamp: Date.now() - 3_600_000 * 2 },
        { id: uid(), role: 'assistant', content: "I'll build a REST API server for you.\n\n```javascript\nconst express = require('express');\nconst app = express();\napp.listen(3000);\n```", timestamp: Date.now() - 3_600_000 * 2 + 5000 },
      ],
    },
    {
      id: SESSION_B_ID,
      name: 'Debug Python script',
      createdAt: Date.now() - 3_600_000,
      messages: [
        { id: uid(), role: 'user', content: 'My Python script keeps crashing with a TypeError', timestamp: Date.now() - 3_600_000 },
        { id: uid(), role: 'assistant', content: "TypeErrors usually happen when you pass the wrong type.", timestamp: Date.now() - 3_600_000 + 3000 },
        { id: uid(), role: 'user', content: "TypeError: unsupported operand type(s) for +: 'int' and 'str'", timestamp: Date.now() - 3_600_000 + 6000 },
      ],
    },
    {
      id: SESSION_C_ID,
      name: 'Explain transformers',
      createdAt: Date.now() - 1800,
      messages: [
        { id: uid(), role: 'user', content: 'Explain how transformer attention works', timestamp: Date.now() - 1800 },
        { id: uid(), role: 'assistant', content: 'Transformer attention uses **queries**, **keys**, and **values**.', timestamp: Date.now() - 900 },
      ],
    },
  ];

  type StoreData = Map<string, unknown>;

  const storesByPath: Record<string, StoreData> = {
    'sessions.json': new Map<string, unknown>([
      ['sessions', FAKE_SESSIONS],
      ['active_session_id', SESSION_A_ID],
      ['is_draft', false],
      ['weekly_usage', { input: 12000, output: 8000 }],
      ['weekly_reset_at', Date.now() - 86400000 * 2],
    ]),
    'settings.json': new Map<string, unknown>([
      ['language', 'en'],
      ['mbti_type', 'INTJ'],
      ['readme_seen', true],
    ]),
  };

  const ridToPath: Record<number, string> = {};
  let nextRid = 1;

  function ensureStore(path: string): StoreData {
    if (!storesByPath[path]) storesByPath[path] = new Map();
    return storesByPath[path];
  }

  type InvokeArgs = Record<string, unknown>;

  function handleInvoke(cmd: string, args?: InvokeArgs): unknown {
    if (cmd === 'plugin:store|load') {
      const path = (args?.path as string) ?? 'default.json';
      const rid = nextRid++;
      ridToPath[rid] = path;
      ensureStore(path);
      return rid;
    }

    if (cmd === 'plugin:store|get_store') {
      const path = (args?.path as string) ?? 'default.json';
      if (!storesByPath[path]) return null;
      const rid = nextRid++;
      ridToPath[rid] = path;
      return rid;
    }

    if (cmd === 'plugin:store|get') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      const key = args?.key as string;
      const store = ensureStore(path);
      const exists = store.has(key);
      const value = exists ? store.get(key) : null;
      return [value, exists];
    }

    if (cmd === 'plugin:store|set') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      const key = args?.key as string;
      const value = args?.value;
      ensureStore(path).set(key, value);
      return null;
    }

    if (cmd === 'plugin:store|has') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      const key = args?.key as string;
      return ensureStore(path).has(key);
    }

    if (cmd === 'plugin:store|delete') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      const key = args?.key as string;
      return ensureStore(path).delete(key);
    }

    if (cmd === 'plugin:store|keys') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      return Array.from(ensureStore(path).keys());
    }

    if (cmd === 'plugin:store|values') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      return Array.from(ensureStore(path).values());
    }

    if (cmd === 'plugin:store|entries') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      return Array.from(ensureStore(path).entries());
    }

    if (cmd === 'plugin:store|length') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      return ensureStore(path).size;
    }

    if (cmd === 'plugin:store|clear') {
      const rid = args?.rid as number;
      const path = ridToPath[rid] ?? 'default.json';
      ensureStore(path).clear();
      return null;
    }

    if (cmd === 'plugin:store|save' || cmd === 'plugin:store|reload' || cmd === 'plugin:store|reset' || cmd === 'plugin:store|close') {
      return null;
    }

    if (cmd === 'plugin:resources|close') return null;
    if (cmd === 'plugin:event|listen' || cmd === 'plugin:event|once' || cmd === 'plugin:event|emit' || cmd === 'plugin:event|unlisten') return 1;
    if (cmd === 'plugin:opener|open_url') return null;
    if (cmd === 'plugin:window|minimize') return null;
    if (cmd === 'plugin:window|toggle_maximize') return null;
    if (cmd === 'plugin:window|close') return null;
    if (cmd === 'plugin:window|is_maximized') return false;
    if (cmd === 'plugin:window|start_dragging') return null;
    if (cmd === 'plugin:window|set_always_on_top') return null;

    if (cmd === 'is_authenticated') return true;
    if (cmd === 'get_working_directory') return '/home/test/workspace';
    if (cmd === 'set_working_directory') return null;
    if (cmd === 'chat_send') return null;
    if (cmd === 'abort_stream') return null;
    if (cmd === 'send_feedback') return null;
    if (cmd === 'set_session_key') return null;
    if (cmd === 'get_system_prompt') return 'You are Winter';
    if (cmd === 'get_authorize_url') return 'https://example.com/auth';
    if (cmd === 'exchange_code') return null;
    if (cmd === 'logout') return null;
    if (cmd === 'search_directories') return [];
    if (cmd === 'opencode_check') return false;
    if (cmd === 'opencode_create_session') return 'oc-mock-session';
    if (cmd === 'opencode_send') return null;
    if (cmd === 'opencode_abort') return null;
    if (cmd === 'get_ollama_status') return { installed: false, running: false, models: [] };
    if (cmd === 'fetch_claude_usage') {
      return {
        five_hour: { utilization: 42, resets_at: null },
        seven_day: { utilization: 15, resets_at: null },
        seven_day_opus: null,
      };
    }

    console.warn('[tauri-mock] Unhandled:', cmd, args);
    return null;
  }

  const win = window as unknown as Record<string, unknown>;

  const internals = {
    invoke: (cmd: string, args?: InvokeArgs) => Promise.resolve(handleInvoke(cmd, args)),
    transformCallback: (fn: (val: unknown) => void, once: boolean) => {
      const id = Math.random();
      const key = `_tauri_cb_${id}`;
      if (once) {
        win[key] = (val: unknown) => { (fn as (v: unknown) => void)(val); delete win[key]; };
      } else {
        win[key] = fn;
      }
      return id;
    },
    isTauri: true,
    metadata: {
      currentWindow: { label: 'main' },
      windows: [{ label: 'main' }],
    },
  };

  win.__TAURI_INTERNALS__ = internals;

  win.__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: InvokeArgs) => Promise.resolve(handleInvoke(cmd, args)),
    },
  };

  win.isTauri = true;
}
