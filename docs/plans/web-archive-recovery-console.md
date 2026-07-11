# Web Archive Recovery Console

## Purpose

Add UI-level archive and resume workflows for the existing archive/resume daemon
feature. The web UI should let an operator archive whole groups, archive
individual sessions, inspect archived sessions, and resume sessions or groups
through preview-and-confirm flows.

The daemon remains the source of truth. The web UI must not create a second
archive registry, infer lifecycle state independently, or mutate archive-like
state locally.

## Decisions

- Put archive actions in the current context menus where the operator already
  acts on groups and sessions.
- Put the archived-session recovery console behind a bottom-left `ARCHIVE`
  control beside the existing `YOU` control, not beside `ACTIVITY`.
- Make archive and resume transactional: every mutating action opens a dedicated
  preview view first, then requires explicit confirmation.
- Model group archive status as derived state from backend lifecycle fields,
  not as a new group lifecycle column.
- Defer timeline-native archive/resume history UI. That future direction is
  tracked separately by `sync-sco4`.

## Non-Goals

- No timeline-first lifecycle experience in this pass.
- No independent web-only archive state.
- No direct one-click destructive archive/resume action.
- No attempt to solve product-level archive retention or auto-archive policy.

## Current Backend Shape

The backend already exposes the lifecycle primitives this UI should use:

- `POST /archive/session`
- `POST /archive/group`
- `GET /archive/sessions`
- `POST /resume/session`
- `POST /resume/group`

Archive already accepts `dry_run` and returns per-session outcomes. Resume has
`print` and `launch` modes today, but the UI needs a non-mutating resume preview
contract that reports launchability, cwd availability, liveness blocking, force
requirements, and member-level group outcomes without enqueuing launches.

The state model to project into the web UI is:

```text
peers.lifecycle_state
  active
  archived

group_members.member_state
  active
  archived
  left

group archive state
  active    = at least one active member and no archived seats
  mixed     = at least one active member and at least one archived seat
  archived  = no active members and at least one archived seat
```

`groups` do not need a separate archived flag for this UI. A group is considered
archived when all currently reserved seats are archived and no active members
remain.

## Shell Placement

The current web shell keeps the main navigation in the left sidebar, the chat in
the middle, and the roster on the right. The archive entry point should sit in
the bottom-left control strip beside `YOU`.

```text
┌──────────────────────────────┬──────────────────────────────────────────────┬────────────────────────┐
│ S SYNCHRONIZE                │ # archive-resume-lab                         │ AGENTS                 │
│ search rooms...              │ ──────────────────────────────────────────── │ 4                      │
│                              │ Cortex  We can archive this batch now...     │ ● WORKING              │
│ ACTIVITY                 12  │                                              │  C Cortex              │
│                              │ Atlas   Resume path should stay daemon-owned │  A Atlas               │
│ GROUPS                   8   │                                              │ ● READY                │
│  # launch-kernel             │                                              │  V Vega                │
│  # archive-resume-lab  ◀     │                                              │ ● OFF                  │
│  # remote-sync               │                                              │  N Nova                │
│                              │                                              │                        │
│ DMs                      5   │                                              │                        │
│  Atlas                       │                                              │                        │
│  Vega                        │                                              │                        │
│                              │                                              │                        │
│                              │                                              │                        │
│ ┌─────┐        ┌──────────┐  │ ┌──────────────────────────────────────────┐ │                        │
│ │ YOU │        │ ARCHIVE  │  │ │ message...                              │ │                        │
│ └─────┘        └──────────┘  │ └──────────────────────────────────────────┘ │                        │
└──────────────────────────────┴──────────────────────────────────────────────┴────────────────────────┘
```

## Context Actions

Group context menu:

```text
Right-click #archive-resume-lab

┌──────────────────────────────┐
│ Spawn agent...               │
├──────────────────────────────┤
│ Mark as read                 │
│ Pin to top                   │
│ Mute notifications           │
├──────────────────────────────┤
│ Archive group...             │
│ Resume archived sessions...  │
├──────────────────────────────┤
│ Copy room id                 │
├──────────────────────────────┤
│ Leave group                  │
└──────────────────────────────┘
```

Agent roster context menu:

```text
Right-click @atlas

┌──────────────────────────────┐
│ Focus on @atlas              │
│ Open DM                      │
│ View profile                 │
├──────────────────────────────┤
│ Copy AOE attach command      │
├──────────────────────────────┤
│ Archive session...           │
│ Resume session...            │
├──────────────────────────────┤
│ Change color...              │
│ Copy @handle                 │
│ Mute mentions                │
└──────────────────────────────┘
```

The menu items open preview views. They must not perform the mutation directly.

## Archive Preview View

Archive preview is a dedicated modal or drawer-level view opened from a specific
archive action. It calls the backend dry-run endpoint first, renders the returned
plan, collects an optional reason, and only archives after explicit confirmation.

