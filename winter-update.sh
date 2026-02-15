#!/usr/bin/env bash
set -euo pipefail

# ── Winter App: One-Click Update & Release ──
# Usage: bash winter-update.sh [patch|minor|major] [commit message]
# Examples:
#   bash winter-update.sh                        → patch bump (0.2.0 → 0.2.1), auto message
#   bash winter-update.sh minor                  → minor bump (0.2.0 → 0.3.0), auto message
#   bash winter-update.sh patch "fix: 버그 수정"  → patch bump with custom message

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Parse args ──
BUMP_TYPE="${1:-patch}"
shift 2>/dev/null || true
COMMIT_MSG="$*"

# ── Read current version from package.json ──
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  *)
    echo "Usage: bash winter-update.sh [patch|minor|major] [commit message]"
    exit 1
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
TAG="v$NEW_VERSION"

echo ""
echo "  ❄  Winter Update"
echo "  ─────────────────"
echo "  $CURRENT → $NEW_VERSION ($BUMP_TYPE)"
echo ""

# ── Check for changes ──
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "  ⚠  No changes to commit. Nothing to do."
  exit 0
fi

# ── Bump version in 3 files ──
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
sed -i "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

echo "  [1/5] Version bumped in 3 files"

# ── Auto commit message if not provided ──
if [ -z "$COMMIT_MSG" ]; then
  CHANGED_FILES=$(git diff --name-only; git ls-files --others --exclude-standard)
  FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l)
  if [ "$FILE_COUNT" -le 3 ]; then
    COMMIT_MSG="chore(v$NEW_VERSION): update $(echo "$CHANGED_FILES" | tr '\n' ', ' | sed 's/,$//')"
  else
    COMMIT_MSG="chore(v$NEW_VERSION): update $FILE_COUNT files"
  fi
fi

# ── Git: add + commit + push ──
git -c user.name="gyugoat" -c user.email="gyugoat@users.noreply.github.com" add -A
git -c user.name="gyugoat" -c user.email="gyugoat@users.noreply.github.com" commit -m "$COMMIT_MSG"
echo "  [2/5] Committed: $COMMIT_MSG"

git push origin main
echo "  [3/5] Pushed to main"

# ── Tag: delete old if exists, create new ──
git tag -d "$TAG" 2>/dev/null && git push origin ":refs/tags/$TAG" 2>/dev/null || true
git -c user.name="gyugoat" -c user.email="gyugoat@users.noreply.github.com" tag "$TAG"
echo "  [4/5] Tagged $TAG"

git push origin "$TAG"
echo "  [5/5] Tag pushed → Release workflow triggered"

echo ""
echo "  ✓  Done! GitHub Actions is building installers."
echo "  ✓  Check: https://github.com/gyugoat/winter-app/actions"
echo "  ✓  Download: https://github.com/gyugoat/winter-app/releases/tag/$TAG"
echo "  ✓  (~15 min for builds to complete)"
echo ""
