# Agentic UI Verification Pipeline

Status: planned and partially implemented on `codex/ui-verification-automation`.
Date: 2026-06-20.

## Purpose

Build a reusable UI verification substrate that treats synchronize web as the first proving ground, while keeping the design generic enough for other UI projects. The goal is not another browser smoke script. The goal is durable, reproducible UI operations: named user flows, executable probes, flow capture, component ownership, stale-flow detection, adapter health checks, and a path from deterministic browser probes to agent-assisted UI exploration.

Synchronize is a concrete instance of a broader class of UIs that need this: stateful local web apps whose important correctness properties live across navigation, live data, virtualized lists, split panes, browser state, asynchronous agents, and visually rendered rich content. API checks can prove data exists, but only a browser can prove the user can find it, open it, scroll it, and inspect it without layout or rendering regressions.

## Research Baseline

The shared discussion argued for a repo-local UI flow memory and verification planner: flow registry, probe library, verification matrix, run journal, state graph, and verification debt. Local research and implementation confirmed the practical shape:

- Playwright is the committed probe substrate because it gives deterministic selectors, traces, screenshots, viewport projects, and repeatable local execution.
- The Codex in-app browser is useful for visible verification and human confidence, but Playwright should own the artifact-producing runner.
- Chrome DevTools MCP, Playwright MCP, Libretto, and Stagehand are useful agent/debug adapters; none should be the source of truth for gating deterministic flows.
- Libretto is useful for recording and inspecting discovered workflows. In this repo worktree it must run with `LIBRETTO_DISABLE_DOTENV=1` because `.env/` is a directory and Libretto's worktree dotenv resolution tries to read it.
- Stagehand should be optional at first. It needs an OpenAI-compatible endpoint; VibeProxy exposes `http://127.0.0.1:8318/v1`, and `gpt-5.5` has been smoke-verified through chat completions.
- WebMCP/MCP-B style app-owned semantic tools are promising for later because DOM observations alone cannot reliably answer "which domain component is mounted?" or "which flow entrypoint owns this button?"

## Architecture

```text
tools/ui-probe/
  run.ts                         # Orchestrates daemon discovery, snapshot, probes, adapters, summary
  flowbook.ts                    # Validates flow metadata and component glossary staleness
  glossary/components.json       # App component vocabulary used by flows and stale checks
  flows/*.json                   # Named UI flow contracts and adaptive/exploratory probes
  probes/*.probe.ts              # Playwright probes promoted from flow contracts
  artifacts/latest/              # Ignored run output: summaries, screenshots, traces, state
```

Core runner behavior:

1. Discover the active real daemon with `bun run src/cli.ts status`.
2. Validate the checked-in flowbook and component glossary before launching the browser.
3. Build `web/dist` from the current worktree.
4. Snapshot the real daemon DB and media into an isolated `SYNCHRONIZE_HOME`.
5. Start a temporary daemon from the current worktree over that real data snapshot.
6. Fetch `/web/state` for data-grounded target selection.
7. Run Playwright probes against the snapshot daemon.
8. Write machine-readable and human-readable run artifacts.
9. Optionally run readiness checks for VibeProxy, Stagehand, Libretto, Chrome DevTools MCP, and Playwright MCP.

This default mode uses real data volume without mutating the user's production daemon.

## Flow Taxonomy

The substrate must distinguish flows by determinism because different UI facts need different verification techniques.

| Class | Meaning | Gating policy | Example |
|---|---|---|---|
| Deterministic contract | Stable workflow with known entrypoint, data precondition, steps, and assertions. | Must pass in CI/local preflight once active. | Activity board -> row -> thread pane -> bottom scroll -> emoji rendering. |
| Adaptive semantic flow | User intent is stable but UI placement may move. Locator can use accessible roles, glossary ownership, app-native hooks, and model-assisted observe. | Warning or quarantined until promoted to deterministic assertions. | Find the spawn-agent affordance even if it moves from top toolbar to bottom rail. |
| Exploratory capture | Agent/browser recording that discovers transitions and candidate locators. | Never gates directly. Must be reviewed and promoted. | Libretto/Stagehand session exploring archive recovery paths. |
| Mutating rehearsal | Flow that changes state and therefore must run only on snapshot/seeded data. | Gated only against isolated daemon state. | Dry-run agent spawn, message send, reaction toggle, attachment upload. |

Each flow records `id`, `status`, `tier`, `determinism`, `owner`, `entry`, `preconditions`, `components`, `steps`, `assertions`, `staleIf`, `probeFile`, and `artifacts`.

## First Contract Flows

`activity.thread-row.open-scroll-emoji` is the first active contract. It encodes the invariant the UI must preserve:

