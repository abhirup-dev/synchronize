# Layouts Desktop / Tablet Storybook Visual Audit

Date: 2026-06-20
Scope: brutal-theme desktop/tablet residual pass for `Layouts/Chat Surface`.

## Capture Method

- Source inspection: read `web/src/components/Layouts.stories.tsx` and the relevant `ChatView` layout source before judging.
- Story index check: `http://127.0.0.1:6011/index.json`.
- Server: private Storybook from `web/` on `127.0.0.1:6011`.
- Browser: isolated headless Playwright Chromium, no Codex in-app browser.
- Viewports:
  - `layouts-chat-surface--desktop`: `1440x900`
  - `layouts-chat-surface--tablet`: `768x1024`
  - `layouts-chat-surface--medium-shell`: spot-checked only; deferred from confirmed scope.

## Story Presence

- Present: `layouts-chat-surface--desktop`
- Present: `layouts-chat-surface--tablet`
- Present but deferred: `layouts-chat-surface--medium-shell`
- Absent from `index.json`: `layouts-app-shell--desktop`

## Confirmed Issues

### `layouts-chat-surface--desktop`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [layouts-desktop-tablet--layouts-chat-surface--desktop.png](../screenshots/layouts-desktop-tablet--layouts-chat-surface--desktop.png)

Expected from source: the story says it is the real chat surface pinned to the desktop viewport preset. `ChatView` lays out the chat region above the composer, so a layout reference should show the stable surface with the composer available in the viewport.

Observed: the stable desktop render grows to content height instead of the viewport. DOM inspection measured `.chat-view` at `1440x1192` in a `1440x900` viewport, with `.composer` starting at `y=969`, fully below the visible desktop capture. The story therefore does not demonstrate the full chat surface layout.

Notes: this is not filed as production component code. `ChatView` uses `h-full`/flex layout and expects a height-constrained parent; this Storybook harness renders the component directly under Storybook's root instead of an app-shell-height wrapper.

### `layouts-chat-surface--tablet`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [layouts-desktop-tablet--layouts-chat-surface--tablet.png](../screenshots/layouts-desktop-tablet--layouts-chat-surface--tablet.png)

Expected from source: the tablet story should show the same real chat surface pinned to the tablet viewport preset.

Observed: the stable tablet render has the same unconstrained-height problem. DOM inspection measured `.chat-view` at `768x1190` in a `768x1024` viewport; only the top strip of the composer is visible at the bottom, with the input/footer/send controls below the viewport. The story fails to present the complete tablet chat-surface layout.

Notes: the small right-edge timeline clipping seen in the tablet capture was not filed separately because the audit scope says to ignore screenshot edge clipping unless internally broken.

## Passed Stories

No assigned present story passed without issue.

## Deferred / Follow-Up

- `layouts-chat-surface--medium-shell`: deferred per bucket instructions. A spot-check showed the same height-constraining symptom, so a medium-shell pass should verify whether to file it under the medium/responsive bucket.
- `layouts-app-shell--desktop`: skipped because it is not present in the current Storybook index.
