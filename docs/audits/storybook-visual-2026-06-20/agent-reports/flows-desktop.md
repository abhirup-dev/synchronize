# Flows / End-to-End Demos - Desktop Brutal Pass

## 1. Capture Method

- Server: private Storybook from `/Users/abhirupdas/Codes/Personal/synchronize/web` on `http://localhost:6009`.
- Viewport: `1280x720` desktop.
- Browser: isolated headless Playwright Chromium launched from `web/node_modules/playwright`; no Codex in-app browser used.
- Source read first: `web/src/components/Flows.stories.tsx`, plus `web/src/components/ThreadPane.tsx` and `web/src/data/seed.ts` for the confirmed scroll behavior.
- Stable-state handling: waited for each play story to finish; the demo story was rechecked after a longer settle window up to about 22s.
- Server stopped: yes.

## 2. Stories Reviewed

| Story id | Result | Notes |
| --- | --- | --- |
| `flows-activity-to-thread--open-thread-from-activity` | fail | Current equivalent of the activity/thread flow; final reply is not visible after the story's scroll step. |
| `flows-activity-to-thread--open-thread-from-activity-demo` | fail | Same helper and same final visual defect after extended settling. |
| `flows-synchronize-ui--activity-thread-scroll-and-emoji` | deferred | Requested id not present in `index.json` for this worktree/server. |
| `flows-synchronize-ui--activity-thread-scroll-and-emoji-demo` | deferred | Requested id not present in `index.json` for this worktree/server. |
| `flows-synchronize-ui--chat-top-thread-traversal` | deferred | Requested id not present in `index.json` for this worktree/server. |
| `flows-synchronize-ui--chat-top-thread-traversal-demo` | deferred | Requested id not present in `index.json` for this worktree/server. |
| `flows-synchronize-ui--compact-nav-and-settings` | deferred | Requested id not present in `index.json`; also compact/mobile by name and outside this desktop brutal pass. |
| `flows-synchronize-ui--compact-nav-and-settings-demo` | deferred | Requested id not present in `index.json`; also compact/mobile by name and outside this desktop brutal pass. |
| `flows-synchronize-ui--spawn-agent-entrypoint` | deferred | Requested id not present in `index.json` for this worktree/server. |
| `flows-synchronize-ui--spawn-agent-entrypoint-demo` | deferred | Requested id not present in `index.json` for this worktree/server. |

## 3. Confirmed Failures

### `flows-activity-to-thread--open-thread-from-activity`

- Expected from source: `activityToThread()` opens Activity, clicks the `rollout checklist deep-dive` row, verifies the thread opens at the top, then scrolls to the bottom so the latest reply, `FINAL: ship the ranker to 100% -- checklist fully cleared`, becomes visible.
- Observed: the stable desktop render stops around replies 8-12; the final reply exists in the thread pane DOM but is below the viewport. DOM evidence after the play settled: `.thread-pane-body` had `scrollTop: 1230` while its max scroll was `1818`.
- Severity: 3.
- Likely cause: story/play wiring, not component rendering. A follow-up isolated check forced `.thread-pane-body.scrollTop` to the actual max, and the final reply appeared correctly.
- Screenshot: `docs/audits/storybook-visual-2026-06-20/screenshots/flows-desktop--flows-activity-to-thread--open-thread-from-activity.png`.

### `flows-activity-to-thread--open-thread-from-activity-demo`

- Expected from source: same flow as above, paced with pauses and smooth scrolling for a watchable demo; final stable state should demonstrate the latest reply visible at the bottom of the long thread.
- Observed: after extended settle checks up to about 22s, the pane remained at `scrollTop: 1230` with max `1818`, showing replies 8-12 instead of the final checklist-cleared reply.
- Severity: 3.
- Likely cause: story/play wiring shared with the non-demo story. The helper scrolls to the current `scrollHeight` before the virtualized list has fully materialized/measured the lower rows, so the visual final state stops short.
- Screenshot: `docs/audits/storybook-visual-2026-06-20/screenshots/flows-desktop--flows-activity-to-thread--open-thread-from-activity-demo.png`.

## 4. Deferred / Blocked Stories

The eight requested `flows-synchronize-ui--*` stories were not present in the live Storybook `index.json`; only these flow entries existed:

- `flows-activity-to-thread--docs`
- `flows-activity-to-thread--open-thread-from-activity`
- `flows-activity-to-thread--open-thread-from-activity-demo`

The autodocs entry was not treated as an assigned flow/demo state. The `compact-nav-and-settings` requested ids are also compact/mobile by intent, so even if present they would be deferred from this brutal-theme desktop pass.

## 5. Source / Story Wiring Smells

- `Flows.stories.tsx` asserts visibility with `toBeVisible()`, but that does not prove the text is inside the scroll container viewport. The final reply can be present and CSS-visible while still below the visible pane.
- The helper sets `body.scrollTop = body.scrollHeight` / `scrollTo({ top: body.scrollHeight })` directly against a TanStack-virtualized thread. After the virtualizer measures later rows, the max scroll increases, leaving the viewport short of the actual bottom.
- A more reliable demo/test action would use the virtualizer API, repeatedly scroll to the current max until stable, or assert viewport intersection within `.thread-pane-body` rather than DOM visibility alone.
