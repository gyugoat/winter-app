#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
cd "$DIR"

PORT=1420
PID=$(lsof -ti:$PORT 2>/dev/null)

if [ -n "$PID" ]; then
  CMD=$(ps -p "$PID" -o comm= 2>/dev/null)
  if echo "$CMD" | grep -qiE "node|vite|npm|winter"; then
    kill "$PID" 2>/dev/null
    sleep 0.3
  else
    echo "Port $PORT is used by '$CMD' (PID $PID). Not a Winter process — aborting."
    exit 1
  fi
fi

exec npm run tauri dev
