# Compact/Mobile Storybook Visual Audit - feat-android-app

Date: 2026-06-20
Source worktree: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-android-app`
Scope: compact/mobile brutal-skin Storybook stories only.

## 1. Capture Method

- Storybook server: started from `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-android-app/web` with `bunx storybook dev -p 6008 --no-open`.
- Port: `6008`.
- Browser: isolated Playwright Chromium headless context, launched from the audit shell process; Codex in-app browser was not used.
- Viewports: primary `390x844`; spot-check `412x915` for the Android chat-surface overflow.
- URLs: focused iframe URLs, `http://localhost:6008/iframe.html?id=<story-id>&viewMode=story`.
- Server stopped: yes. `curl http://localhost:6008/index.json` failed after shutdown.

## 2. Stories Reviewed

Pass:

- `layouts-chat-surface--mobile-narrow-dm`
- `layouts-app-shell--compact`
- `primitives-sheet--open`
- `primitives-sheet--dismiss-via-escape`
- `navigation-compactappbar--chats-overlay`
- `navigation-compactappbar--agents-overlay`
- `navigation-compactappbar--long-title`
- `navigation-compactappbar--controls`
- `surfaces-compactsettingssheet--light-brutal`
- `surfaces-compactsettingssheet--row-interactions`
- `primitives-settingsrow--default`
- `primitives-settingsrow--appearance`
- `primitives-settingsrow--taps`

Fail:

- `layouts-chat-surface--android-compact`
- `navigation-bottomnav--chats-active`
- `navigation-bottomnav--activity-active`
- `navigation-bottomnav--agents-active-with-badge`
- `navigation-bottomnav--tap-agents`

Deferred:

- `surfaces-compactsettingssheet--dark-glass` - present in `index.json`, captured only to confirm existence, but skipped because this audit is brutal-only and glass findings are out of scope.

## 3. Confirmed Failures

### `layouts-chat-surface--android-compact`

- Expected from source: `Layouts.stories.tsx` says Android-class widths must show no horizontal overflow, using the real chat surface pinned to compact viewport presets.
- Observed: inline code chips inside message bubbles overflow the bubble width at `390x844`, visually intruding toward the timeline rail. DOM geometry confirmed `analytics.checkout_funnel` and `checkout_v2_read=true` extend past the bubble right edge. A `412x915` spot-check still showed `analytics.checkout_funnel` past the bubble right edge.
- Severity: 3.
- Likely cause: component code, probably compact message/markdown inline-code wrapping inside `ChatView`/message bubble styling.
- Screenshot: `/Users/abhirupdas/Codes/Personal/synchronize/docs/audits/storybook-visual-2026-06-20/screenshots/compact-mobile-feat-android--layouts-chat-surface--android-compact.png`

### `navigation-bottomnav--chats-active`

- Expected from source: `BottomNav.stories.tsx` and `BottomNav.tsx` describe compact-only root bottom navigation chrome.
- Observed: standalone story renders `.bottom-nav` at the top of the mobile canvas (`y=0`) instead of the bottom. The full compact shell story renders the same component at the bottom (`y=787` on an `844px` viewport), so this appears to be a Storybook harness positioning problem.
- Severity: 3.
- Likely cause: story/harness wiring.
- Screenshot: `/Users/abhirupdas/Codes/Personal/synchronize/docs/audits/storybook-visual-2026-06-20/screenshots/compact-mobile-feat-android--navigation-bottomnav--chats-active.png`

### `navigation-bottomnav--activity-active`

- Expected from source: same compact bottom navigation chrome, with Activity active.
- Observed: `.bottom-nav` renders at the top of the mobile canvas instead of the bottom.
- Severity: 3.
- Likely cause: story/harness wiring.
- Screenshot: `/Users/abhirupdas/Codes/Personal/synchronize/docs/audits/storybook-visual-2026-06-20/screenshots/compact-mobile-feat-android--navigation-bottomnav--activity-active.png`

### `navigation-bottomnav--agents-active-with-badge`

- Expected from source: same compact bottom navigation chrome, with Agents active and a member-count badge.
- Observed: `.bottom-nav` renders at the top of the mobile canvas instead of the bottom. Badge itself is visible and not overflowing.
- Severity: 3.
- Likely cause: story/harness wiring.
- Screenshot: `/Users/abhirupdas/Codes/Personal/synchronize/docs/audits/storybook-visual-2026-06-20/screenshots/compact-mobile-feat-android--navigation-bottomnav--agents-active-with-badge.png`

### `navigation-bottomnav--tap-agents`

- Expected from source: same compact bottom navigation chrome; play function taps Agents and asserts the handler is called.
- Observed: final controlled visual state still renders `.bottom-nav` at the top of the mobile canvas instead of the bottom.
- Severity: 3.
- Likely cause: story/harness wiring.
- Screenshot: `/Users/abhirupdas/Codes/Personal/synchronize/docs/audits/storybook-visual-2026-06-20/screenshots/compact-mobile-feat-android--navigation-bottomnav--tap-agents.png`

## 4. Deferred/Blocked Stories

- `surfaces-compactsettingssheet--dark-glass`: deferred because it is explicitly glass-skin. No glass-theme finding was filed.

No stories were blocked by tooling. Interaction stories were allowed to reach their stable post-play controlled state in the isolated Playwright context.

## 5. Source/Story Wiring Smells

- `Navigation/BottomNav` stories use `parameters: { layout: "fullscreen" }` but render `<BottomNav>` by itself. Since the component is placed at the bottom by the real compact app-shell grid rather than fixed positioning inside `BottomNav`, the standalone stories misrepresent the component's real location.
- `layouts-chat-surface--android-compact` exposes compact inline-code wrapping pressure that the full shell mostly masks with dark styling but does not eliminate. The issue is internal to bubble content, not screenshot edge clipping or page-level horizontal scroll.
