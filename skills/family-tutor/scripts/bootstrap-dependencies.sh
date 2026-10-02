#!/bin/zsh
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  print -u2 "Family Tutor requires npx to install browser-workspace."
  exit 1
fi

BW_DIR="$HOME/.agents/skills/browser-workspace"
BW_CLI="$BW_DIR/bin/browser-workspace"

echo "Installing Family Tutor dependency: browser-workspace"
npx --yes skills add https://github.com/lalalic/browser-workspace \
  --skill browser-workspace --global --agent codex --yes --copy

if [[ ! -x "$BW_CLI" ]]; then
  chmod +x "$BW_CLI" 2>/dev/null || true
fi
if [[ ! -x "$BW_CLI" ]]; then
  print -u2 "browser-workspace skill installed without executable CLI: $BW_CLI"
  exit 1
fi


if [[ -x "$BW_DIR/scripts/install.sh" ]]; then
  BH_WORKSPACE_NAME="Tutor" BH_WORKSPACE_POOL_SIZE="5" "$BW_DIR/scripts/install.sh"
fi

"$BW_CLI" workspace create Tutor --size 5 >/dev/null
echo "Family Tutor dependency ready: $BW_CLI"