```text
┌──────────────────── Archive Group ────────────────────┐
│ #archive-resume-lab                                    │
│                                                        │
│ This will archive 4 active sessions.                   │
│                                                        │
│ SESSION      TOOL     RESULT        NOTES              │
│ @cortex      claude   will archive  AOE session reaped │
│ @atlas       pi       will archive  resume available   │
│ @nova        claude   zombie        process still live │
│ @vega        pi       already archived                 │
│                                                        │
│ Reason                                                 │
│ [ end of current investigation batch                 ] │
│                                                        │
│ [Cancel]                         [Confirm archive]     │
└────────────────────────────────────────────────────────┘
```

Important behavior:

- `Confirm archive` is disabled while the dry run is loading.
- If dry run returns only `already_archived` rows, show that clearly and disable
  confirmation unless there is still a meaningful backend mutation.
- Zombie warnings are informational for archive; the daemon can still archive
  unreapable non-AOE sessions, but the UI should surface that resume may later
  require force or manual cleanup.
- After confirmation succeeds, refresh `/web/state` and archived-session data.

## Resume Preview View

Resume should mirror archive: first load a backend-owned preview, then confirm.

```text
┌──────────────────── Resume Group ──────────────────────┐
│ #archive-resume-lab                                    │
│                                                        │
│ This will resume 3 archived sessions.                  │
│                                                        │
│ SESSION      TOOL     RESULT        NOTES              │
│ @cortex      claude   will launch   cwd exists         │
│ @atlas       pi       blocked       peer still live     │
│ @nova        claude   blocked       cwd missing         │
│                                                        │
│ [ ] Force live blocked sessions                         │
│                                                        │
│ [Cancel]                         [Confirm resume]      │
└────────────────────────────────────────────────────────┘
```

The UI should not infer resume readiness from archived session summaries alone.
It needs daemon responses that distinguish:

- `will_launch`
- `will_print`
- `blocked_peer_still_live`
- `blocked_cwd_missing`
- `resume_not_launchable`
- `peer_not_archived`
- `skipped`

Force should be explicit and scoped to live-process blocks. It should not bypass
missing cwd or non-launchable-tool failures.

## Archived Sessions View

The archived sessions view is a high-level recovery console. It is not tied to a
single context action. It opens from the bottom `ARCHIVE` control and lets the
operator inspect, filter, group, navigate, and begin resume flows.

```text
┌──────────────────────────────── ARCHIVE ────────────────────────────────┐
│ Search archived sessions...              Group: all   Tool: all   State │
├───────────────────────┬────────┬──────────────┬──────────────┬─────────┤
│ GROUP / SESSION        │ TOOL   │ STATE        │ ARCHIVED     │ ACTION  │
├───────────────────────┼────────┼──────────────┼──────────────┼─────────┤
│ archive-resume-lab     │        │ 3 archived   │              │ Resume  │
│   @cortex              │ claude │ resumable    │ 12m ago      │ Preview │
│   @atlas               │ pi     │ zombie       │ 12m ago      │ Preview │
│   @nova                │ claude │ cwd missing  │ 14m ago      │ Details │
│ remote-sync            │        │ 1 archived   │              │ Resume  │
│   @vega                │ pi     │ resumable    │ 1h ago       │ Preview │
└───────────────────────┴────────┴──────────────┴──────────────┴─────────┘
```

This view should support:

- search by group, alias, session name, peer id, cwd, and tool
- grouping by group name by default
- filters for tool, group, archived reason/source, and readiness state
- row actions for details and resume preview
- group row action for resume-group preview
- navigation back to the group room when the group still exists

The readiness state shown here can be stale if it depends on live liveness/cwd
checks. If the backend cannot compute readiness cheaply in `GET /archive/sessions`,
the console may show stored archive facts first and compute fresh readiness when
the operator opens preview/details.

## Session Details View

```text
┌──────────────────────────── Archive Details ────────────────────────────┐
│ @atlas in #archive-resume-lab                                            │
│ peer_id        peer:abc123                                               │
│ host session   019e...                                                   │
│ tool           pi                                                        │
│ cwd            /Users/abhirupdas/Codes/Personal/synchronize              │
│ archived       manual, 12m ago                                           │
│ aliases        archive-resume-lab/@atlas                                 │
│ status         zombie: process still alive, resume blocked without force  │
├──────────────────────────────────────────────────────────────────────────┤
│ [Print command]        [Resume preview]        [Close]                   │
└──────────────────────────────────────────────────────────────────────────┘
```

Details should show raw identifiers because recovery workflows are operator
workflows. Copy affordances are useful for `peer_id`, `host_session_id`, cwd,
and printed resume commands.

## Data Contract Changes

