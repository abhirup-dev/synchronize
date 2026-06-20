# Phase 9 — Agent control surfaces (spawn / archive-resume / roster + activity)

## Objective
Full agent lifecycle control from the phone — the explicitly-required **spawning agents** and **archive/resume** — plus the roster and activity feed, at parity with the web UI.

## Depends on
Phase 5 (shell/nav). Can run in parallel with 7 and 8. (Placed after chat per the stated chat-first priority.)

## Background (measured)
Desktop already has these: `SpawnAgentDialog.tsx` (tool/model/name/repo/thinking), `ArchiveRecovery.tsx` (dry-run previews for session/group archive + resume, force-resume), `AgentRoster.tsx` (online/busy/idle/offline, active/archived), `ActivityView.tsx` (mentions/awaiting). Hooks: `useSpawnAgent`, `useArchiveCommands`, roster/activity hooks in `context.tsx`. No new daemon endpoints expected.

## Steps
1. **SpawnAgent screen** (`web/src/mobile/SpawnAgent.tsx`): tool + model selection (Sonnet/Haiku/Opus/GPT-5.5/etc.), custom name, **repo path** (recents/presets to avoid typing long paths on mobile), thinking level. Submit via `useSpawnAgent`; show launch progress + result.
2. **ArchiveResume screen** (`web/src/mobile/ArchiveResume.tsx`): archive a session or whole group with **dry-run preview**; resume with preview + **force-resume**; mirror `ArchiveRecovery` flows via `useArchiveCommands`.
3. **Roster** (`web/src/mobile/Roster.tsx`): agents with presence (online/busy/idle/offline) and lifecycle (active/archived); tap → DM or group context.
4. **Activity tab** (`web/src/mobile/Activity.tsx`): mentions + awaiting feed with the awaiting count badge; tap → jump to the message/thread.

## Files created/touched
- `web/src/mobile/SpawnAgent.tsx`, `ArchiveResume.tsx`, `Roster.tsx`, `Activity.tsx` (NEW).
- Reuse `useSpawnAgent`, `useArchiveCommands`, roster/activity hooks (no changes expected).

## Wiring
Pure client surfaces over existing hooks/endpoints. Spawn → daemon launch → SSE reflects the new peer; archive/resume → daemon archive routes → SSE reflects lifecycle changes; roster/activity read `/web/state` + `/activity/*`.

## Acceptance criteria
- [ ] Spawn an agent (tool+model+name+repo+thinking) from the phone; it appears in the roster/chats.
- [ ] Archive a session/group with dry-run preview; resume it (incl. force-resume).
- [ ] Roster shows correct presence + lifecycle, live.
- [ ] Activity feed shows mentions/awaiting with the count; tapping navigates correctly.

## Risks & mitigations
- Repo-path entry on mobile is awkward → recents/presets/last-used list.
- Long-running spawn feedback → progress + eventual SSE confirmation; handle timeouts.
- Dry-run/force-resume parity gaps → diff against `ArchiveRecovery` behavior.

## Suggested `bd` units
- `SpawnAgent screen (tool/model/name/repo presets/thinking)` (feature)
- `ArchiveResume screen (dry-run preview + force-resume)` (feature)
- `Roster (presence + lifecycle)` (feature)
- `Activity tab (mentions/awaiting + navigation)` (feature)
