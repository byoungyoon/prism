#!/usr/bin/env bash
# figcraft-cli 바이너리를 Prism 데이터 폴더(~/.prism/engines/figcraft/figcraft-cli)에 설치한다.
#
#   scripts/install-figcraft-cli.sh
#   FIGCRAFT_DIR=/path/to/figcraft scripts/install-figcraft-cli.sh
#   FIGCRAFT_CLI_ZIP=/path/to/figcraft-cli-X.zip scripts/install-figcraft-cli.sh
#
# - figcraft 저장소의 zip 은 읽기만 한다. 빈 임시 폴더에 풀고 바이너리 하나만 복사한다.
# - 설치 후 `figcraft-cli --help` 로 동작을 확인한다.
set -euo pipefail

FIGCRAFT_DIR="${FIGCRAFT_DIR:-/Users/byoungyoonlee/orca/projects/test/figcraft}"
ZIP="${FIGCRAFT_CLI_ZIP:-$FIGCRAFT_DIR/dist/release/figcraft-cli-0.12.1-macos-aarch64.zip}"
DEST_DIR="${PRISM_ENGINE_DIR:-$HOME/.prism/engines/figcraft}"
DEST="$DEST_DIR/figcraft-cli"

if [ ! -f "$ZIP" ]; then
  echo "figcraft-cli zip 이 없습니다: $ZIP" >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/figcraft-cli-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

unzip -q "$ZIP" -d "$TMP"
SRC="$(find "$TMP" -type f -name figcraft-cli -perm -u+x | head -n 1)"
if [ -z "$SRC" ]; then
  echo "zip 안에서 figcraft-cli 바이너리를 찾지 못했습니다." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST.tmp"
chmod +x "$DEST.tmp"
mv "$DEST.tmp" "$DEST"
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true

echo "설치: $DEST"
"$DEST" --help | head -n 5
echo "확인: $("$DEST" --version 2>/dev/null || echo '(--version 없음)')"
