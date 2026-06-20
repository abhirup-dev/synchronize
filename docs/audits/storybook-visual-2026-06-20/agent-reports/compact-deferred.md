# Deferred Compact/Responsive Coverage Audit (Superseded)

Status: superseded by the active `compact-mobile-feat-android` pass.

This report was generated from the wrong source/runtime context and should not
be used as final compact/mobile visual evidence. It is kept only as historical
debugging context.

Date: 2026-06-20
Scope: compact/responsive Storybook bucket, separate from the desktop pass.
Browser coordination: I did not use or navigate the Codex shared in-app browser. No isolated screenshot browser was opened because Storybook could not start in this checkout.

## Summary

This bucket is blocked/suspect rather than visually passed or failed.

I read `.claude/skills/synchronize-debugging/storybook-visual-audit.md` and `docs/audits/storybook-visual-2026-06-20/NOTES.md` first. The requested compact story IDs could not be audited visually because:

- `cd web && bun run storybook -- --host 127.0.0.1 --port 6006` exits with `storybook: command not found`.
- `web/package.json` declares Storybook, but `web/node_modules/.bin` only contains `bun`, `bunx`, `tsc`, and `tsserver`.
- Source inspection found no matching story/component names for the requested IDs under `web/src/**/*.stories.tsx` or `web/src`.
- No built `storybook-static` or Storybook `index.json` artifact was present to inspect instead.

No screenshots were saved because there were no confirmed rendered failures.

## Rows

| Story ID | Result | Severity | Notes |
| --- | --- | ---: | --- |
| `navigation-bottomnav--chats-active` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `navigation-bottomnav--activity-active` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `navigation-bottomnav--agents-active-with-badge` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `navigation-bottomnav--tap-agents` | Blocked | - | Requested interaction state cannot be run; story ID not found and Storybook runtime unavailable. |
| `primitives-sheet--open` | Blocked | - | Requested sheet story ID not found in current Storybook source; Storybook runtime unavailable. |
| `primitives-sheet--dismiss-via-escape` | Blocked | - | Requested play/interaction state cannot be run; story ID not found and Storybook runtime unavailable. |
| `navigation-compactappbar--chats-overlay` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `navigation-compactappbar--agents-overlay` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `navigation-compactappbar--long-title` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `navigation-compactappbar--controls` | Blocked | - | Requested compact story ID not found in current Storybook source; Storybook runtime unavailable. |
| `surfaces-compactsettingssheet--light-brutal` | Blocked | - | Requested compact settings story ID not found in current Storybook source; Storybook runtime unavailable. |
| `surfaces-compactsettingssheet--dark-glass` | Blocked | - | Requested compact settings story ID not found in current Storybook source; Storybook runtime unavailable. |
| `surfaces-compactsettingssheet--row-interactions` | Blocked | - | Requested interaction state cannot be run; story ID not found and Storybook runtime unavailable. |

## Evidence

Source/story search:

- `rg -n "bottomnav|bottom nav|Bottom Nav|Compact App|compact app|settings sheet|Settings Sheet|Sheet" web -g "*.stories.tsx" -i` returned no matches.
- `rg -n "BottomNav|bottom nav|bottomnav|CompactAppBar|compact app|CompactSettingsSheet|settings sheet|Sheet" web/src -i` only found unrelated stylesheet/comment text.
- Enumerating `web/src/components/*.stories.tsx` shows the current available titles are the existing desktop/component stories such as `Navigation/RoomHeader`, `Navigation/Sidebar`, `Layouts/Chat Surface`, `Primitives/Identity`, and `Primitives/ResizeHandle`; it does not show `Navigation/BottomNav`, `Navigation/CompactAppBar`, `Primitives/Sheet`, or `Surfaces/CompactSettingsSheet`.

Runtime check:

- `cd web && bun run storybook -- --host 127.0.0.1 --port 6006` failed before launch with `/opt/homebrew/bin/bash: line 1: storybook: command not found`.
