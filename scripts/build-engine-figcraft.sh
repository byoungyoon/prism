#!/usr/bin/env bash
# figcraft 웹판(apps/figcraft-web)을 trunk로 빌드해 public/engines/figcraft/ 에 넣는다.
#
#   scripts/build-engine-figcraft.sh
#   FIGCRAFT_DIR=/path/to/figcraft scripts/build-engine-figcraft.sh
#
# - figcraft 저장소는 읽기만 한다. 산출물은 이 저장소의 public/engines/figcraft 로만 간다.
# - Cargo 빌드 캐시는 figcraft/target 이 아니라 CARGO_TARGET_DIR(기본 ~/.prism/cache/figcraft-target)에 둔다.
# - Trunk.toml 의 dist(../../dist/web) 는 --dist 로 덮어쓴다.
# - 결과물은 용량이 커서 git 에 올리지 않는다 (.gitignore 참고).
# - CI(.github/workflows/release.yml, engines 잡)에서도 같은 스크립트를 쓴다. CI는 FIGCRAFT_DIR 와
#   CARGO_TARGET_DIR 를 환경변수로 넘긴다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIGCRAFT_DIR="${FIGCRAFT_DIR:-/Users/byoungyoonlee/orca/projects/test/figcraft}"
WEB_DIR="$FIGCRAFT_DIR/apps/figcraft-web"
DIST="$ROOT/public/engines/figcraft"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.prism/cache/figcraft-target}"

if ! command -v trunk >/dev/null 2>&1; then
  echo "trunk 이 없습니다. 설치: cargo install trunk" >&2
  exit 1
fi
# Read the list into a variable first: with pipefail, `rustup | grep -q` can report a false miss
# when grep quits early and rustup gets SIGPIPE.
installed_targets="$(rustup target list --installed 2>/dev/null || true)"
if ! grep -qx 'wasm32-unknown-unknown' <<<"$installed_targets"; then
  echo "wasm 타깃이 없습니다. 설치: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi
if [ ! -f "$WEB_DIR/index.html" ] || [ ! -f "$WEB_DIR/Trunk.toml" ]; then
  echo "figcraft-web 을 찾을 수 없습니다: $WEB_DIR (FIGCRAFT_DIR 로 경로를 지정하세요)" >&2
  exit 1
fi

mkdir -p "$CARGO_TARGET_DIR"
echo "figcraft: $WEB_DIR"
echo "출력:     $DIST"
echo "cargo target: $CARGO_TARGET_DIR"

cd "$WEB_DIR"
trunk build --release --dist "$DIST"

echo "완료: $DIST"
ls -la "$DIST" | head -20