1. Open `/web`.
2. Open the Activity board.
3. Select a real-data activity row whose backing event has a thread and reaction emoji.
4. Click the row.
5. Verify the in-place `ThreadPane` opens.
6. Scroll `.thread-pane-body` to the bottom.
7. Verify the composer remains mounted.
8. Verify the expected emoji appears in the reaction button text and accessible label without replacement characters.
9. Capture a screenshot.

This is intentionally precise. It verifies navigation, real data matching, split-pane behavior, scroll behavior, rich glyph rendering, and accessibility metadata in one reproducible contract.

`chat.top-thread-traversal.scroll-bottom` is the second active contract. It encodes the chat traversal invariant:

1. Open `/web`.
2. Open a group chat from the sidebar.
3. Build the candidate set from real snapshot root messages with `reply_count > 1`.
4. Consider at most the five newest candidates in that group.
5. Open two different thread badges from that top-five set.
6. Scroll each opened thread body to the bottom.
7. Verify the thread pane and composer stay mounted for each traversal.
8. Capture one screenshot per opened thread.

This verifies normal chat navigation rather than Activity navigation: room selection, virtualized chat rows, thread badge affordances, split-pane thread lifecycle, close/reopen behavior, and thread scroll behavior across two different thread roots.

`agents.spawn-entrypoint.adaptive` is the first planned adaptive flow. Its invariant is not button position; the invariant is that a user or agent can discover the spawn-agent affordance by meaning. It should use accessible names first, then glossary ownership, then app-native semantic hooks, and finally Stagehand/Libretto observation as a discovery assist. It should not gate until it can run in dry-run or snapshot-only mode.

Additional high-value contracts to add next:

- `archive.recovery-console.open-details`: open archive recovery, inspect one archived session, close details without mutation.
- `composer.attachment-preview.snapshot`: add a local fixture attachment in snapshot mode, verify preview and removal.
- `thread.reply-focus-from-activity`: click an Activity row representing a reply and verify the opened thread centers that reply, not only the root.
- `compact.activity-navigation`: in compact viewport, navigate into Activity and back without overlapping overlays.

## Component Glossary

The glossary is a checked-in vocabulary of UI components and surfaces. It lets probes depend on domain components instead of anonymous selectors.

Each component records:

- `id`: stable glossary key, such as `activity-view` or `thread-pane`.
- `files`: owning source files.
- `symbols`: exported symbols or component names expected in those files.
- `selectors`: known DOM hooks used by probes.
- `surfaces`: UI surfaces where the component appears.
- `staleChecks`: static or runtime checks that can detect drift.

The first glossary lives at `tools/ui-probe/glossary/components.json`. The flowbook checker currently verifies file existence, symbol presence, active probe existence, unique IDs, and valid determinism classes. Runtime selector coverage and diff-aware coverage are the next layers.

## Stale Probe Detection

A probe can go stale in several ways. The framework should detect all of these explicitly:

- Static staleness: referenced files, exported symbols, selectors, or active probe files disappear.
- Runtime staleness: the browser cannot find the required semantic anchor or selector in a valid app state.
- Data staleness: the real/snapshot data no longer satisfies the flow precondition.
- Diff staleness: a worktree changes a component listed in the glossary but does not update any related flow or explicitly mark no flow impact.
- Ownership staleness: a flow references no current glossary component, or a component has no owner/flows after refactor.
- Fragility staleness: an adaptive flow repeatedly falls back to coordinate or text-only selectors.

Flow health should be reported as `fresh`, `suspect`, `stale`, or `orphaned`. `fresh` can gate. `suspect` should warn with evidence. `stale` should fail once the flow is active. `orphaned` means the code or flow metadata has lost its ownership link.

## Worktree Responsibility

Every worktree that changes UI code should own the flow consequences of that change.

The practical policy:

- If a diff touches a glossary component file, the worktree must run `bun run ui:probe:flows` and the relevant selected flows.
- If a diff changes a user-visible invariant, update or add a flow in `tools/ui-probe/flows`.
- If a diff renames, removes, or splits a component, update `tools/ui-probe/glossary/components.json`.
- If a flow fails because the product intentionally changed, update the flow contract in the same worktree as the product change.
- If no existing flow should cover the change, record that explicitly in the flow selector output so the omission is auditable.

This turns UI verification into a maintenance contract, not a separate QA backlog.

## Capture And Promotion

Recording tools should feed the flowbook, not bypass it.

1. Capture exploratory runs with Playwright trace, Libretto, in-app browser screenshots, Stagehand observe output, and DOM/action journals.
2. Normalize captured steps into candidate flow JSON.
3. Attach glossary components and determinism class.
4. Add assertions that prove user value rather than only that clicks succeeded.
5. Promote stable flows to Playwright probes.
6. Keep adaptive flows quarantined until locator strategy and data preconditions are reproducible.

