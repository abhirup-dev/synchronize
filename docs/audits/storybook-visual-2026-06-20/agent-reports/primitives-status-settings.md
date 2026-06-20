# Primitives / Status / Settings Storybook Audit

Date: 2026-06-20
Scope: brutal-theme desktop only.
Capture method: isolated headless Playwright CLI screenshots against Storybook iframe URLs, using `bunx playwright screenshot --viewport-size=1280,720 --wait-for-timeout=3000 'http://localhost:6006/iframe.html?id=<story-id>&viewMode=story' /tmp/...png`. No Codex in-app browser was used.

Notes:
- Matching story source was inspected before visual judgment. `primitives-identity--*` source exists in `web/src/components/primitives.stories.tsx`; the other requested story modules were served by the running Storybook/Vite server from `/src/components/*.stories.tsx`, with source maps pointing at a sibling `feat-android-app` worktree while those files are absent in this checkout.
- Initial no-wait captures showed only the Storybook loading spinner, so all judgments below use the waited capture pass.
- No stories in the audited desktop set required parent-browser/manual interaction follow-up. `primitives-settingsrow--*` stories were deferred because their story source explicitly targets compact/mobile settings-sheet coverage.

## Confirmed Issues

### `primitives-iconbutton--active`

Severity: 3
Likely cause: component styling/class ordering.

Screenshot: [primitives-status-settings--primitives-iconbutton-active.png](../screenshots/primitives-status-settings--primitives-iconbutton-active.png)

Expected from source: `Active` sets `variant: "solid"` and `active: true`, so it should visually demonstrate an active icon-button state distinct from the plain solid variant.

Observed: the stable render is visually indistinguishable from `primitives-iconbutton--solid`; both show the same paper-colored solid button treatment. The active state therefore fails to demonstrate its intended state.

### `surfaces-placeholder--artifacts`

Severity: 3
Likely cause: story/harness layout around a flex-dependent component.

Screenshot: [primitives-status-settings--surfaces-placeholder-artifacts.png](../screenshots/primitives-status-settings--surfaces-placeholder-artifacts.png)

Expected from source: fullscreen placeholder surface with centered `ARTIFACTS -- coming in V2` stamp.

Observed: the stamp is clipped off the top of the viewport in the stable render. A full-page isolated capture still showed the same top clipping, so this is not just contact-sheet or viewport-edge screenshot cropping. The component CSS uses `.placeholder { flex: 1; display: grid; place-items: center; }`, which appears not to own height in the fullscreen story harness.

## Passed

- `primitives-identity--avatars`
- `primitives-identity--status-dots`
- `primitives-identity--badge`
- `primitives-iconbutton--ghost`
- `primitives-iconbutton--solid`
- `primitives-iconbutton--accent`
- `primitives-iconbutton--disabled`
- `primitives-iconbutton--clicks`
- `primitives-iconbutton--disabled-is-inert`
- `surfaces-connectionerror--network-error`
- `surfaces-connectionerror--unauthorized`

## Deferred

- `primitives-settingsrow--default`
- `primitives-settingsrow--appearance`
- `primitives-settingsrow--taps`

Reason: story source describes the row as compact settings-sheet UI and sets `globals.viewport.value = "mobileNarrow"`. Per the clarified scope, compact/mobile/responsive-only states are deferred from this brutal-theme desktop pass.
