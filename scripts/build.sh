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

# --- resolve version --------------------------------------------------------
# The git tag is the source of truth. If the tree has no usable tags (e.g. a
# source tarball) fall back to the front-end package.json, which is kept in sync
# by scripts/sync-version.sh. Never silently fall back to a stale version.
if [[ -z "${VERSION:-}" ]]; then
  if VERSION="$(git -C "$ROOT" describe --tags --exact-match --dirty 2>/dev/null)"; then
    :
  elif VERSION="$(git -C "$ROOT" describe --tags --dirty 2>/dev/null)"; then
    :
  elif [[ -f "$ROOT/frontend/package.json" ]]; then
    VERSION="v$(node -p "require('$ROOT/frontend/package.json').version" 2>/dev/null || echo dev)"
  else
    VERSION="dev"
  fi
fi
COMMIT="${COMMIT:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo none)}"
DATE="${DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

if [[ "$skip_ui" -eq 0 ]]; then
  echo "==> Building front-end (version $VERSION)"
  cd "$ROOT/frontend"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  # Bake the release version into the bundle so a stale embedded front-end is
  # immediately visible in the UI.
  VITE_APP_VERSION="${VERSION#v}" npm run build

  echo "==> Staging assets for embedding"
  mkdir -p "$STAGE"
  # Clear previous build but keep the placeholder so plain `go build` still works.
  find "$STAGE" -mindepth 1 ! -name .gitkeep -delete
  cp -r "$ROOT/frontend/dist/." "$STAGE/"
  # Compress JS/CSS so the embedded payload stays small (served with
  # Content-Encoding: gzip, so browsers decompress on their side).
  sh "$ROOT/scripts/gzip-assets.sh" "$STAGE"
fi

if [[ ! -f "$STAGE/index.html" ]]; then
  echo "error: $STAGE/index.html is missing." >&2
  echo "       Build the front-end first (drop --skip-ui or run \`make frontend\`)." >&2
  echo "       Refusing to produce a binary with a missing/stale embedded UI." >&2
  exit 1
fi

# Guard against shipping a binary whose embedded UI predates the theme switch:
# this marker is only present in builds from the current front-end source.
if ! grep -q 'mongoui-theme' "$STAGE/index.html"; then
  echo "error: embedded front-end is stale (theme bootstrap missing in $STAGE/index.html)." >&2
  echo "       Re-run without --skip-ui to rebuild it." >&2
  exit 1
fi

echo "==> Building Go binary -> $OUT"
mkdir -p "$(dirname "$OUT")"

LDFLAGS="${LDFLAGS:--s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE}"

cd "$ROOT/backend"
CGO_ENABLED="${CGO_ENABLED:-0}" go build -trimpath -ldflags "$LDFLAGS" -o "$OUT" .

echo "==> Done ($VERSION)"
"$OUT" -version
SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "    binary size: ${SIZE} bytes ($((SIZE / 1024 / 1024)) MiB)"
echo "    front-end embedded; run: $OUT -addr :8080"
