# Handoff: Web UI Live Daemon State Implementation

Created: 2026-05-23 09:42 IST  
Project: `/Users/abhirupdas/Codes/Personal/synchronize`  
Implementation worktree: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/sync-h9u-live-web-ui`  
Branch: `sync-h9u-live-web-ui`  
Remote branch: `origin/sync-h9u-live-web-ui`  
Commit: `0e698f7 Wire web UI to live daemon state`  
Beads issue: `sync-h9u` closed locally

## Current State Summary

The production live-daemon web UI implementation is complete on branch `sync-h9u-live-web-ui` and pushed to GitHub.

PR URL:

```text
https://github.com/abhirup-dev/synchronize/pull/new/sync-h9u-live-web-ui
```

The branch is up to date with `origin/master` as of the implementation closeout:

```text
HEAD...origin/master = 1 ahead, 0 behind
origin/master is an ancestor of HEAD
```

The working tree was clean immediately after commit/push. A new handoff file is now being added after the fact, so expect this file itself to be uncommitted unless a later agent commits it.

Important closeout caveat: `bd dolt push` failed because the Dolt HTTPS remote attempted an interactive GitHub credential prompt:

```text
fatal: could not read Password for 'https://abhirup-dev@github.com': Device not configured
dolt does not support interactive credential prompts
```

The Git branch push succeeded. The local Beads issue state shows `sync-h9u` closed, but remote Beads/Dolt sync is not complete until credentials are configured and `bd dolt push` succeeds.

## What Was Implemented

The demo-only web UI is now wired to real daemon state through a high-performance daemon read model and live invalidation path.

Major behavior:

- `/web` defaults to daemon-backed mode when served from the daemon.
- Mock/demo mode remains available through:

```js
localStorage.SYNCHRONIZE_DATA_SOURCE = "mock"
```

- If the daemon cannot be reached, the UI shows a connection error instead of silently falling back to fake data.
- If protected daemon mode is enabled, the web UI reads the bearer token from:

```js
sessionStorage.SYNCHRONIZE_TOKEN
localStorage.SYNCHRONIZE_TOKEN
```

- The web client registers/reuses a sticky `web:` peer in `localStorage`.
- Group and DM sends go through daemon REST APIs.
- Sends are optimistic: a queued local bubble appears immediately, then reconciles with the server event.
- SSE is used as a coarse invalidation stream, not as a bulk payload channel.
- The client falls back to polling.

## Performance Design Alignment

The initial implementation direction was corrected after reading:

```text
docs/high-performance-design.md
```

That document explicitly says a global "last N events across all rooms" endpoint is the largest schema mismatch. The final implementation follows the high-performance shape instead:

- Summary-first `/web/state` for shell/sidebar data.
- Room-scoped `/web/state?room=group:<id>` and `/web/state?room=dm:<peer_id>` for hot room streams.
- Durable cursor based on `events.event_id`, not only in-memory state version.
- ETag/304 support on `/web/state`.
- Coalesced SSE invalidations before refetch.
- Lazy hydration for rooms when components subscribe.
- Virtualized chat/thread rendering to keep DOM nodes bounded.
- Memoized message rows and deferred sidebar search.
- SQLite read PRAGMAs for read-heavy UI paths.
- Bun build splitting enabled.

## Key Files Changed

### Daemon/API

`src/daemon.ts`

- Added `GET /web/state`.
- Added `GET /web/events` SSE stream.
- Added `WebStateResponse`, `WebRoomSummary`, `WebEventRow`, and `WebStateChange` shapes.
- Added `emitWebStateChanged()`.
- Added room-scoped event reads:
  - `room=group:<group_id>`
  - `room=dm:<peer_id>`
- Added ETag support:
  - Response ETag: `W/"<cursor>"`
  - `If-None-Match` returns `304`.
- Added invalidation calls after relevant mutations:
  - peer register/heartbeat/delete
  - agent session register/rename
  - DM send
  - group create/join/rename/patch/leave
  - group message send
  - media share
  - inbox read/ack/event delivery reads

`src/db.ts`

- Added read-friendly SQLite PRAGMAs:

```sql
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;
PRAGMA mmap_size = 268435456;
```

### Web Data Layer

`web/src/data/daemon.ts`

- Replaced the stub with a real `DaemonDataSource`.
- Registers sticky web peer with key:

```text
synchronize.web.peerId
```

- Maintains snapshots for:
  - agents
  - rooms
  - messages per room
  - thread replies
  - timeline
  - tasks
  - artifacts
  - me
- Uses summary-state refresh for peers/groups/memberships/room summaries.
- Uses lazy per-room refresh for messages/artifacts/timeline.
- Uses fetch-based SSE parser instead of native `EventSource` because native `EventSource` cannot attach bearer auth headers.
- Coalesces SSE invalidations with a 50ms trailing timer.
- Polls summary and subscribed rooms every 2s as fallback.
- Optimistic sends insert local `optimistic:<uuid>` messages and replace/remove them after daemon response/failure.

### Web App Boot

`web/src/App.tsx`

- Imports `DaemonDataSource`.
- Runtime data source selection:
  - explicit mock if `localStorage.SYNCHRONIZE_DATA_SOURCE === "mock"`
  - daemon if `/web` path or explicit live mode
  - mock otherwise
- Adds connection error UI.
- Handles initial empty rooms until daemon data arrives.

### UI Performance

`web/package.json`, `web/bun.lock`

- Added:

```text
@tanstack/react-virtual
```

`web/src/components/ChatView.tsx`

- Virtualized message list with `useVirtualizer`.
- Uses `agentById` map instead of repeated `agents.find()` per row.

`web/src/components/ThreadPane.tsx`

- Virtualized replies.
- Uses `agentById` map for parent/reply authors.

`web/src/components/MessageRow.tsx`

- Wrapped in `React.memo`.
- Memoizes mention-to-markdown rewrite.

`web/src/components/Sidebar.tsx`

- Uses `useDeferredValue` for search filtering.

`web/src/components/extra.css`

- Added virtualized row/spacer styles.
- Added `content-visibility: auto` and `contain-intrinsic-size` on message rows.
- Added connection error styling.

`web/build.ts`

- Enabled Bun build splitting:

```ts
splitting: true
```

### Docs

`docs/web-live-daemon-state-plan.md`

- Implementation plan for live daemon state wiring.
- Updated to reference the high-performance design and room-scoped state shape.

`docs/high-performance-design.md`

- Design/performance companion doc.
- Defines the v0 performance profile, client store shape, room-scoped API, coalesced invalidation policy, virtualization recommendation, and explicit non-goals.

### Tests

`tests/api.test.ts`

Added:

- `web state endpoint returns summaries and room-scoped event history`
- `web events stream emits state_changed after a room message`

## Verification Performed

All of these passed:

```bash
bun run typecheck
cd web && bun run typecheck
cd web && bun run build
bun test tests/api.test.ts
SYNCHRONIZE_PORT=0 bun test
```

Full suite result with `SYNCHRONIZE_PORT=0`:

```text
48 pass
0 fail
285 expect() calls
Ran 48 tests across 7 files. [8.56s]
```

Why `SYNCHRONIZE_PORT=0` was used for the full suite:

- A real local daemon was already listening on default port `58405`.
- Running `bun test` without overriding the port caused a timeout in an existing Claude hook test path because the test daemon tried to bind/use the occupied default port.
- This matches the existing open issue about default port collision in tests.

## Dummy Agent / UI Data Experiment

After implementation, a dummy tmux demo was attempted so the UI could display generated data.

Created and then cleaned:

- tmux session: `sync-web-dummy`
- demo daemon home: `/tmp/synchronize-web-dummy`
- demo daemon port: `58406`
- temporary scripts:
  - `/tmp/sync-web-dummy-agent.sh`
  - `/tmp/sync-web-dummy-launched-agent.sh`
  - `/tmp/sync-web-dummy-bin`

Important outcome:

- A first script-only dummy run registered peers and generated state successfully.
- User then clarified that dummy agents must be launched through `synchronize launch`.
- Real `synchronize launch pi` worked and generated Pi traffic.
- Real `synchronize launch claude` failed because the installed Claude Code binary crashes under the current Node runtime:

```text
TypeError: Cannot read properties of undefined (reading 'prototype')
Node.js v26.0.0
```

- A temporary Claude shim was attempted, but `synchronize launch claude` still resolved to the real Claude binary in that tmux environment, so Claude launch windows exited with the same Node 26 crash.
- User then asked to stop and clean all dummy agents/state.

Cleanup completed:

- `sync-web-dummy` tmux session killed.
- Port `58406` verified down.
- `/tmp/synchronize-web-dummy` removed.
- temporary dummy scripts/shims removed.
- Existing unrelated tmux sessions were left alone:
  - `sync-alice`
  - `sync-bob`
  - `sync-karel`
- The real daemon on `58405` was left alone.

## Known Issues / Follow-Up

1. **Beads remote push still blocked**

   Local issue `sync-h9u` is closed, but `bd dolt push` failed due to non-interactive GitHub HTTPS auth. A future agent should run:

   ```bash
   bd dolt push
   ```

   after fixing credential helper/token/SSH auth for Dolt.

2. **Claude launch broken under Node 26**

   `synchronize launch claude` invokes the installed Claude binary, which crashes before useful startup. The failure is outside this implementation but blocks real Claude dummy-agent smoke. Fix options:

   - run Claude Code with a supported Node runtime,
   - update/reinstall Claude Code,
   - adjust PATH/runtime manager so `claude` does not use the broken Node 26 path.

3. **No committed handoff file yet**

   This handoff is being added after the implementation commit. If the handoff itself should live on the branch, stage and commit it:

   ```bash
   git add .claude/handoffs/2026-05-23-094242-web-live-daemon-state-implementation.md
   git commit -m "Add web live daemon state handoff"
   git push
   ```

4. **Out-of-schema UI views remain empty in daemon mode**

   Per `docs/high-performance-design.md`, daemon mode v0 does not have real schema for board/tasks/polls/timeline taxonomy. Mock mode remains the design surface for those until future schema work.

5. **Web UI manual browser verification still useful**

   Automated tests/build/typecheck passed, but a human/browser smoke should still inspect:

   ```text
   http://127.0.0.1:<daemon-port>/web/
   ```

   against a daemon running from the branch.

## Immediate Next Steps For A New Agent

1. If continuing implementation review, start in:

   ```bash
   cd /Users/abhirupdas/Codes/Personal/synchronize-worktrees/sync-h9u-live-web-ui
   git status --short --branch
   ```

2. If the handoff should be committed, commit only this handoff file.

3. Open the PR from:

   ```text
   https://github.com/abhirup-dev/synchronize/pull/new/sync-h9u-live-web-ui
   ```

4. If testing the UI manually, run a daemon from the implementation branch on a free port and build/serve the web bundle:

   ```bash
   cd web
   bun run build
   cd ..
   SYNCHRONIZE_HOME=/tmp/synchronize-web-smoke SYNCHRONIZE_PORT=58406 bun run src/daemon.ts
   ```

   Then open:

   ```text
   http://127.0.0.1:58406/web/
   ```

5. For dummy data, prefer using `synchronize launch pi` first, because it works. Do not assume `synchronize launch claude` works until the Claude/Node 26 crash is fixed.

## Useful Commands

Check branch relation to master:

```bash
git fetch origin master sync-h9u-live-web-ui
git rev-list --left-right --count HEAD...origin/master
git merge-base --is-ancestor origin/master HEAD
```

Run gates:

```bash
bun run typecheck
cd web && bun run typecheck && bun run build
cd ..
SYNCHRONIZE_PORT=0 bun test
```

Inspect new web state endpoint:

```bash
curl -s http://127.0.0.1:58406/web/state | jq
curl -s 'http://127.0.0.1:58406/web/state?room=group:1&peer_id=web:test' | jq
```

Watch SSE:

```bash
curl -N http://127.0.0.1:58406/web/events
```

Clean any future dummy run:

```bash
tmux kill-session -t sync-web-dummy 2>/dev/null || true
rm -rf /tmp/synchronize-web-dummy /tmp/sync-web-dummy-agent.sh /tmp/sync-web-dummy-launched-agent.sh /tmp/sync-web-dummy-bin
lsof -nP -iTCP:58406 -sTCP:LISTEN
```

