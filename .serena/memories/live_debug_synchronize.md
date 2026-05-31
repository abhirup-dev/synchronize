# Live Debug Synchronize

Use this when validating Synchronize with real daemon + web UI + AOE-launched Claude/Pi agents.

## Setup
- Prefer throwaway runtime: `SYNCHRONIZE_HOME=/tmp/synchronize-<slug>/home SYNCHRONIZE_PORT=<port> bun run src/daemon.ts`.
- Open the in-app Browser to `http://127.0.0.1:<port>/web` and reload after code/build changes.
- Create fresh rooms via UI or REST: `POST /groups {"name":"...","durable":true}`.
- Use group right-click `Spawn agent...` to exercise real web spawn flow; confirm group path radio is populated.

## Runtime Checks
- Daemon: `curl -fsS http://127.0.0.1:<port>/status` and `/web/state | jq ...`.
- Bindings: `curl -fsS http://127.0.0.1:<port>/agent-sessions | jq ...`.
- AOE: `aoe -p <profile> list --json`; command should show Claude `--model haiku` and Pi `--provider openai-codex --model gpt-5.4-mini`.
- tmux: `tmux list-sessions -F '#{session_name}'`; capture panes with `tmux capture-pane -p -t <session>`.

## UI Navigation
- Right-click room in sidebar -> `Spawn agent...`.
- Use dialog radio buttons for Claude/Pi and path selection; alias is max 11 chars.
- Roster should show launched agent under AGENTS, and room header member count should update.
- Test mentions and threaded replies from the composer; mention chips can be checked visually in the browser snapshot.

## Pitfalls
- AOE truncates tmux-visible title prefixes to 20 chars; Synchronize titles are `<hash8>-<alias11>`.
- Browser automation fill may fail if virtual clipboard is unavailable; use keypress/backspace typing instead.
- `/web/state` can look stale if daemon dies; verify daemon liveness before trusting presence.
- Clean up live tests: stop AOE sessions by title, delete empty test profiles, remove ignored `.demo-synchronize/`, `work/`, and `/tmp/synchronize-*` dirs.