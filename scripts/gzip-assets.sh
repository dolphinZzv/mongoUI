#!/usr/bin/env sh
#
# gzip-assets.sh <dir>
#
# Replace JS/CSS assets in <dir> with their gzip-compressed form (file -> file.gz).
# The server serves the .gz bytes with `Content-Encoding: gzip`, so the binary
# embeds ~3x less front-end data while browsers decompress on their side.
#
set -eu

dir="${1:?usage: gzip-assets.sh <dir>}"

find "$dir" -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -9 -f {} \;

echo "gzipped front-end assets in $dir"
