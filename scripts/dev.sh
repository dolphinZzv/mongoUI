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
# Vite proxies /api to the backend; derive it from BACKEND_ADDR so overriding
# the listen address does not silently leave the front-end pointed at :8080.
backend_port="${BACKEND_ADDR##*:}"
export VITE_API_PROXY="${VITE_API_PROXY:-http://127.0.0.1:${backend_port}}"

cd "$ROOT/backend"
go run . -addr "$BACKEND_ADDR" -data "$DATA_DIR" &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT/frontend"
[[ -d node_modules ]] || pnpm install
pnpm run dev
