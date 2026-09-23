#!/bin/sh
#
# One-line installer for mongoui.
#
#   curl -fsSL https://raw.githubusercontent.com/dolphinZzv/mongoUI/main/scripts/install.sh | sh
#
# Options / environment:
#   --version <v>     install a specific version (default: latest release)
#   --dir <path>      install directory (default: /usr/local/bin or ~/.local/bin)
#   --repo <o/n>      GitHub repository (default: dolphinZzv/mongoUI)
#   --service         also install a systemd unit (Linux, needs root)
#   VERSION, INSTALL_DIR, REPO environment variables behave the same way.
#
set -eu

REPO="${REPO:-dolphinZzv/mongoUI}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-}"
BIN_NAME="mongoui"
WITH_SERVICE=0

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --service) WITH_SERVICE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# --- helpers ----------------------------------------------------------------

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    echo "error: curl or wget is required" >&2
    exit 1
  fi
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  else
    wget -qO "$2" "$1"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

# --- detect platform --------------------------------------------------------

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  linux|darwin) ;;
  *) echo "error: unsupported operating system: $os" >&2; exit 1 ;;
esac

arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
esac

echo "==> Installing ${BIN_NAME} for ${os}/${arch}"

# --- resolve release --------------------------------------------------------

if [ "$VERSION" = "latest" ]; then
  api_url="https://api.github.com/repos/${REPO}/releases/latest"
else
  case "$VERSION" in
    v*) tag="$VERSION" ;;
    *) tag="v$VERSION" ;;
  esac
  api_url="https://api.github.com/repos/${REPO}/releases/tags/${tag}"
fi

release_json=$(fetch "$api_url")

# GitHub returns pretty-printed JSON, so extract URLs regardless of whitespace.
# Prefer jq / python3 when available, otherwise fall back to grep + sed.
extract_urls() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.assets[].browser_download_url' 2>/dev/null
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("assets", []):
    print(a.get("browser_download_url", ""))' 2>/dev/null
    return
  fi
  printf '%s' "$1" \
    | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed -e 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"//' -e 's/"$//'
}

all_urls=$(extract_urls "$release_json")

asset_url=$(printf '%s\n' "$all_urls" | grep "_${os}_${arch}\.tar\.gz$" | head -n1 | tr -d '[:space:]')
checksums_url=$(printf '%s\n' "$all_urls" | grep 'checksums\.txt$' | head -n1 | tr -d '[:space:]')

case "$asset_url" in
  https://*) ;;
  *)
    echo "error: no release asset found for ${os}/${arch}" >&2
    echo "       see https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
esac

asset_name=$(basename "$asset_url")

# --- download & verify ------------------------------------------------------

tmp_dir=$(mktemp -d 2>/dev/null || mktemp -d -t mongoui)
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

echo "==> Downloading ${asset_name}"
download "$asset_url" "$tmp_dir/$asset_name"

if [ -n "$checksums_url" ]; then
  echo "==> Verifying checksum"
  download "$checksums_url" "$tmp_dir/checksums.txt"
  expected=$(grep " ${asset_name}\$" "$tmp_dir/checksums.txt" | awk '{print $1}' | head -n1)
  actual=$(sha256_of "$tmp_dir/$asset_name")
  if [ -n "$expected" ] && [ -n "$actual" ]; then
    if [ "$expected" != "$actual" ]; then
      echo "error: checksum mismatch (expected $expected, got $actual)" >&2
      exit 1
    fi
    echo "    checksum ok"
  else
    echo "    warning: could not verify checksum" >&2
  fi
fi

echo "==> Extracting"
tar -xzf "$tmp_dir/$asset_name" -C "$tmp_dir"
if [ ! -f "$tmp_dir/$BIN_NAME" ]; then
  echo "error: ${BIN_NAME} not found inside the archive" >&2
  exit 1
fi

# --- choose install directory ----------------------------------------------

if [ -z "$INSTALL_DIR" ]; then
  if [ -w /usr/local/bin ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="$HOME/.local/bin"
  fi
fi
mkdir -p "$INSTALL_DIR"

echo "==> Installing to ${INSTALL_DIR}/${BIN_NAME}"
chmod +x "$tmp_dir/$BIN_NAME"
mv -f "$tmp_dir/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"

# --- optional systemd unit --------------------------------------------------

if [ "$WITH_SERVICE" -eq 1 ]; then
  if [ "$os" = "linux" ] && command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
    unit=/etc/systemd/system/mongoui.service
    echo "==> Writing ${unit}"
    cat > "$unit" <<EOF
[Unit]
Description=mongoui MongoDB manager
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${BIN_NAME} -addr :8080 -data /var/lib/mongoui
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now mongoui
    echo "    service enabled: systemctl status mongoui"
  else
    echo "    warning: --service requires Linux, systemd and root" >&2
  fi
fi

# --- done -------------------------------------------------------------------

installed_version=$("$INSTALL_DIR/$BIN_NAME" -version 2>/dev/null || echo "$BIN_NAME")
echo ""
echo "==> Installed: ${installed_version}"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "Add ${INSTALL_DIR} to your PATH:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo ""
echo "Start the server:"
echo "  ${BIN_NAME} -addr :8080"
echo "Run in the background:"
echo "  ${BIN_NAME} -daemon -addr :8080"
echo "Update to the latest release:"
echo "  ${BIN_NAME} update"
