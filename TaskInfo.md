# Winter App — Task Info

## Project Overview

**Winter** is a Tauri-based desktop chat application (React + Rust) that provides a native wrapper around Claude AI with local Ollama integration and OpenCode bridge.

## Current Version: `1.4.0`

- **GitHub**: `https://github.com/gyugoat/winter-app`
- **CI**: `.github/workflows/ci.yml` (tsc + cargo check)
- **Release**: `.github/workflows/release.yml` (Win/Mac/Linux builds on tag push)
- **One-click update**: `bash winter-update.sh [patch|minor|major]`
- **Launcher**: `winter-app/winter.sh` → `~/.local/bin/winter`

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| Backend | Rust (Tauri 2) |
| AI — Direct | Claude API (OAuth PKCE, streaming, multi-turn tool use) |
| AI — Local | Ollama (context compression, history summarization) |
| AI — Bridge | OpenCode API (SSE streaming, file browsing, question tool) |
| Build | GitHub Actions → `.msi` / `.dmg` / `.deb` / `.AppImage` |
| Store | `@tauri-apps/plugin-store` (local JSON) |

---

## Hard Rules

1. **No UI libraries** — no MUI, shadcn, Tailwind, styled-components. Pure CSS only.
2. **No `as any`, `@ts-ignore`, `@ts-expect-error`**.
3. **No emoji in rendered UI** — Ubuntu WebKit doesn't render them. Inline SVG only.
4. **Every interactive button → `useClickFlash`** — `onFlash(e)` in onClick.
5. **All colors → CSS variables** from `src/styles/global.css`.
6. **SVG icons only** — no icon libs, no emoji, no image files for icons.
7. **Tauri v2 API** — NOT v1.
8. **Drag regions** — `data-tauri-drag-region`.
9. **No frontend system prompt injection** — MBTI modifier read server-side from store.
10. **No react-markdown** — Use `marked` + `DOMPurify` (already done).
11. **Cargo path** — `~/.cargo/bin/cargo`.
12. **Comments** — Minimal. Section dividers, edge-case, TODOs only.
13. **Git** — `git -c user.name="gyugoat" -c user.email="gyugoat@users.noreply.github.com"`.
14. **No frontend fetch to OpenCode** — All OpenCode API calls go through Tauri invoke (Rust proxy).

---

## Architecture

