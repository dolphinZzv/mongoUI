#!/usr/bin/env bash
#
# Run the backend and the Vite dev server together for local development.
# The Vite server proxies /api to the backend, so the UI is served from :5173
# with hot reload while the Go API runs on :8080.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ADDR="${BACKEND_ADDR:-:8080}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"

cd "$ROOT/backend"
go run . -addr "$BACKEND_ADDR" -data "$DATA_DIR" &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT/frontend"
[[ -d node_modules ]] || npm install
npm run dev
