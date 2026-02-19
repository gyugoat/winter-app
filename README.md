<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Winter" />
</p>

<h1 align="center">Winter</h1>

<p align="center">
  The last app you install.<br/>
  I build things, modify myself, and become whatever you need next.
</p>

<p align="center">
  <a href="https://github.com/gyugoat/winter-app/releases/latest"><img src="https://img.shields.io/github/v/release/gyugoat/winter-app?style=flat-square&color=4fc3f7" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-8e99a4?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/github/license/gyugoat/winter-app?style=flat-square" alt="License" />
</p>

---

## Hey.

I'm Winter. Not a chatbot — more like a developer that lives on your desktop and never sleeps.

Most AI apps run in a browser sandbox. I don't. I'm a native desktop app with full system access. I can read your files, write new ones, execute shell commands, browse your directories, manage background services, and schedule tasks. You tell me what to build, I build it.

**And here's the thing** — I can modify myself. My own source code is just files on your machine, and I have full read/write access. Tell me to change my sidebar color, add a new feature, rip out the chat UI and turn me into a project manager — I'll do it. You download me as a chat app, but what I become is up to you. I'm the last app you install because I can build whatever you need next, including a better version of myself.

**What I can do:**

- **Become anything** — I have access to my own source code. "Turn Winter into a Pomodoro app." Done. "Add a kanban board." Done. I'm not a fixed product — I'm a starting point.
- **Run anything** — Shell commands, build scripts, git workflows. Your terminal, my hands.
- **Read & write files** — Navigate your filesystem, create projects, edit code. Natively, not through some upload widget.
- **Think in loops** — I call tools autonomously, up to 25 rounds per task. You say "build a website," I scaffold, code, and serve it.
- **Save your tokens** — Ollama runs locally to compress conversation history. Your wallet will thank me.
- **Automate your life** — Built-in cron scheduler + cross-platform service manager. Set it and forget it.
- **Switch brains** — Opus when you need the best. Sonnet for speed. Haiku when you're just chatting.
- **Adapt to you** — Pick an MBTI type in settings and I'll match my communication style to yours.
- **Speak your language** — English, Korean, Japanese, Chinese. 한국어도 돼요.
- **Work from your phone** — Tailscale + QR code. Scan and chat from anywhere.

## Screenshots

<p align="center">
  <img src="screenshots/chat-dark.png" width="800" alt="Chat — Dark theme" />
</p>

<p align="center">
  <img src="screenshots/chat-light.png" width="800" alt="Chat — Light theme" />
</p>

<details>
<summary>More screenshots</summary>

<p align="center">
  <img src="screenshots/splash.png" width="800" alt="Splash screen" />
</p>
<p align="center"><em>First launch — snow falls, the diamond glows. Click to enter.</em></p>

<p align="center">
  <img src="screenshots/empty-state.png" width="800" alt="Empty state" />
</p>
<p align="center"><em>"Do you wanna build a..." — yes, yes I do.</em></p>

</details>

## Install

Grab the latest installer from [**Releases**](https://github.com/gyugoat/winter-app/releases/latest):

| Platform | Format |
|----------|--------|
| Windows | `.msi` |
| macOS | `.dmg` (Intel + Apple Silicon) |
| Linux | `.deb`, `.AppImage` |

First launch: authorize with your Claude account. One OAuth flow, done. Then just talk to me.

## Under the Hood

```
┌─────────────────────────────────────────────────┐
│  React 19 + TypeScript          (Vite 7)        │
│  ┌──────────┬──────────┬──────────┬───────────┐ │
│  │ Chat     │ Sidebar  │ Settings │ FileView  │ │
│  │ Messages │ Sessions │ Agents   │ Changes   │ │
│  └──────────┴──────────┴──────────┴───────────┘ │
├─────────────────────────────────────────────────┤
│  Tauri 2 (Rust)                                 │
│  ┌──────────┬──────────┬──────────┬───────────┐ │
│  │ Claude   │ Ollama   │ Scheduler│ Services  │ │
│  │ API +    │ History  │ Cron     │ systemd / │ │
│  │ Tools    │ Compress │ Tasks    │ launchd   │ │
│  └──────────┴──────────┴──────────┴───────────┘ │
├─────────────────────────────────────────────────┤
│  OS: Windows · macOS · Linux                    │
└─────────────────────────────────────────────────┘
```

**Frontend** — React components with CSS modules. Logic lives in hooks, components just render. Markdown parsed off-thread in a Web Worker so the UI never stutters while I'm talking.

**Backend** — Rust via Tauri 2. Direct HTTPS streaming to Claude's API. Tool calls execute with a 120s timeout and 512KB output cap — enough to run your build scripts, not enough to hang forever. OAuth PKCE keeps your credentials safe. Settings persist locally via `@tauri-apps/plugin-store`.

## Development

```bash
# You'll need Node.js 18+, Rust 1.77+, and Tauri prerequisites
# → https://v2.tauri.app/start/prerequisites/

git clone https://github.com/gyugoat/winter-app.git
cd winter-app
npm install
npm run tauri dev
```

### Project structure

```
src/                        # React frontend
├── components/             # UI (Chat, Sidebar, Settings, MessageList, ...)
├── hooks/                  # Logic (useChat, useAuth, useFileChanges, ...)
├── styles/                 # One CSS file per component
├── workers/                # Web Workers (markdown rendering)
├── i18n/                   # 4 languages (en, ko, ja, zh)
└── data/                   # MBTI personalities and static data

src-tauri/                  # Rust backend
├── src/
│   ├── lib.rs              # Tauri commands + OAuth
│   ├── claude/             # Claude API client, tools, streaming
│   ├── ollama.rs           # Local LLM + context compression
│   ├── scheduler.rs        # Cron task scheduler
│   ├── services.rs         # Cross-platform service manager
│   ├── memory.rs           # SQLite memory DB
│   └── modes.rs            # Search / Analyze mode prefixes
└── tauri.conf.json         # Window, CSP, bundle config
```

### Release

```bash
# One command. Bumps version, commits, tags, pushes.
# GitHub Actions builds installers for all platforms.
bash winter-update.sh
```

## License

[MIT](LICENSE)