### Layout (visual)
```
┌─────────────────────────────────────────────────────────────────┐
│ Titlebar: "Winter" + SVG diamond (left) │ drag │ — □ × (right) │
├─────────────────────────────────────────────────────────────────┤
│ [≡] (floating hamburger, z-48)                                  │
│ ┌──────────┐                                          ┌───────┐│
│ │ Sidebar  │  SnowBackground (canvas, z-0)            │File   ││
│ │ (overlay)│                                          │Changes││
│ │ z-50     │  MessageList (z-1)                       │(right)││
│ │          │    empty: diamond + "Do you wanna..."    │panel  ││
│ │          │    filled: message bubbles w/ diamonds    │       ││
│ │          │                                          │       ││
│ │          │  QuestionDock (sticky bottom, above input)│       ││
│ │          │  MessageInput (z-1)                       │       ││
│ │          │    ┌─────────────────────────────┐       │       ││
│ │          │    │ Ask Winter...                │       │       ││
│ │          │    │ [+]                    [▶/■] │       │       ││
│ │          │    └─────────────────────────────┘       │       ││
│ └──────────┘                                          └───────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Component Tree (v1.4.0)
```
App.tsx — phase router (splash → auth → chat)
├── I18nProvider — wraps entire app, locale from store
├── Splash.tsx — canvas particles, click-to-melt (3s), delta-time physics
├── Auth.tsx — OAuth PKCE card (i18n'd)
└── Chat.tsx — main layout, settings router, shortcuts, toast, question dock
    ├── Titlebar.tsx — "Winter" + SVG diamond, window controls
    ├── Sidebar.tsx — session list, kebab menus, settings popup, search, progressive rendering
    ├── SnowBackground.tsx — canvas, 20 particles, ground accumulation, Olaf snowman (10min build)
    ├── Settings.tsx — sub-page renderer (shortcuts/personalize/language/feedback/archive)
    │   Sub-components: FolderBrowser, MobileLinkCard, ModelSelector, OllamaCard, TokenUsageCard
    ├── Readme.tsx — first-run guide (mobile, shortcuts, model sections)
    ├── MessageList.tsx — messages with markdown (Web Worker), streaming cursor, progressive rendering
    ├── QuestionDock.tsx — OpenCode question tool UI (multiple choice, custom input)
    ├── MessageInput.tsx — bubble input, send/stop toggle, image paste/drop
    ├── FileChanges.tsx — right-side panel, tree view (Changes / All files)
    ├── FileViewer.tsx — file content viewer (via Tauri invoke)
    └── IdleScreen.tsx — idle state display
```

### Hooks
| Hook | File | Lines | Purpose |
|------|------|-------|---------|
| `useChat` | `useChat.ts` | 482 | Session CRUD, persistence (store), Claude streaming, OpenCode bridge streaming, archive |
| `useAuth` | `useAuth.ts` | 40 | OAuth PKCE flow via Tauri invoke |
| `useClickFlash` | `useClickFlash.ts` | 15 | Click feedback animation |
| `useShortcuts` | `useShortcuts.ts` | 135 | 9+ keyboard shortcuts, sent history (max 20) |
| `useTheme` | `useTheme.ts` | 40 | system/light/dark theme switching |
| `useIdle` | `useIdle.ts` | 35 | Idle detection |
| `useFileChanges` | `useFileChanges.ts` | 305 | OpenCode file change detection + directory browser (via invoke) |
| `useMarkdownWorker` | `useMarkdownWorker.ts` | 79 | Off-main-thread markdown rendering via Web Worker |
| `useQuestion` | `useQuestion.ts` | 63 | OpenCode question tool polling/reply/reject (via invoke) |
| `useI18n` | `i18n/index.ts` | — | `{ locale, setLocale, t }` |

### Workers
| File | Purpose |
|------|---------|
| `markdown.worker.ts` | `marked` + `highlight.js` off main thread — receives raw markdown, returns HTML |

### i18n System
- `src/i18n/en.ts` — ~160 keys, exports `TranslationKey` type
- `src/i18n/{ko,ja,zh}.ts` — same keys
- `src/i18n/I18nProvider.tsx` — context provider, reads `language` from store
- Store key: `language` (Locale: 'en'|'ko'|'ja'|'zh')
- Pattern: `const { t } = useI18n(); t('keyName')`

### Key Conventions
- **CSS**: One `.css` file per component in `src/styles/`. Uses CSS custom properties.
- **Hooks**: Business logic lives in hooks, not components. Components are presentation-only where possible.
- **i18n**: All user-facing strings go through `useI18n()`. Add keys to all 4 locale files.
- **Tauri commands**: Defined with `#[tauri::command]` in `lib.rs`, registered in `run()` → `.invoke_handler()`.
- **Version**: Must be synchronized across 3 files: `package.json`, `Cargo.toml`, `tauri.conf.json`.

---

## Dual Chat Backend

### 1. Claude Direct (chat_send)
- OAuth PKCE authentication → `Authorization: Bearer` header
- Model selection: `claude-opus-4-20250514` (default), configurable via store key `claude_model`
- Max tokens: 16384
- Multi-turn tool use loop (25 rounds max)
- 4 tools: `shell_exec`, `file_read`, `file_write`, `file_list`
- Abort via `Arc<AtomicBool>` managed state
- Ollama integration: compresses history (>10 messages), summarizes long tool output (>3000 chars)
- Token refresh: auto-refresh on AUTH_EXPIRED with mutex guard

### 2. OpenCode Bridge (opencode_send)
- Connects to OpenCode server at configurable working directory (store key `working_directory`)
- Default dir: `~/.winter/workspace`
- SSE streaming via `/global/event` endpoint
- Session management: create session, prompt_async, abort
- Idle ping: 60s timeout → sends "continue" (max 3 pings)
- Auto-reconnect on SSE errors
- Delta-based text streaming (tracks per-part text lengths)
- Tool status events: delegation detection (Sum/Mer/Frost/Oracle/Spring/explore/librarian)
- Question tool integration via polling
- Token usage tracking from message metadata

### Proxy Commands (frontend invoke → Rust → OpenCode HTTP)
| Tauri Command | OpenCode Endpoint | Purpose |
|---------------|-------------------|---------|
| `opencode_check` | `/global/health` | Health check |
| `opencode_create_session` | `POST /session` | Create session |
| `opencode_send` | `POST /session/{id}/prompt_async` + SSE | Send + stream |
| `opencode_abort` | `POST /session/{id}/abort` | Abort |
| `opencode_get_path` | `/path` | Get home/worktree/directory |
| `opencode_list_files` | `/file?path=X` | Directory listing |
| `opencode_file_content` | `/file/content?path=X` | File content |
| `opencode_get_questions` | `/question` | Poll questions |
| `opencode_reply_question` | `POST /question/{id}/reply` | Answer question |
| `opencode_reject_question` | `POST /question/{id}/reject` | Skip question |
| `opencode_get_messages` | `/session/{id}/message` | Get session messages |

---

## Rust Backend (src-tauri/src/ — 1996 lines total)

### lib.rs (1040 lines)
- Constants: API URLs, model config, system prompt (anti-summary hardcoded)
- Types: `MessageContent`, `ContentBlock`, `ChatMessage`, `ChatStreamEvent`
- `build_system_prompt(app)` — base + MBTI modifier from store
- `get_model(app)` — reads `claude_model` from store, defaults to opus
- `tool_definitions()` — 4 tools (shell_exec, file_read, file_write, file_list)
- `execute_tool()` — runs tools, 30s timeout on shell_exec
- `stream_response()` — SSE parsing, delta extraction, usage tracking
- `chat_send` — main Claude loop with tool use + Ollama compression + token refresh
- OAuth PKCE: `get_authorize_url`, `exchange_code`, `is_authenticated`, `logout`
- `send_feedback` — HTTP POST
- `abort_stream` — sets AtomicBool
- `fetch_claude_usage` / `set_session_key` — token usage from claude.ai
- Ollama commands: `ollama_is_installed`, `ollama_install`, `ollama_check`, `ollama_models`, `ollama_toggle`, `ollama_set_config`
- OpenCode proxy commands (see table above)
- Working directory: `get_working_directory`, `set_working_directory`, `create_directory`, `search_directories`

### ollama.rs (334 lines)
- `OllamaSettings`: enabled, base_url, model
- `default_model_for_system()` — auto-selects model by available RAM (3b/7b/14b)
- `get_settings(app)` — reads from store
- `summarize()` — compresses long tool output
- `compress_history()` — summarizes old messages when >10 in conversation
- Installation: `ollama_is_installed`, `ollama_install` (curl + systemd)
- Health check, model listing

### opencode.rs (622 lines)
- Types: `OcSession`, `SseMessagePart`, `SsePayload`, `SseEnvelope`
- `OpenCodeClient`: base_url, directory, reqwest client
- Session ops: `create_session`, `prompt_async`, `abort`
- SSE subscriber: `subscribe_sse` — reconnecting SSE with idle-ping (60s timeout, 3 max pings)
- Event parsing: `message.part.updated` (text/tool/step-start), `message.updated` (finish/tokens)
- Delegation detection: Sum/Mer/Frost/Oracle/Spring/explore/librarian from tool input
- Proxy methods: `get_path_info`, `list_files`, `file_content`, `get_questions`, `reply_question`, `reject_question`, `get_session_messages`

---

## Session & Archive Logic (useChat.ts — 482 lines)
```
State:
  sessions: Session[]           — ALL sessions (active + archived)
  activeSessionId: string|null  — null when in draft
  isDraft: boolean              — true = empty state
  isStreaming: boolean           — blocks concurrent sends
  ocSessionId: string|null      — OpenCode session ID (per session)

Archive:
  Session.archived?: boolean
  archiveSession(id) — sets archived: true, navigates to next or draft
  Sidebar: sessions.filter(s => !s.archived)
  Archive page: sessions.filter(s => s.archived)
  Delete: filters to !s.archived before picking fallback

Persistence: tauri-plugin-store → sessions.json
  Keys: sessions, active_session_id, is_draft
  Debounced saves (500ms)

Auto-naming: First user message truncated to ~25 chars
Toast: { text, type } — archive/delete/new session, 1.5s auto-dismiss
```

---

## Settings System

### Two-Tier Architecture
- **Tier 1**: Popup menu (gear in sidebar footer, `position:fixed; bottom:56px; left:10px; z:60`)
  - Theme► / Token usage► → right-side sub-popup
  - Shortcuts› / Language› / Feedback› / Archive› / Personalize› → sub-page
- **Tier 2**: Sub-pages (replace chat area, sidebar stays visible)
  - State: `settingsPage: null | 'shortcuts' | 'personalize' | 'language' | 'feedback' | 'archive'`

### Sub-pages
- **Shortcuts**: 3×2 grid of shortcut cards
- **Personalize**: Apps (Mobile Link QR), Automation, Model selector (Opus/Sonnet/Haiku), MBTI badges + randomizer, Ollama card, Folder browser, Advanced
- **Language**: Scrollable list, 2-letter code badges
- **Feedback**: Textarea + send pill + SMTP password input
- **Archive**: Archived sessions grouped by date

---

## CSS Theme (src/styles/global.css)
```css
--bg-deep: #0f0d1a        /* app background */
--bg-panel: #13111f        /* titlebar, sidebar */
--bg-elevated: #1a1730     /* cards, menus */
--bg-hover: #221f35        /* hover states */
--bg-active: #2a2645       /* active/pressed */
--bubble-winter: rgba(139, 92, 246, 0.13)
--bubble-user: rgba(59, 130, 246, 0.13)
--text-primary: #e5e5e5
--text-secondary: #a1a1a1
--text-muted: #555
--accent: #7aa2f7          /* blue accent */
--accent-purple: #8b5cf6
--border: rgba(255, 255, 255, 0.06)
--glow-diamond: rgba(122, 162, 247, 0.5)
```

### CSS Files (14)
| File | Scope |
|------|-------|
| `global.css` | Variables, reset, scrollbar, window animations, clickFlash, light theme |
| `titlebar.css` | Titlebar, title, diamond icon, window buttons |
| `chat.css` | Chat layout, floating hamburger, brand header, file changes toggle |
| `sidebar.css` | Sidebar overlay, panel, sessions, kebab, settings popup, search, skeleton |
| `messages.css` | Message list, empty state, bubbles, markdown, code blocks, streaming cursor |
| `input.css` | Input bar, bubble, field, attach/send/stop buttons |
| `settings.css` | All settings sub-pages (shortcuts, personalize, language, feedback, ollama, model, folder, mobile link) |
| `archive.css` | Archive page |
| `splash.css` | Splash screen |
| `auth.css` | Auth screen |
| `filechanges.css` | File changes panel (tree view, status indicators) |
| `fileviewer.css` | File viewer |
| `question.css` | Question dock (multiple choice, custom input) |
| `readme.css` | First-run readme page |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New session |
| Ctrl+Q | Archive active session + navigate away |
| Ctrl+Enter | Focus chat textarea |
| Ctrl+[ / ] | Previous / next session |
| Ctrl+Backspace | Delete session |
| Ctrl+K | Attach file (placeholder) |
| Ctrl+P | Toggle always-on-top |
| Ctrl+↑/↓ | Navigate sent history (max 20) |
| Esc | Stop streaming |

---

## Types (src/types.ts — 72 lines)
```typescript
ImageAttachment { mediaType, data }
Message { id, role, content, timestamp, isStreaming?, statusText?, images? }
Session { id, name, messages[], createdAt, archived?, ocSessionId? }
ChatStreamEvent — stream_start | delta | tool_start | tool_end | stream_end | error | ollama_status | status | usage
FileChange { path, absolute?, status, additions, deletions }
FileDiff { path, before, after, hunks[] }
DiffHunk { header, lines[] }
DiffLine { type, content, oldLineNumber?, newLineNumber? }
FileTreeNode { name, path, type, children?, change? }
```

---

## Dependencies

### Rust (Cargo.toml)
`tauri` 2, `tauri-plugin-store` 2, `tauri-plugin-opener` 2, `reqwest` (stream, rustls-tls, json), `tokio` (full), `futures`, `serde`/`serde_json`, `sha2`, `base64`, `rand`, `urlencoding`, `sysinfo` (system)

### Frontend (package.json)
`@tauri-apps/api` ^2, `@tauri-apps/plugin-store` ^2.4.2, `@tauri-apps/plugin-opener` ^2, `react` ^19.1, `react-dom` ^19.1, `marked` ^17, `dompurify` ^3.3, `highlight.js` ^11.11, `qrcode` ^1.5

### Capabilities (default.json — 12 permissions)
`core:default`, `core:window:{default, allow-start-dragging, allow-minimize, allow-toggle-maximize, allow-close, allow-set-always-on-top, allow-is-maximized}`, `opener:default`, `store:default`

---

## Store Keys

### settings.json (Rust-managed)
| Key | Type | Purpose |
|-----|------|---------|
| `oauth_access_token` | string | OAuth access token |
| `oauth_refresh_token` | string | OAuth refresh token |
| `oauth_expires` | number | Token expiry |
| `mbti_prompt_modifier` | string | MBTI personality prompt text |
| `mbti_type` | string | MBTI code (e.g. "INTJ") |
| `language` | string | UI locale |
| `smtp_app_password` | string | Gmail app password |
| `claude_model` | string | Claude model ID |
| `ollama_enabled` | boolean | Ollama on/off |
| `ollama_url` | string | Ollama base URL |
| `ollama_model` | string | Ollama model name |
| `working_directory` | string | OpenCode working directory |
| `session_key` | string | claude.ai session key for usage API |

### sessions.json (frontend-managed)
| Key | Type | Purpose |
|-----|------|---------|
| `sessions` | Session[] | All sessions |
| `active_session_id` | string\|null | Active session |
| `is_draft` | boolean | Draft state |

---

## File Map
```
winter-app/
├── src/
│   ├── App.tsx                         ← Phase router (splash→auth→chat)
│   ├── types.ts                        ← Message, Session, ChatStreamEvent, FileChange, FileTreeNode (72 lines)
│   ├── main.tsx                        ← Entry point
│   ├── components/
│   │   ├── Auth.tsx                    ← OAuth PKCE card (91 lines)
│   │   ├── Chat.tsx                    ← Main layout + settings + shortcuts + toast + question (345 lines)
│   │   ├── Diamond.tsx                 ← Reusable diamond SVG (25 lines)
│   │   ├── FileChanges.tsx             ← Right-side file changes panel (199 lines)
│   │   ├── FileViewer.tsx              ← File content viewer via invoke (75 lines)
│   │   ├── IdleScreen.tsx              ← Idle state display (301 lines)
│   │   ├── MessageInput.tsx            ← Bubble input, send/stop, image paste (204 lines)
│   │   ├── MessageList.tsx             ← Messages + markdown worker + streaming cursor (266 lines)
│   │   ├── QuestionDock.tsx            ← OpenCode question tool UI (172 lines)
│   │   ├── Readme.tsx                  ← First-run guide (123 lines)
│   │   ├── Settings.tsx                ← All settings sub-pages (1060 lines)
│   │   ├── Sidebar.tsx                 ← Session list, kebab, search (588 lines)
│   │   ├── SnowBackground.tsx          ← Canvas snow + ground + Olaf (307 lines)
│   │   ├── Splash.tsx                  ← Canvas particles, delta-time (245 lines)
│   │   └── Titlebar.tsx                ← Window chrome, diamond logo (90 lines)
│   ├── data/
│   │   └── mbti-personalities.ts       ← 16 MBTI types → prompt modifier text
│   ├── hooks/
│   │   ├── useAuth.ts                  ← OAuth PKCE (40 lines)
│   │   ├── useChat.ts                  ← Sessions, streaming, persistence (482 lines)
│   │   ├── useClickFlash.ts            ← Click feedback (15 lines)
│   │   ├── useFileChanges.ts           ← File changes + directory browser (305 lines)
│   │   ├── useIdle.ts                  ← Idle detection (35 lines)
│   │   ├── useMarkdownWorker.ts        ← Web Worker markdown bridge (79 lines)
│   │   ├── useQuestion.ts              ← Question tool via invoke (63 lines)
│   │   ├── useShortcuts.ts             ← 9+ shortcuts + sent history (135 lines)
│   │   └── useTheme.ts                 ← system/light/dark (40 lines)
│   ├── i18n/
│   │   ├── I18nProvider.tsx, index.ts, en.ts (~160 keys), ko.ts, ja.ts, zh.ts
│   ├── workers/
│   │   └── markdown.worker.ts          ← marked + hljs off main thread (70 lines)
│   └── styles/
│       ├── global.css, titlebar.css, chat.css, sidebar.css
│       ├── messages.css, input.css, settings.css, archive.css
│       ├── splash.css, auth.css, filechanges.css, fileviewer.css
│       ├── question.css, readme.css
├── src-tauri/
│   ├── Cargo.toml                      ← Rust deps (sysinfo, no lettre)
│   ├── tauri.conf.json                 ← Window 1100x800, no localhost in CSP
│   ├── capabilities/default.json       ← 12 permissions
│   └── src/
│       ├── lib.rs                      ← Claude API + tools + auth + commands (1040 lines)
│       ├── ollama.rs                   ← Ollama integration + compression (334 lines)
│       ├── opencode.rs                 ← OpenCode client + SSE + proxy (622 lines)
│       └── main.rs                     ← Entry point
├── .github/workflows/
│   ├── ci.yml                          ← tsc + cargo check
│   └── release.yml                     ← Installers on tag push
├── winter-update.sh                    ← One-click release script
├── RELEASE.md, winter.sh, index.html
```

---

## Animations
| Name | Type | Where | What |
|------|------|-------|------|
| `clickFlash` | keyframes | global.css | Blue glow flash, 0.3s |
| `win-minimize` | transition | global.css | scale(0.92) + translateY(12px) + opacity:0 |
| `win-restore` | keyframes | global.css | scale(0.95)→1 + opacity 0.6→1 |
| `float` | keyframes | messages.css | Diamond bobbing in empty state |
| `msgIn` | keyframes | messages.css | Message slide-in from bottom |
| `toastDropAway` | keyframes | chat.css | Toast slide down + fade out (1.5s) |
| `diamondSpin` | keyframes | messages.css | Diamond spin during streaming |

---

## Known Gaps

- **Copy/Copied!** in code blocks: Hardcoded English
- **File attach**: UI button exists, no backend
- **Ctrl+P**: Doesn't work in WSLg (test native Windows)
- **Auth screen**: No drag region
- **OAuth refresh**: Token refresh implemented but edge cases untested
- **FileChanges bash parsing**: Quoted paths with spaces silently missed
- **Select Folder search slow**: BFS from $HOME depth 6, sequential. Fix: `ignore` crate, reduce depth, cache.

## Future: Automations Panel
Migrate crontab jobs (Phoenix, logging, Obsidian daily log) into Winter app. Hybrid approach: app UI toggles, system executor (systemd/cron).

---

## Environment
- **WSL** (Ubuntu) on Windows
- **Tailscale**: `100.72.94.73`
- **Mobile web**: `http://100.72.94.73:8890`
- **Cargo**: `~/.cargo/bin/cargo`
- **Store (runtime)**: `~/.local/share/com.gyugo.winter/{settings,sessions}.json`
- **OpenCode workspace**: `~/.winter/workspace` (migrated from `.openclaw-winter`)
