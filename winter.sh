#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
cd "$DIR"

lsof -ti:1420 2>/dev/null | xargs kill -9 2>/dev/null
sleep 0.3

exec npm run tauri dev
