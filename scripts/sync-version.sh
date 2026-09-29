#!/usr/bin/env bash
#
# Keep the front-end package version in sync with the app version.
#
# The front-end package.json used to drift (it stayed at 0.1.0 while releases
# moved on), which made any tooling that reads package.json stamp/serve a stale
# build. Run this before tagging a release, or let the release workflow do it.
#
#   ./scripts/sync-version.sh            # use the current git tag / describe
#   ./scripts/sync-version.sh v0.2.4     # explicit version
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

version="${1:-}"
if [[ -z "$version" ]]; then
  # Nearest tag, without the -dirty/-N-gsha suffix, so a dirty working tree
  # still syncs to a clean release version.
  version="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null || echo dev)"
fi
version="${version#v}"

# Update package.json (only the top-level "version" field).
node - "$ROOT/frontend/package.json" "$version" <<'NODE'
const fs = require("fs")
const [file, version] = process.argv.slice(2)
const json = JSON.parse(fs.readFileSync(file, "utf8"))
json.version = version
fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n")
NODE

# Update the two version fields in package-lock.json.
node - "$ROOT/frontend/package-lock.json" "$version" <<'NODE'
const fs = require("fs")
const [file, version] = process.argv.slice(2)
const json = JSON.parse(fs.readFileSync(file, "utf8"))
json.version = version
if (json.packages && json.packages[""]) json.packages[""].version = version
fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n")
NODE

echo "frontend/package.json + package-lock.json -> $version"
