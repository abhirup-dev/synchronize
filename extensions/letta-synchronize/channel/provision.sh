#!/usr/bin/env bash
# Provision the synchronize Letta channel plugin on the local (or remote) machine.
#
# Installs the plugin under ~/.letta/channels/synchronize/, writes accounts.json
# from a roster, and adds routing.yaml entries (chatId -> agent) so a running
# `letta server --channels synchronize` serves every agent in the roster.
#
# Multi-agent: pass one --agent triple per Letta agent. Onboarding another agent
# later is just another --agent flag + re-run (or a single `letta channels route
# add`), never a code change.
#
# Usage:
#   provision.sh --daemon-url URL --token TOKEN \
#     --agent <chatId>:<sessionName>:<agentId>[:<conversationId>] \
#     [--agent ...] [--poll-ms 1500] [--letta letta]
set -euo pipefail

DAEMON_URL=""; TOKEN=""; POLL_MS="1500"; LETTA_BIN="letta"
declare -a AGENTS=()
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.letta/channels/synchronize"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --daemon-url) DAEMON_URL="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    --poll-ms) POLL_MS="$2"; shift 2;;
    --letta) LETTA_BIN="$2"; shift 2;;
    --agent) AGENTS+=("$2"); shift 2;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

[[ -n "$DAEMON_URL" ]] || { echo "--daemon-url required" >&2; exit 1; }
[[ ${#AGENTS[@]} -gt 0 ]] || { echo "at least one --agent required" >&2; exit 1; }

mkdir -p "$DEST/runtime"
cp -f "$SRC_DIR/channel.json" "$SRC_DIR/plugin.mjs" "$DEST/"
[[ -f "$DEST/runtime/package.json" ]] || echo '{"name":"synchronize-channel-runtime","private":true}' > "$DEST/runtime/package.json"

# Build accounts.json peers[] from the roster.
peers_json=""
for spec in "${AGENTS[@]}"; do
  IFS=':' read -r chatId sessionName agentId conversationId <<< "$spec"
  sessionName="${sessionName:-$chatId}"
  [[ -n "$peers_json" ]] && peers_json+=","
  peers_json+="{\"chatId\":\"$chatId\",\"sessionName\":\"$sessionName\"}"
done

cat > "$DEST/accounts.json" <<JSON
{
  "accounts": [
    {
      "channel": "synchronize",
      "accountId": "main",
      "displayName": "Synchronize",
      "enabled": true,
      "dmPolicy": "open",
      "allowedUsers": [],
      "config": {
        "daemonUrl": "$DAEMON_URL",
        "token": "$TOKEN",
        "pollMs": $POLL_MS,
        "peers": [ $peers_json ]
      },
      "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
      "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    }
  ]
}
JSON

# Install runtime deps (none today) + link node_modules per the plugin contract.
"$LETTA_BIN" channels install synchronize >/dev/null 2>&1 || true

# Add a route (chatId -> agent + conversation) for each roster entry.
for spec in "${AGENTS[@]}"; do
  IFS=':' read -r chatId sessionName agentId conversationId <<< "$spec"
  conversationId="${conversationId:-default}"
  if [[ -n "${agentId:-}" ]]; then
    "$LETTA_BIN" channels route add --channel synchronize --chat-id "$chatId" \
      --agent "$agentId" --conversation "$conversationId" >/dev/null 2>&1 \
      && echo "routed chatId=$chatId -> agent=$agentId conv=$conversationId" \
      || echo "route add failed for chatId=$chatId (add manually with: $LETTA_BIN channels route add ...)"
  fi
done

echo "provisioned synchronize channel at $DEST"
echo "start with: $LETTA_BIN server --channels synchronize"
