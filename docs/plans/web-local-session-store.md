# Web Local Session Store Plan

## Summary

Fix the current web UI alias collision by making the daemon the local session store for the human web participant. For the immediate option-1 implementation, every local browser tab and browser profile asks the daemon for the same local web peer and sends as that peer. This keeps opening the UI as simple as pasting the daemon web URI into a browser address bar and pressing Enter.

Longer term, evolve this model into a principal identity layer where group membership, aliases, mentions, and read state belong to a human/app principal, while peers/connections represent individual surfaces such as browser tabs, desktop apps, or mobile apps.

## Product Decisions

- Local web UX stays zero-step: `http://127.0.0.1:58405/web/` should load directly on the default localhost daemon without login, token copying, or browser-specific setup.
- For option 1, one daemon home represents one local human web participant.
- All local browser tabs/profiles are controllers for that same participant and should be able to send messages as visible alias `you`.
- The daemon must continue enforcing unique active aliases per group; duplicate `you` aliases are not allowed.
- If an older web peer still holds `you`, the daemon-owned local web peer may reclaim that web-held membership. It must not reclaim aliases owned by Claude, Codex, Pi, or other non-web peers.
- Option 2 is intentionally not fully designed here. It should add principal identity later without forcing the option-1 implementation to be thrown away.

## Beads Conversion Plan

Use the `plan_to_beads` skill rules when creating issues from this plan. Created Beads scope:

- Option 1 epic: `sync-z2q`
- Option 2 epic: `sync-c5t`
- Original bug `sync-8qy` is superseded by `sync-z2q`

### Epic 1: Implement daemon-owned local web session store

Goal: ship the immediate option-1 fix so multiple local browser tabs and profiles can use the web UI, join groups as `you`, and send messages without alias collisions.

Affected areas:

- Daemon web/session API in `src/daemon.ts`.
- Web UI daemon datasource in `web/src/data/daemon.ts`.
- Group membership and alias collision behavior.
- Tests that cover daemon group joins and web UI data-source startup.
- User-facing docs for the local web UI session model.

Verification:

- Two simulated web clients obtain the same local web peer from the daemon.
- Two browser tabs/profiles can open `/web/`, join the same group as `you`, and send messages.
- Group roster contains one active `you` member.
- Alias collisions still occur for non-web duplicate aliases.
- Root and web typechecks pass, and relevant Bun tests pass.
- Fresh worktrees can run `make setup` to install both root and web dependencies before verification.

Create these child issues under Epic 1:

1. **Add daemon local web session endpoint**
   - Description: Add a daemon endpoint such as `POST /web/session` that returns a stable local web peer for the daemon home. It should upsert/register the peer and return the current peer envelope used by web state calls.
   - Impact area: daemon REST routing, peer registration/upsert behavior, web API contract.
   - Acceptance criteria: repeated calls return the same peer ID; the peer is visible in `/web/state`; default localhost use requires no extra auth beyond existing daemon rules.
   - How to verify: daemon integration test calls the endpoint twice and confirms stable peer identity.
   - Test plan: Bun test around endpoint behavior and peer row persistence.
   - Dependencies: none.
   - Labels: area/backend, risk/med.

2. **Add web-only stale `you` reclaim behavior**
   - Description: When the daemon-owned local web peer joins a group as `you`, deactivate/reclaim stale active `you` memberships held by other `tool='web'` peers. Preserve normal collision behavior for non-web peers.
   - Impact area: group join path, alias collision handling, roster events/inbox fanout.
   - Acceptance criteria: old web-held `you` no longer blocks the local web peer; Claude/Codex/Pi-held aliases still block; reclaim behavior is observable enough for debugging without producing duplicate active aliases.
   - How to verify: seed a group with an old web `you`, join with the local web peer, and inspect active members.
   - Test plan: daemon integration tests for web reclaim and non-web collision.
   - Dependencies: daemon local web session endpoint.
   - Labels: area/backend, risk/high.

3. **Switch web datasource to daemon-owned session**
   - Description: Replace browser-profile peer minting as the primary participation identity with the daemon session endpoint. Use the returned peer ID for state, autojoin, messages, DMs, room refreshes, and optimistic messages.
   - Impact area: web daemon datasource, startup/connect flow, localStorage peer handling.
   - Acceptance criteria: multiple tabs/profiles call the daemon and converge on the same peer ID; no per-profile `you` group member is created; sending still works.
   - How to verify: manual browser test and data-source unit/integration test where possible.
   - Test plan: web typecheck plus targeted tests if the current web test setup supports datasource testing.
   - Dependencies: daemon local web session endpoint.
   - Labels: area/frontend, risk/med.

