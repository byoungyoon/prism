#!/usr/bin/env bash
# Build deckcraft-cli from the deckcraft repository and install it for Prism, then run a headless
# MCP smoke test over stdio (scripts/deckcraft-mcp-smoke.mjs).
#
#   scripts/install-deckcraft-cli.sh
#
# Environment:
#   DECKCRAFT_DIR     deckcraft repository (default: /Users/byoungyoonlee/orca/projects/test/deckcraft)
#   CARGO_TARGET_DIR  cargo build directory. Default: ~/.cache/prism/deckcraft-target, outside the
#                     deckcraft repo so no target/ is left there.
#   INSTALL_DIR       install folder (default: ~/.prism/engines/deckcraft)
#   SKIP_SMOKE=1      install only, skip the MCP smoke test
#
# Builds from the checked-out source rather than downloading a release: the source is the version
# we pin, and the latest GitHub release (v0.18.1) is older than the checked-out Cargo version.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECKCRAFT_DIR="${DECKCRAFT_DIR:-/Users/byoungyoonlee/orca/projects/test/deckcraft}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.prism/engines/deckcraft}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/prism/deckcraft-target}"

if [ ! -f "$DECKCRAFT_DIR/apps/deckcraft-cli/Cargo.toml" ]; then
  echo "error: deckcraft-cli not found under $DECKCRAFT_DIR (set DECKCRAFT_DIR)" >&2
  exit 1
fi
command -v cargo >/dev/null || { echo "error: cargo is not installed" >&2; exit 1; }

echo "building deckcraft-cli in $DECKCRAFT_DIR (target: $CARGO_TARGET_DIR)"
(cd "$DECKCRAFT_DIR" && cargo build --release -p deckcraft-cli)

BUILT="$CARGO_TARGET_DIR/release/deckcraft-cli"
mkdir -p "$INSTALL_DIR"
install -m 755 "$BUILT" "$INSTALL_DIR/deckcraft-cli"
CLI="$INSTALL_DIR/deckcraft-cli"
echo "installed: $CLI ($("$CLI" --version))"

if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  exit 0
fi

# Smoke test: make a sample deck, then drive `deckcraft-cli mcp` over stdio.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/deckcraft-smoke.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
"$CLI" run --sample --save "$WORK/sample.pptx" >/dev/null
node "$ROOT/scripts/deckcraft-mcp-smoke.mjs" "$CLI" "$WORK/sample.pptx" "$WORK/out"
