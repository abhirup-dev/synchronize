# Navigation Residual Desktop Bucket

Date: 2026-06-20
Source worktree: `/Users/abhirupdas/Codes/Personal/synchronize`
Storybook: private server on `http://127.0.0.1:6012`
Viewport: `1280x720`
Browser: isolated headless Playwright
Scope: brutal-theme desktop navigation residuals only

## Method

Read before judging:

- `web/src/components/AgentRoster.stories.tsx`
- `web/src/components/RoomHeader.stories.tsx`
- `web/src/components/Sidebar.stories.tsx`
- `web/src/components/AgentRoster.tsx`
- `web/src/components/RoomHeader.tsx`
- `web/src/components/Sidebar.tsx`
- `web/src/storybook/StorybookProviders.tsx`

Enumerated Storybook from `/index.json`, then loaded each assigned story through
`/iframe.html?id=<story-id>&viewMode=story`. All assigned stories are static
provider-backed renders, so the judged state is the settled initial render.

## Confirmed Issues

### `navigation-roomheader--group`

Severity: 2
Likely cause: component styling/layout.

Screenshot: [navigation-residual-desktop--navigation-roomheader--group.png](../screenshots/navigation-residual-desktop--navigation-roomheader--group.png)

Expected from source: group header should show `#checkout-revamp`, working
count, member pile, `AGENTS` button with member count, theme/background/skin
toggles, pin/search/more buttons, and the tab row.

Observed: the right-side header controls are usable, but the `AGENTS` button is
too narrow for its own label/count treatment. The label visually crowds into
the count chip. DOM confirmation: `.room-agents-btn` rendered at `58px` wide
while its `scrollWidth` was `67px`, so the control is internally overflowing in
the default group state. This is related to the existing RoomHeader crowding
findings, but this story shows the default group header already has an
over-constrained agents button.

### `navigation-sidebar--activity-dock`

Severity: 5
Likely cause: story/harness wiring.

Screenshot: [navigation-residual-desktop--navigation-sidebar--activity-dock.png](../screenshots/navigation-residual-desktop--navigation-sidebar--activity-dock.png)

Expected from source: the Sidebar should show normal grouped room lists and the
bottom activity dock highlighted because `activeRoomId` is `activity`.

Observed: the standalone Sidebar expands to the full `1280px` preview width and
collapses the group/DM sections into horizontal strips. DOM confirmation:
`.sidebar` was `1280px` wide, `.sidebar-section` had height `0`, and `.list`
had only `8px` visible height while its scroll height was `332px`. The activity
dock state exists, but the story is not usable as a sidebar reference. This is
the same harness failure class as the already-covered
`navigation-sidebar--group-selected` issue, applied to the activity-dock state.

### `navigation-sidebar--dm-selected`

Severity: 5
Likely cause: story/harness wiring.

Screenshot: [navigation-residual-desktop--navigation-sidebar--dm-selected.png](../screenshots/navigation-residual-desktop--navigation-sidebar--dm-selected.png)

Expected from source: the Sidebar should show normal grouped room lists with
the Cortex DM selected, peer status dots, and DM room-name rendering without a
leading `#`.

Observed: the same fullscreen harness failure makes the room lists unreadable:
the component stretches across the viewport and the sections collapse into
thin horizontal bands. DOM metrics matched the activity-dock story: `.sidebar`
was `1280px` wide, `.sidebar-section` height was `0`, and `.list` showed `8px`
of a `332px` scroll area. This confirms the residual DM-selected state is also
misrepresented by the Storybook harness, not by the Sidebar component in the
app shell.

### `navigation-sidebar--typing-mode`

Severity: 5
Likely cause: story/harness wiring.

Screenshot: [navigation-residual-desktop--navigation-sidebar--typing-mode.png](../screenshots/navigation-residual-desktop--navigation-sidebar--typing-mode.png)

Expected from source: the Sidebar should show the normal selected group state,
with the user bubble rendering the lime `INS` vim-mode chip instead of `NAV`.

Observed: the `INS` chip is present, but the same stretched fullscreen Sidebar
harness collapses the list sections into unreadable horizontal strips. DOM
confirmation: `.sidebar` was `1280px` wide, `.sidebar-section` height was `0`,
and `.list` showed `8px` of a `332px` scroll area. This is not a separate
component failure from the already-known Sidebar harness issue; it confirms the
typing-mode variant is also not a valid visual reference until the harness wraps
Sidebar in the fixed-width shell it expects.

## Passed

### `navigation-agentroster--default`

Expected from source: checkout-revamp roster with busy, ready, and idle groups;
no focused-agent banner. The settled render showed those groups and no focused
state. No confirmed residual failure.

### `navigation-agentroster--all-statuses`

Expected from source: heartbeat-checks roster with all four status groups,
including offline `pulse`. The settled render showed WORKING, READY, IDLE, and
OFF sections. No confirmed residual failure.

### `navigation-roomheader--direct-message`

Expected from source: DM header with plain `Cortex` title, two-member pile, no
agents button, and normal top/tabs controls. The settled render matched those
expectations without confirmed internal overflow or overlap.

## Reference-Only Existing Findings

Did not duplicate these already-covered navigation findings:

- `navigation-agentroster--focused-agent`
- `navigation-roomheader--long-title-and-description`
- `navigation-roomheader--with-thread-banner`
- `navigation-sidebar--group-selected`

Deferred/out of scope for this bucket:

- `navigation-roomheader--glass-skin-board-tab`
- `navigation-bottomnav--*`
- `navigation-compactappbar--*`
- `navigation-roomheader--compact`
