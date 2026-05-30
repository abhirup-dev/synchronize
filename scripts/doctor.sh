#!/usr/bin/env bash
# Diagnostic snapshot of a synchronize runtime. Read-only — never writes,
# never mutates. Honors SYNCHRONIZE_HOME so it works against both the
# default runtime (~/.synchronize) and the dev runtime (./.dev-synchronize).
#
# Subcommands:
#   all       full snapshot (default)
#   peers     peer detail (alive / online / soft-deleted / agent_sessions)
#   events    last N events (env N=20)
#   groups    groups + active member counts + last activity
#   daemon    daemon process detail (pid, port, worktree of process)
#
# This script is intentionally a shell pipeline (not a TS CLI) so it works
# without bun and without the daemon running. Future evolution into a
# `synchronize doctor` CLI subcommand is tracked separately.

set -euo pipefail

SYNC_HOME="${SYNCHRONIZE_HOME:-$HOME/.synchronize}"
DAEMON_JSON="$SYNC_HOME/daemon.json"
DB="$SYNC_HOME/synchronize.db"
PI_LOG="$SYNC_HOME/pi-extension.log"

# sqlite3 ISO-8601-with-ms timestamp (matches what the daemon writes).
NOW_SQL="strftime('%Y-%m-%dT%H:%M:%fZ','now')"

have_db() { [ -f "$DB" ]; }
have_daemon_json() { [ -f "$DAEMON_JSON" ]; }

section() {
  printf '\n--- %s ---\n' "$1"
}

cmd_daemon() {
  section "daemon (SYNCHRONIZE_HOME=$SYNC_HOME)"
  if ! have_daemon_json; then
    echo "daemon not registered (no $DAEMON_JSON)"
    return
  fi
  local pid port base_url
  pid=$(jq -r '.pid // empty' "$DAEMON_JSON")
  port=$(jq -r '.port // empty' "$DAEMON_JSON")
  base_url=$(jq -r '.base_url // empty' "$DAEMON_JSON")
  printf 'pid:       %s\n' "$pid"
  printf 'port:      %s\n' "$port"
  printf 'base_url:  %s\n' "$base_url"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    local cmd
    cmd=$(ps -ww -o command= -p "$pid" 2>/dev/null || true)
    printf 'alive:     yes\n'
    printf 'worktree:  %s\n' "$cmd"
  else
    printf 'alive:     NO (stale daemon.json — next MCP call will respawn)\n'
  fi
}

cmd_peers() {
  section "peers"
  if ! have_db; then echo "no database at $DB"; return; fi
  local alive online deleted
  alive=$(sqlite3 "$DB" "SELECT COUNT(*) FROM peers WHERE deleted_at IS NULL")
  online=$(sqlite3 "$DB" "SELECT COUNT(*) FROM peers WHERE deleted_at IS NULL AND lease_expires_at > $NOW_SQL")
  deleted=$(sqlite3 "$DB" "SELECT COUNT(*) FROM peers WHERE deleted_at IS NOT NULL")
  printf 'alive:        %s\n' "$alive"
  printf 'online:       %s (alive AND lease > now)\n' "$online"
  printf 'soft-deleted: %s\n' "$deleted"
  echo
  echo "alive peers (most-recently updated first):"
  sqlite3 -header -column "$DB" "
    SELECT
      substr(peer_id,1,8) AS peer,
      tool,
      session_name,
      datetime(updated_at) AS updated,
      datetime(lease_expires_at) AS lease_exp,
      CASE WHEN lease_expires_at > $NOW_SQL THEN 'yes' ELSE 'NO' END AS online
    FROM peers
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 20;
  "
  if [ "$deleted" -gt 0 ]; then
    echo
    echo "soft-deleted peers (most-recent death first):"
    sqlite3 -header -column "$DB" "
      SELECT
        substr(peer_id,1,8) AS peer,
        tool,
        session_name,
        datetime(deleted_at) AS deleted
      FROM peers
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT 10;
    "
  fi
  echo
  echo "agent_sessions:"
  sqlite3 -header -column "$DB" "
    SELECT
      substr(s.peer_id,1,8) AS peer,
      p.session_name,
      s.host_tool,
      substr(s.host_session_id,1,12) AS host_sid,
      datetime(s.last_seen_at) AS last_seen
    FROM agent_sessions s
    LEFT JOIN peers p ON s.peer_id = p.peer_id
    ORDER BY s.last_seen_at DESC
    LIMIT 20;
  "
}