Extend the web data model with lifecycle state instead of hiding it inside UI
logic:

```ts
type AgentLifecycleState = "active" | "archived";
type RoomArchiveState = "active" | "mixed" | "archived";
type MemberState = "active" | "archived" | "left";

interface Agent {
  lifecycleState: AgentLifecycleState;
  archivedAt?: string;
  archivedReason?: string;
  archiveSource?: "manual" | "auto" | string;
}

interface Room {
  archiveState: RoomArchiveState;
  archivedMemberCount?: number;
  activeMemberCount?: number;
  memberStates?: Record<string, MemberState>;
}
```

`/web/state` should include enough membership rows for the UI to derive mixed
and archived groups. Today the web client filters memberships to active rows for
room rendering. The archive UI needs archived membership rows too, either in the
main `memberships` collection or in an archive-specific section.

## API Contract Additions

Recommended additions:

```text
POST /resume/session/preview
POST /resume/group/preview
```

Alternative:

```text
POST /resume/session { dry_run: true }
POST /resume/group   { dry_run: true }
```

The `dry_run` shape is consistent with archive and is probably simpler for
clients. The important point is that preview must not enqueue a launch or kill a
live process.

The preview response should include:

```ts
interface ResumePreviewSession {
  peer_id: string;
  alias: string | null;
  session_name: string;
  tool: string;
  group: string | null;
  cwd: string | null;
  host_session_id: string | null;
  action: "will_launch" | "will_print" | "blocked" | "skipped";
  code?: "peer_still_live" | "cwd_missing" | "resume_not_launchable" | "peer_not_archived" | "error";
  force_available: boolean;
  warning?: string;
}
```

Archive preview can initially reuse existing `dry_run` responses, but the UI may
benefit from normalizing archive and resume previews into a shared client shape.

## Component Plan

Primary web files likely involved:

- `web/src/data/types.ts`
- `web/src/data/daemon.ts`
- `web/src/data/mock.ts`
- `web/src/components/Sidebar.tsx`
- `web/src/components/AgentRoster.tsx`
- new `web/src/components/ArchiveButton.tsx`
- new `web/src/components/ArchiveConsole.tsx`
- new `web/src/components/ArchivePreviewDialog.tsx`
- new `web/src/components/ArchiveDetailsDialog.tsx`

Data source commands should be explicit:

```ts
archiveSessionPreview(input): Promise<ArchivePreview>
archiveGroupPreview(input): Promise<ArchivePreview>
confirmArchiveSession(input): Promise<ArchiveResult>
confirmArchiveGroup(input): Promise<ArchiveResult>
resumeSessionPreview(input): Promise<ResumePreview>
resumeGroupPreview(input): Promise<ResumePreview>
confirmResumeSession(input): Promise<ResumeResult>
confirmResumeGroup(input): Promise<ResumeResult>
archivedSessions(): Snapshot<ArchivedSession[]>
```

The UI components should consume those commands rather than calling `fetch`
directly.

## State Refresh

After any confirmed archive or resume action:

- refresh `/web/state`
- refresh archived sessions
- refresh active room messages if the active room is affected
- show a toast with summarized member outcomes

Resume launch confirmation may return before agents fully re-register. The UI
should render a launching/queued status from launch lifecycle state rather than
claiming the session is active immediately.

## Validation

Focused verification should cover:

- right-click group opens archive preview and no mutation occurs before confirm
- confirm archive mutates through daemon endpoint and updates active roster
- bottom archive button opens archived sessions console
- console filters/grouping work against daemon and mock data
- resume preview does not enqueue launches
- confirm resume enqueues launches or prints commands according to selected mode
- archived memberships remain reserved but delivery-dark
- UI survives mixed groups, fully archived groups, non-launchable sessions,
  missing cwd, and live zombie sessions

Suggested gates:

```bash
bun test tests/archive-routes.test.ts
bun test tests/archive-resume.test.ts
bun run typecheck
cd web && bun run typecheck
cd web && bun run build
```

For the final implementation pass, validate the UI in the browser against a
throwaway `SYNCHRONIZE_HOME` with seeded active, mixed, and archived groups.

## Implementation Slices

The work should be sliced so backend contracts land before the web depends on
them:

| Slice | Purpose |
|---|---|
| Backend resume preview | Add non-mutating resume dry-run/preview contracts for session and group resume. |
| Web archive state contract | Expose lifecycle/member-state fields through `DataSource` and preserve archived seats in web state. |
| Archive preview/confirm | Add group/session archive preview dialogs and confirmation flow. |
| Archive console | Add bottom `ARCHIVE` control, archived session list, grouping, filters, details, and navigation. |
| Resume preview/confirm | Add session/group resume preview and confirmation from both context menus and the archive console. |
| Browser verification | Seed realistic archive states and verify context menus, previews, console filters, and refresh behavior. |

