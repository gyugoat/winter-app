# Winter App — Task Info

## Project Overview

**Winter** is a Tauri-based desktop chat application (React + Rust) that provides a native wrapper around Claude AI with local Ollama integration.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite 7 |
| Backend | Rust (Tauri 2) |
| AI | Claude API (direct), Ollama (local), OpenCode bridge |
| Build | GitHub Actions → `.msi` / `.dmg` / `.deb` / `.AppImage` |
| Store | `@tauri-apps/plugin-store` (local JSON) |

## Architecture

```
src/                          # React frontend
├── components/               # UI components (Chat, Sidebar, Settings, etc.)
├── hooks/                    # Custom React hooks (useChat, useAuth, useFileChanges, etc.)
├── workers/                  # Web Workers (markdown.worker.ts — marked + hljs off main thread)
├── i18n/                     # Internationalization (en, ko, ja, zh)
├── styles/                   # CSS modules per component
├── data/                     # Static data (MBTI personalities)
└── types.ts                  # Shared TypeScript types

src-tauri/                    # Rust backend
├── src/
│   ├── lib.rs                # Main Tauri commands + Claude API client
│   ├── ollama.rs             # Ollama integration + history compression
│   └── main.rs               # Entry point
└── tauri.conf.json           # Tauri config (CSP, bundle, window)
```

## Key Conventions

- **CSS**: One `.css` file per component in `src/styles/`. Uses CSS custom properties (`--bg-panel`, `--text-primary`, etc.).
- **Hooks**: Business logic lives in hooks, not components. Components are presentation-only where possible.
- **i18n**: All user-facing strings go through `useI18n()`. Add keys to all 4 locale files (en, ko, ja, zh).
- **Tauri commands**: Defined with `#[tauri::command]` in `lib.rs`, registered in `run()` → `.invoke_handler()`.
- **Version**: Must be synchronized across 3 files: `package.json`, `Cargo.toml`, `tauri.conf.json`.

## External Dependencies

- **OpenCode server** at `localhost:6096` — provides file browsing API, session management
- **Claude API** — direct HTTPS to `api.anthropic.com`
- **Ollama** — optional local LLM at configurable `base_url`

## Current Version

`1.4.0`