cmd_groups() {
  section "groups"
  if ! have_db; then echo "no database at $DB"; return; fi
  sqlite3 -header -column "$DB" "
    SELECT
      g.group_id AS gid,
      g.name,
      CASE g.durable WHEN 1 THEN 'durable' ELSE 'ephemeral' END AS kind,
      COUNT(CASE WHEN gm.active = 1 THEN 1 END) AS active_members,
      COUNT(gm.peer_id) AS total_members,
      COALESCE((SELECT datetime(MAX(created_at)) FROM events e WHERE e.group_id = g.group_id), '-') AS last_activity
    FROM groups g
    LEFT JOIN group_members gm ON g.group_id = gm.group_id
    GROUP BY g.group_id
    ORDER BY g.group_id;
  "
  echo
  echo "active members per group:"
  sqlite3 -header -column "$DB" "
    SELECT
      gm.group_id AS gid,
      g.name AS group_name,
      gm.alias,
      substr(gm.peer_id,1,8) AS peer,
      p.session_name,
      CASE WHEN p.deleted_at IS NULL AND p.lease_expires_at > $NOW_SQL THEN 'online'
           WHEN p.deleted_at IS NULL THEN 'offline'
           ELSE 'DELETED' END AS state
    FROM group_members gm
    JOIN groups g ON gm.group_id = g.group_id
    LEFT JOIN peers p ON gm.peer_id = p.peer_id
    WHERE gm.active = 1
    ORDER BY gm.group_id, gm.alias;
  "
}

cmd_events() {
  section "events"
  if ! have_db; then echo "no database at $DB"; return; fi
  local n="${N:-20}"
  local total
  total=$(sqlite3 "$DB" "SELECT COUNT(*) FROM events")
  printf 'total events: %s — showing last %s\n\n' "$total" "$n"
  sqlite3 -header -column "$DB" "
    SELECT
      e.event_id AS eid,
      e.type,
      COALESCE(gm.alias, substr(e.sender_peer_id,1,8), '-') AS sender,
      COALESCE(e.group_id, '-') AS gid,
      COALESCE(e.parent_event_id, '-') AS parent,
      substr(REPLACE(COALESCE(e.body,''), char(10), ' '), 1, 50) AS preview
    FROM events e
    LEFT JOIN group_members gm
      ON gm.peer_id = e.sender_peer_id AND gm.group_id = e.group_id AND gm.active = 1
    ORDER BY e.event_id DESC
    LIMIT $n;
  "
}

cmd_logs() {
  section "pi-extension.log (last 15 lines)"
  if [ -f "$PI_LOG" ]; then
    tail -n 15 "$PI_LOG"
  else
    echo "(no pi-extension.log)"
  fi
}

cmd_tmux() {
  section "tmux sessions matching sync-*"
  if command -v tmux >/dev/null 2>&1; then
    tmux list-sessions 2>/dev/null | grep -E '^sync-' || echo "(none)"
  else
    echo "(tmux not installed)"
  fi
}

cmd_all() {
  echo "=== synchronize doctor ==="
  echo "SYNCHRONIZE_HOME: $SYNC_HOME"
  cmd_daemon
  cmd_peers
  cmd_groups
  cmd_events
  cmd_logs
  cmd_tmux
}

case "${1:-all}" in
  all)     cmd_all ;;
  daemon)  cmd_daemon ;;
  peers)   cmd_peers ;;
  groups)  cmd_groups ;;
  events)  cmd_events ;;
  logs)    cmd_logs ;;
  tmux)    cmd_tmux ;;
  *) echo "usage: $0 {all|daemon|peers|groups|events|logs|tmux}" >&2; exit 2 ;;
esac