The durable artifact is the promoted flow plus probe, not the raw recording.

## Phases

### Phase 1: Deterministic Real-Data Browser Probe Foundation

Implemented foundation:

- `bun run ui:probe` discovers the active real daemon.
- The runner snapshots real DB/media into an isolated temp daemon.
- Playwright runs against the current worktree serving real data volume.
- Artifacts include summaries, command logs, screenshots, Playwright reports, and `/web/state`.
- The first active contract flow verifies Activity row -> thread pane -> bottom scroll -> emoji rendering.

Required proof:

- `bun run ui:probe`
- `bun run typecheck`
- `cd web && bun run typecheck`
- `bun test`

### Phase 2: Adapter Readiness And Agent Handoff

Implemented readiness checks:

- VibeProxy model list and `gpt-5.5` completion.
- Stagehand package import and configuration hint for VibeProxy.
- Libretto help with `LIBRETTO_DISABLE_DOTENV=1`.
- Chrome DevTools MCP help.
- Playwright MCP help.

Policy:

- Adapter failures are warnings unless explicitly required.
- Deterministic Playwright probes remain the gate.

### Phase 3: Flowbook, Glossary, And Verification Matrix

Partially implemented:

- `tools/ui-probe/flowbook.ts check`
- `tools/ui-probe/glossary/components.json`
- Active deterministic flow metadata for Activity thread emoji.
- Planned adaptive flow metadata for agent spawn entrypoint.

Next:

- Add a diff-to-flow selector that maps changed glossary files to affected flows.
- Add runtime selector coverage to the summary.
- Add `ui:probe --flow <id>` and `ui:probe affected`.
- Fail active flows when glossary or probe references become stale.

Required proof:

- Change a glossary-owned component file and verify the selector chooses related flows.
- Run the selected Activity flow against the real-data snapshot.

### Phase 4: State Graph Scanner And Probe Promotion

Add a deterministic scanner that inventories interactable candidates, classifies read-only versus mutating transitions, records state deltas, and proposes flow JSON.

Use optional assists:

- Playwright trace for precise DOM/action evidence.
- Libretto for recording and replay review.
- Stagehand observe for semantic candidate discovery.
- Chrome DevTools MCP for debugging layout, network, and console state.

Required proof:

- Generate a state graph for Activity and archive surfaces.
- Promote at least one discovered transition into a committed deterministic probe.

### Phase 5: App-Native Semantic Probe Hooks

Expose development/probe-only app state so probes can cross-check DOM against app truth:

- mounted surfaces
- active room/view/dialog/thread state
- selected activity row or thread parent
- available semantic flow entrypoints
- dry-run mutation affordances

These hooks should be localhost/dev gated and must not leak sensitive production data beyond the local browser process.

Required proof:

- A browser probe verifies visible DOM state and app-native semantic state agree.
- A missing or renamed semantic entrypoint marks dependent adaptive flows `suspect`.

## Generic Applicability

This design should transfer to many UI projects because the hard problems are common:

- Real flows span navigation, virtual lists, drawers, dialogs, and rich rendering.
- Product changes move controls without changing user intent.
- Test IDs alone cannot explain ownership or stale coverage.
- AI/browser recordings are useful but too fragile to gate directly.
- Worktrees need local responsibility for keeping UI contracts current.
- Verification needs both exact deterministic probes and adaptive discovery.

Synchronize gives us a dense proving ground: live daemon data, real agent/session state, Activity, threads, archive recovery, responsive shells, and future mutating flows such as spawning agents. If the substrate can keep these flows reproducible and maintainable here, it is a credible generic UI verification framework.

## Constraints

- Use the active real daemon only as the source of read-only data.
- Run probes against a snapshot daemon by default so real data volume is preserved without mutating production state.
- Do not require API keys or model access for deterministic phases.
- Keep model-assisted workflows optional and quarantined until promoted.
- Keep run artifacts ignored unless intentionally promoted.
- Prefer semantic roles and user-facing text; add test IDs only when no stable user-facing handle exists.
- Distinguish selector brittleness from product failure in probe output.

## Acceptance For V0

- `bun run ui:probe` validates flow metadata, snapshots real daemon data, runs deterministic browser probes, writes artifacts, and exits cleanly.
- At least one exact Activity/thread/emoji flow is active and artifact-backed.
- Flow metadata names component dependencies and stale conditions.
- The component glossary detects missing component files, missing symbols, missing active probes, and unknown flow dependencies.
- Adapter readiness is reported without blocking deterministic probes.
- The plan and Beads backlog identify the next layers: diff-aware selection, adaptive capture, state graph scanning, app-native semantic hooks, and worktree enforcement.
