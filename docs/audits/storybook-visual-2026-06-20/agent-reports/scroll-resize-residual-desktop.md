# ScrollControls / ResizeHandle Residual Desktop Audit

Date: 2026-06-20
Scope: brutal-theme desktop residual pass, viewport 1280x720.

## Capture Method

Used a private Storybook server from `/Users/abhirupdas/Codes/Personal/synchronize/web`:

```bash
bun run storybook -- --host 127.0.0.1 --port 6013
```

All captures and DOM checks used isolated headless Playwright against
`http://127.0.0.1:6013/iframe.html?id=<story-id>&viewMode=story`. The Codex
in-app browser was not used. Source was inspected before judging each story.

## Confirmed Failures

### `primitives-resizehandle--at-max-width`

Severity: 4
Likely cause: story/harness styling.

Screenshot: [scroll-resize-residual-desktop--primitives-resizehandle--at-max-width.png](../screenshots/scroll-resize-residual-desktop--primitives-resizehandle--at-max-width.png)

Expected from source: two-pane resize harness with the right thread pane parked
at the maximum clamp, `820px`, while retaining readable pane labels and width
metadata.

Observed: the story renders dark text on a dark harness background. DOM
inspection found the pane text using `rgb(17, 17, 17)` over a root background of
`rgb(14, 14, 16)`, making the harness content nearly unreadable. This is the
same defect already represented by `primitives-resizehandle--default`, not a
new component behavior failure.

### `primitives-resizehandle--at-min-width`

Severity: 4
Likely cause: story/harness styling.

Screenshot: [scroll-resize-residual-desktop--primitives-resizehandle--at-min-width.png](../screenshots/scroll-resize-residual-desktop--primitives-resizehandle--at-min-width.png)

Expected from source: two-pane resize harness with the right thread pane parked
at the minimum clamp, `320px`, while retaining readable pane labels and width
metadata.

Observed: the same dark-on-dark harness text failure appears here. The separator
is present and correctly positioned for the `320px` pane, but the story content
is nearly unreadable because the light-theme `--ink` value is used on the dark
harness background.

### `primitives-resizehandle--narrow-clamp`

Severity: 4
Likely cause: story/harness styling.

Screenshot: [scroll-resize-residual-desktop--primitives-resizehandle--narrow-clamp.png](../screenshots/scroll-resize-residual-desktop--primitives-resizehandle--narrow-clamp.png)

Expected from source: two-pane resize harness exercising the custom clamp range
`240-400`, initially at `300px`, with readable labels and width metadata.

Observed: the same dark-on-dark harness text failure appears here. The separator
is present and the narrow clamp state is represented, but the text is nearly
unreadable for the same harness-token reason as the other ResizeHandle variants.

## Passed

### `surfaces-scrollcontrols--hidden`

Expected from source: resting scrollable surface with no control rendered.
Observed: no visible button and no separator/control node in the stable render.

### `surfaces-scrollcontrols--new-items-below`

Expected from source: fresh content below while scrolled away from bottom,
showing the lime `scroll to bottom` down pill.
Observed: one visible `scroll to bottom` button with the down arrow, centered
near the bottom of the scroll surface.

### `surfaces-scrollcontrols--jump-to-bottom`

Expected from source: the play function clicks the `scroll to bottom` pill, then
the control retires once the surface reaches the bottom.
Observed: final stable state is scrolled to the bottom with no visible
`scroll to bottom` button.

## Already Covered

- `surfaces-scrollcontrols--scrolling-down` remains covered by the existing
  confirmed issue in `NOTES.md`.
- `primitives-resizehandle--default` remains the representative existing
  screenshot for the ResizeHandle harness styling issue. The residual variants
  above confirm the same issue across the remaining states.

## Saved Failure Screenshots

- `screenshots/scroll-resize-residual-desktop--primitives-resizehandle--at-max-width.png`
- `screenshots/scroll-resize-residual-desktop--primitives-resizehandle--at-min-width.png`
- `screenshots/scroll-resize-residual-desktop--primitives-resizehandle--narrow-clamp.png`
