#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v npx >/dev/null 2>&1; then
  print -u2 "Family Tutor requires npx to install browser-workspace."
  exit 1
fi

BW_DIR="$HOME/.agents/skills/browser-workspace"
BW_CLI="$BW_DIR/bin/browser-workspace"

echo "Installing Family Tutor dependency: browser-workspace"
npx --yes skills add https://github.com/lalalic/browser-workspace \
  --skill browser-workspace --global --agent codex --yes --copy

[[ -x "$BW_CLI" ]] || chmod +x "$BW_CLI" 2>/dev/null || true
if [[ ! -x "$BW_CLI" ]]; then
  print -u2 "browser-workspace skill installed without executable CLI: $BW_CLI"
  exit 1
fi

if [[ -x "$BW_DIR/scripts/install.sh" ]]; then
  BH_WORKSPACE_NAME="Tutor" BH_WORKSPACE_POOL_SIZE="5" "$BW_DIR/scripts/install.sh"
fi

STATUS="$($BW_CLI status)"
ADMIN_HELPER="$(print -r -- "$STATUS" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);if(!j.admin_helper)process.exit(2);process.stdout.write(j.admin_helper)})')"
node --input-type=module -e 'import {pathToFileURL} from "node:url"; const p=process.argv[1]; const m=await import(pathToFileURL(p).href); await m.ensureWorkspace("Tutor",5)' "$ADMIN_HELPER"
echo "Family Tutor dependency ready: $BW_CLI"
