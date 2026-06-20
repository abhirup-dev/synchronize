---
name: synchronize-debugging
description: Use when debugging or inspecting the synchronize agent messaging bus -- daemon health, wrong worktree, stale state, peer disappearance, 404 Peer not found, missed DMs/group messages/thread replies/@mentions, isolated dev runtimes, archive/resume, launch, web, or "what is this daemon doing?" -- and for web/ UI bugs: component render/visual/layout issues, broken story or play-test, theme/skin/responsive problems, or using Storybook + its MCP to diagnose and regression-guard UI.
---

# synchronize-debugging

Small dispatcher for daemon debugging. Use it to pick the next document; do not
load every reference file.

## First Commands

```bash
make doctor                 # local runtime: daemon + peers + groups + events + logs + tmux
make inspect-daemon         # pid, port, base_url, process command/worktree
make inspect-peers          # alive / online / soft-deleted / agent_sessions
make inspect-groups         # groups + active members + last activity
make inspect-events N=50    # recent events

synchronize remote doctor   # active remote profile readiness
synchronize remote show      # resolved remote profile/env values
```

For web/ UI (Storybook) issues:

```bash
cd web && bun run storybook            # dev server + MCP on :6006
cd web && bun run storybook:build      # static build (compile check)
cd web && bun run test:storybook       # render + play + a11y, headless
cd web && bun run test:storybook:headed  # visible Chromium (own terminal)
cd web && bun run test:storybook:ui      # @vitest/ui dashboard (own terminal)
```

For isolated checks, prefix commands with:

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize
```

Inspect first. Do not relaunch, delete peers, or wipe production state unless
the operator explicitly asks.

## Router

| Symptom | Load |
|---|---|
| Daemon stale/down/wrong worktree/port/lock/restart | `daemon-forensics.md` |
| Isolated runtime for testing | `dev-server-mode.md` |
| Peer disappeared, 404, online-but-not-pushed | `peer-lifecycle.md` |
| DM/group/thread/mention/media/inbox/push issue | `delivery-forensics.md` |
| Exact reply target vs thread root | `reply-target-forensics.md` |
| web/ UI render/visual/story/play-test/theme/responsive | `ui-forensics.md` |
| Qualitative Storybook component sweep with screenshots | `storybook-visual-audit.md` |
| Raw SQL recipes | `docs/debugging/sql-queries.md` |
| Code ownership/file locations | `glossary.md` |
| Historical plans | `reference-v0-plans.md` (gated) |

## Durable References

| Need | Go to |
|---|---|
| Config/env/profile details | `docs/configuration/README.md` |
| Heavy debugging recipes | `docs/debugging/README.md` |
| Storybook/UI heavy recipes + MCP catalog | `docs/debugging/storybook.md` |
| Repeatable Storybook visual audit protocol | `storybook-visual-audit.md` |
| Current code map | `glossary.md` |

```text
inspect -> read DB/logs -> preserving restart -> isolated repro
        -> production wipe only with explicit approval
```
