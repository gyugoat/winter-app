# Winter App — Core Steps

## Development

```bash
# Start dev server (Vite + Tauri hot reload)
bash winter.sh
# or manually:
npm run tauri dev
```

## Build & Release

### Quick Release (automated)
```bash
bash winter-update.sh
```

### Manual Release
1. **Type check**: `npx tsc --noEmit`
2. **Bump version** in 3 files (must match):
   - `package.json` → `"version": "X.Y.Z"`
   - `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
   - `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
3. **Commit**: `git add -A && git commit -m "chore(vX.Y.Z): description"`
4. **Push**: `git push origin main`
5. **Tag**: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. **Verify**: `gh run list --limit 1` → wait for `completed success`

GitHub Actions automatically builds installers for Windows, macOS, and Linux.

## Version Bump Rules

| Change Type | Bump | Example |
|-------------|------|---------|
| Bug fix only | Patch (Z) | `1.1.0` → `1.1.1` |
| New feature | Minor (Y) | `1.1.0` → `1.2.0` |
| Breaking change | Major (X) | `1.2.0` → `2.0.0` |

## Adding a New Feature (checklist)

1. [ ] Create component in `src/components/`
2. [ ] Create hook in `src/hooks/` if needed
3. [ ] Create CSS in `src/styles/`
4. [ ] Add i18n keys to all 4 locales (`en.ts`, `ko.ts`, `ja.ts`, `zh.ts`)
5. [ ] If Rust backend needed: add `#[tauri::command]` in `lib.rs`, register in `run()`
6. [ ] If new CSP domain: update `tauri.conf.json` → `security.csp`
7. [ ] Wire into `Chat.tsx` or parent component
8. [ ] Type check: `npx tsc --noEmit`
9. [ ] Test manually in dev mode

## Adding i18n Strings

All 4 files must be updated together:
- `src/i18n/en.ts`
- `src/i18n/ko.ts`
- `src/i18n/ja.ts`
- `src/i18n/zh.ts`

Key format: `camelCase` descriptive names. Type `TranslationKey` is auto-derived from `en.ts`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Port 1420 in use | `bash winter.sh` auto-kills stale process |
| Tauri build fails | Check `cargo check` in `src-tauri/` |
| CSP blocks request | Add domain to `tauri.conf.json` → `security.csp` |
| Release not created | `gh run list --limit 3` to check workflow |
| Tag exists | `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z` |
