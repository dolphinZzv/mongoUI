#!/usr/bin/env bash
#
# Build a single self-contained binary with the React front-end embedded.
#
#   ./scripts/build.sh            # build front-end + Go binary
#   ./scripts/build.sh --skip-ui  # build Go only (uses whatever is staged)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$ROOT/backend/web/dist"
OUT="${OUT:-$ROOT/bin/mongoui}"

skip_ui=0
for arg in "$@"; do
  case "$arg" in
    --skip-ui) skip_ui=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$skip_ui" -eq 0 ]]; then
  echo "==> Building front-end"
  cd "$ROOT/frontend"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run build

  echo "==> Staging assets for embedding"
  mkdir -p "$STAGE"
  # Clear previous build but keep the placeholder so plain `go build` still works.
  find "$STAGE" -mindepth 1 ! -name .gitkeep -delete
  cp -r "$ROOT/frontend/dist/." "$STAGE/"
fi

if [[ ! -f "$STAGE/index.html" ]]; then
  echo "warning: $STAGE/index.html is missing; the binary will serve the API only" >&2
fi

echo "==> Building Go binary -> $OUT"
mkdir -p "$(dirname "$OUT")"

VERSION="${VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)}"
COMMIT="${COMMIT:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo none)}"
DATE="${DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
LDFLAGS="${LDFLAGS:--s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE}"

cd "$ROOT/backend"
CGO_ENABLED="${CGO_ENABLED:-0}" go build -trimpath -ldflags "$LDFLAGS" -o "$OUT" .

echo "==> Done ($VERSION)"
if [[ -f "$STAGE/index.html" ]]; then
  echo "    front-end embedded; run: $OUT -addr :8080"
else
  echo "    API only (no front-end staged)"
fi