4. **Document local web session behavior**
   - Description: Document that the daemon owns the local web participant and that browser tabs/profiles are controllers for that participant. Clarify that opening `/web/` remains enough for local usage.
   - Impact area: README or web docs, `CLAUDE.md`/`AGENTS.md` consistency if touched, and synchronize-debugging skill references.
   - Acceptance criteria: docs explain option-1 behavior, stale-web recovery, and future principal direction without promising mobile principal support yet; `.claude/skills/synchronize-debugging/glossary.md` includes any new concept/route/code-location terms added by this work; `.claude/skills/synchronize-debugging/reference-v0-plans.md` indexes this plan after bd issues exist.
   - How to verify: doc review, `wc -l docs/plans/web-local-session-store.md`, and targeted checks that the skill index and glossary mention the new local web session concept.
   - Test plan: no runtime tests.
   - Dependencies: implementation issues.
   - Labels: area/docs, risk/low.

5. **Verify multi-tab and multi-browser web participation**
   - Description: Run the end-to-end verification pass for the option-1 behavior, including manual or automated browser coverage and daemon state inspection.
   - Impact area: test harness/manual QA, `make inspect-groups`, daemon runtime state.
   - Acceptance criteria: same-browser tabs and different-browser profiles can send as `you`; roster shows one `you`; no alias collision screen appears.
   - How to verify: record commands and observed daemon state in the issue close notes.
   - Test plan: `bun test`, root typecheck, web typecheck, manual `/web/` browser test.
   - Dependencies: web datasource switch, stale reclaim behavior.
   - Labels: area/infra, risk/low.

6. **Simplify new worktree dependency setup** (`sync-z2q.6`)
   - Description: Add a first-class setup path for fresh worktrees so root and web dependencies are installed together.
   - Impact area: `Makefile`, README, `CLAUDE.md`, `AGENTS.md`.
   - Acceptance criteria: `make setup` installs root and web dependencies; `make link` benefits from setup; setup docs point new worktrees at `make setup`.
   - How to verify: run `make setup`, `cd web && bun run typecheck`, and `cd web && bun run build`.
   - Test plan: setup command and web verification commands.
   - Dependencies: none.
   - Labels: area/infra, risk/low.

Parallelism: after the daemon endpoint issue lands, backend stale reclaim and frontend datasource changes can proceed in parallel.

### Epic 2: Design future principal identity model

Goal: capture the option-2 direction without implementing it now. The future model should separate human/app principals from peers/connections so one human can use web, desktop, iOS, Android, and other surfaces as the same visible participant with shared membership and read state.

Affected areas:

- Future schema for `principals`.
- Relationship from peers/connections to principals.
- Group membership, alias uniqueness, mention resolution, event authorship, read state, and live push delivery.
- Migration strategy from peer-owned membership to principal-owned membership.

High-level acceptance:

- A design doc explains principal vs peer vs connection semantics.
- It records that group membership, alias uniqueness, mentions, and read state should belong to principals.
- It records that peers/connections should own presence, transport delivery, and exact sender audit trail.
- It does not require child implementation issues yet.

No child issues are needed under Epic 2 for this pass.

## Implementation Notes For Option 1

- Prefer a daemon-owned local web peer ID that is deterministic per daemon home, such as `web:local-human`, unless existing ID validation requires a UUID-shaped value.
- Keep existing auth behavior: localhost default remains unauthenticated; non-localhost continues to follow the existing `SYNCHRONIZE_TOKEN` rules.
- Avoid using duplicate aliases as a solution.
- Avoid generating user-visible aliases like `you-2` for local tabs; that would conflict with the intended later principal model.
- Keep any localStorage migration defensive. Old `synchronize.web.peerId` values should not prevent the daemon endpoint from becoming the source of truth.
- Follow the synchronize-debugging skill maintenance protocol:
  - Update `.claude/skills/synchronize-debugging/glossary.md` when introducing the local web session concept, endpoint, constants, or changed code locations.
  - After creating the Beads epics/issues from this plan, add `docs/plans/web-local-session-store.md` to `.claude/skills/synchronize-debugging/reference-v0-plans.md`; do not add that index row before the issues exist.
