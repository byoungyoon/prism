#!/usr/bin/env bash
# Build the DeckCraft web app (the pptx engine) into public/engines/deckcraft.
#
#   scripts/build-engine-deckcraft.sh
#
# Environment:
#   DECKCRAFT_DIR     path of the deckcraft repository
#                     (default: /Users/byoungyoonlee/orca/projects/test/deckcraft)
#   CARGO_TARGET_DIR  cargo build directory. Default: ~/.cache/prism/deckcraft-target,
#                     kept outside the deckcraft repo so no target/ is left there.
#
# Output: public/engines/deckcraft/ (git-ignored, never commit it).
# Needs: trunk, cargo with the wasm32-unknown-unknown target.
# CI (release.yml, engines job) runs this too, with DECKCRAFT_DIR and CARGO_TARGET_DIR set.
# craft-fonts: deckcraft-web's build.rs looks for ../craft-fonts (CRAFT_FONTS_DIR). When it is
# missing the build only warns and ships without the bundled fonts, so CI does not need it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECKCRAFT_DIR="${DECKCRAFT_DIR:-/Users/byoungyoonlee/orca/projects/test/deckcraft}"
WEB_DIR="$DECKCRAFT_DIR/apps/deckcraft-web"
OUT_DIR="$ROOT/public/engines/deckcraft"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/prism/deckcraft-target}"

if [ ! -f "$WEB_DIR/Trunk.toml" ]; then
  echo "error: deckcraft-web not found at $WEB_DIR (set DECKCRAFT_DIR)" >&2
  exit 1
fi
for tool in trunk cargo; do
  command -v "$tool" >/dev/null || { echo "error: $tool is not installed" >&2; exit 1; }
done
# Read the list into a variable first: with pipefail, `rustup | grep -q` can report a false miss
# when grep quits early and rustup gets SIGPIPE.
installed_targets="$(rustup target list --installed 2>/dev/null || true)"
if ! grep -qx 'wasm32-unknown-unknown' <<<"$installed_targets"; then
  echo "error: run: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

mkdir -p "$CARGO_TARGET_DIR"
echo "deckcraft: $WEB_DIR"
echo "output:    $OUT_DIR"
echo "cargo target dir: $CARGO_TARGET_DIR"

# Trunk.toml is read from the current directory; --dist replaces its dist setting.
cd "$WEB_DIR"
trunk build --release --dist "$OUT_DIR"

if [ ! -f "$OUT_DIR/index.html" ]; then
  echo "error: build finished but $OUT_DIR/index.html is missing" >&2
  exit 1
fi
echo "done: $OUT_DIR"
