# Storybook Visual Audit - Desktop Pass

Date: 2026-06-20
Target: `http://localhost:6006`
Scope: brutal-theme desktop Storybook pass. Compact/mobile coverage is separate
and is the priority after this pass. Medium mode is optional and can be skipped
if needed. Glass-theme stories are deferred from this desktop-brutal issue list.

## Confirmed Issues

### `navigation-agentroster--focused-agent`

Severity: 4
Likely cause: component styling/layout.

Screenshot: [navigation-agentroster--focused-agent.png](./screenshots/navigation-agentroster--focused-agent.png)

The focused roster row renders as a full-width black band and the secondary text
inside it is too low-contrast to read. The row looks like it escaped the roster
column instead of staying within the component width.

### `messages-messagerow--rich-with-reactions`

Severity: 3
Likely cause: component render/state or story fixture mismatch.

Screenshot: [messages-messagerow--rich-with-reactions.png](./screenshots/messages-messagerow--rich-with-reactions.png)
Additional isolated-worker reference: [composer-messages-desktop--messages-messagerow--rich-with-reactions.png](./screenshots/composer-messages-desktop--messages-messagerow--rich-with-reactions.png)

The story source says this message carries reactions and a thread reply count,
but the rendered stable state has no reaction footer or reaction buttons. DOM
inspection also found no reaction buttons in the preview.

### `primitives-resizehandle--default`

Severity: 4
Likely cause: story harness styling.

Screenshot: [primitives-resizehandle--default.png](./screenshots/primitives-resizehandle--default.png)

The ResizeHandle harness renders nearly unreadable dark text on a dark pane. The
same problem appears across the checked ResizeHandle variants, so this
screenshot is the representative reference.

### `navigation-roomheader--long-title-and-description`

Severity: 3
Likely cause: component responsive/header control layout.

Screenshot: [navigation-roomheader--long-title-and-description.png](./screenshots/navigation-roomheader--long-title-and-description.png)

The long-title clamp works for the title itself, but the right-side
agents/member area is cramped and overlaps visually near the edge. The agents
text/control treatment looks shoddy rather than intentionally constrained.

### `navigation-roomheader--with-thread-banner`

Severity: 3
Likely cause: component responsive/header control layout.

Screenshot: [navigation-roomheader--with-thread-banner.png](./screenshots/navigation-roomheader--with-thread-banner.png)

The right-side agents/member area has the same crowding issue, and the thread
banner content is squeezed against the far-right side.

### `surfaces-scrollcontrols--scrolling-down`

Severity: 3
Likely cause: component state logic or story harness not triggering the visible
scroll-control condition.

Screenshot: [surfaces-scrollcontrols--scrolling-down.png](./screenshots/surfaces-scrollcontrols--scrolling-down.png)

The story source says `.is-scrolling` is held on so the directional down/jump
pill stays visible for inspection. The stable render shows only the scrollable
text surface, and DOM inspection found no visible scroll-control button.

### `navigation-sidebar--group-selected`

Severity: 5
Likely cause: story harness wiring.

Screenshot: [navigation-sidebar--group-selected.png](./screenshots/navigation-sidebar--group-selected.png)

The Sidebar story uses fullscreen layout and renders `Sidebar` without the
fixed-width parent shell it expects in `App.tsx`. The preview stretches
horizontally, causing the search bar and room list sections to collapse into
unreadable horizontal strips. The component may still be correct inside the real
app shell, but the Storybook preview is broken as a component reference.

### `activity-activityview--wide-thread-pane`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [activity-chat-desktop--activity-activityview--wide-thread-pane.png](./screenshots/activity-chat-desktop--activity-activityview--wide-thread-pane.png)

Expected from source: the story should show the ActivityView feed with a wider
thread side-panel preference. The stable render is visually identical to
`activity-activityview--grouped`; DOM inspection found no `.thread-pane`. The
story does not demonstrate the intended wide thread-pane state.

### `surfaces-chatview--thread-open`

Severity: 3
Likely cause: component state or story/provider wiring.

Screenshot: [activity-chat-desktop--surfaces-chatview--thread-open.png](./screenshots/activity-chat-desktop--surfaces-chatview--thread-open.png)

Expected from source: thread-open mode should collapse the timeline rail and
render the composer in its collapsed-default state. The timeline rail is absent
as expected, but the composer renders expanded with toolbar, textarea, footer
hints, and send button.

### `surfaces-contextmenu--message-actions`

Severity: 2
Likely cause: story play/harness wiring.

Screenshot: [composer-messages-desktop--surfaces-contextmenu--message-actions.png](./screenshots/composer-messages-desktop--surfaces-contextmenu--message-actions.png)

The play function should right-click the target and leave the message action
menu open beside it. The final stable state opens the menu at the viewport
origin instead, partially covering the target from the top-left corner. Other
context-menu stories anchored correctly under isolated manual right-clicks.

### `primitives-iconbutton--active`

Severity: 3
Likely cause: component styling/class ordering.

Screenshot: [primitives-status-settings--primitives-iconbutton-active.png](./screenshots/primitives-status-settings--primitives-iconbutton-active.png)

The story sets `variant: "solid"` and `active: true`, but the active render is
visually indistinguishable from the plain solid variant. The story fails to
demonstrate an active icon-button state.

### `surfaces-placeholder--artifacts`

Severity: 3
Likely cause: story/harness layout around a flex-dependent component.

Screenshot: [primitives-status-settings--surfaces-placeholder-artifacts.png](./screenshots/primitives-status-settings--surfaces-placeholder-artifacts.png)

The fullscreen placeholder should center the `ARTIFACTS -- coming in V2` stamp.
The stable render clips the stamp off the top of the viewport, and a full-page
isolated capture showed the same clipping, so this is not just screenshot edge
cropping.

### `surfaces-threadsummarypanel--empty`

Severity: 3
Likely cause: story fixture/source mismatch.

Screenshot: [thread-timeline-toast--threadsummarypanel-empty.png](./screenshots/thread-timeline-toast--threadsummarypanel-empty.png)

The story source says `ml-ranking` should exercise the empty no-threads state.
The stable render instead shows a real Pulse thread summary with `14 replies`,
participant badge, and last-reply metadata because the current seed fixture
includes `ml-deepdive` with `threadReplyCount: 14`.

### `flows-activity-to-thread--open-thread-from-activity`

Severity: 3
Likely cause: story/play wiring.

Screenshot: [flows-desktop--flows-activity-to-thread--open-thread-from-activity.png](./screenshots/flows-desktop--flows-activity-to-thread--open-thread-from-activity.png)

Expected from source: the activity-to-thread play helper opens the thread and
scrolls to the bottom so the latest reply is visible. The stable render stops
around replies 8-12; the final reply exists in the DOM but is below the visible
thread pane. A forced scroll to the actual max made the final reply appear,
which points to the story helper scrolling before the virtualized pane has fully
measured.

### `flows-activity-to-thread--open-thread-from-activity-demo`

Severity: 3
Likely cause: story/play wiring.

Screenshot: [flows-desktop--flows-activity-to-thread--open-thread-from-activity-demo.png](./screenshots/flows-desktop--flows-activity-to-thread--open-thread-from-activity-demo.png)

Same failure as the non-demo flow. After extended settling, the thread pane
remains short of the actual bottom and shows replies 8-12 instead of the final
checklist-cleared reply.

### `layouts-chat-surface--desktop`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [layouts-desktop-tablet--layouts-chat-surface--desktop.png](./screenshots/layouts-desktop-tablet--layouts-chat-surface--desktop.png)

The story should show the real chat surface pinned to the desktop viewport
preset with the composer available in the viewport. The stable render grows to
content height instead of the viewport; `.chat-view` measured taller than the
`1440x900` viewport, placing the composer fully below the visible capture.

### `layouts-chat-surface--tablet`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [layouts-desktop-tablet--layouts-chat-surface--tablet.png](./screenshots/layouts-desktop-tablet--layouts-chat-surface--tablet.png)

The tablet story has the same unconstrained-height harness issue. Only the top
strip of the composer is visible at the bottom while the input/footer/send
controls are below the `768x1024` viewport.

### `navigation-roomheader--group`

Severity: 2
Likely cause: component styling/layout.

Screenshot: [navigation-residual-desktop--navigation-roomheader--group.png](./screenshots/navigation-residual-desktop--navigation-roomheader--group.png)

The default group header is usable, but the `AGENTS` button is too narrow for
its own label/count treatment. The label crowds into the count chip; DOM
inspection measured the button narrower than its scroll width.

### `navigation-sidebar--activity-dock`

Severity: 5
Likely cause: story/harness wiring.

Screenshot: [navigation-residual-desktop--navigation-sidebar--activity-dock.png](./screenshots/navigation-residual-desktop--navigation-sidebar--activity-dock.png)

Same Sidebar fullscreen harness failure as `navigation-sidebar--group-selected`.
The story stretches the Sidebar across the full preview width and collapses the
room sections into unreadable horizontal strips, so it is not usable as a
sidebar reference.

### `navigation-sidebar--dm-selected`

Severity: 5
Likely cause: story/harness wiring.

Screenshot: [navigation-residual-desktop--navigation-sidebar--dm-selected.png](./screenshots/navigation-residual-desktop--navigation-sidebar--dm-selected.png)

Same Sidebar fullscreen harness failure. The DM-selected state is present, but
the list sections collapse into unreadable bands because the story does not
wrap Sidebar in the fixed-width shell it expects.

### `navigation-sidebar--typing-mode`

Severity: 5
Likely cause: story/harness wiring.

Screenshot: [navigation-residual-desktop--navigation-sidebar--typing-mode.png](./screenshots/navigation-residual-desktop--navigation-sidebar--typing-mode.png)

Same Sidebar fullscreen harness failure. The `INS` chip is present, but the
story is visually unusable because the Sidebar sections collapse in the
full-width preview.

### `primitives-resizehandle--at-max-width`

Severity: 4
Likely cause: story/harness styling.

Screenshot: [scroll-resize-residual-desktop--primitives-resizehandle--at-max-width.png](./screenshots/scroll-resize-residual-desktop--primitives-resizehandle--at-max-width.png)

Same ResizeHandle dark-on-dark harness styling failure as the default story.
The max-width state is represented, but pane labels and width metadata are
nearly unreadable.

### `primitives-resizehandle--at-min-width`

Severity: 4
Likely cause: story/harness styling.

Screenshot: [scroll-resize-residual-desktop--primitives-resizehandle--at-min-width.png](./screenshots/scroll-resize-residual-desktop--primitives-resizehandle--at-min-width.png)

Same ResizeHandle dark-on-dark harness styling failure. The separator and
minimum-width state are present, but the harness content is nearly unreadable.

### `primitives-resizehandle--narrow-clamp`

Severity: 4
Likely cause: story/harness styling.

Screenshot: [scroll-resize-residual-desktop--primitives-resizehandle--narrow-clamp.png](./screenshots/scroll-resize-residual-desktop--primitives-resizehandle--narrow-clamp.png)

Same ResizeHandle dark-on-dark harness styling failure. The narrow clamp state
is represented, but text contrast makes the story a poor reference.

## Deferred For Compact/Responsive Pass

### Medium stories

Do not judge `layouts-app-shell--medium` or other explicitly medium responsive
stories in the desktop pass. Medium can be skipped if time is tight.

## Confirmed Compact/Mobile Brutal Issues

Source worktree: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-android-app`
Report: [agent-reports/compact-mobile-feat-android.md](./agent-reports/compact-mobile-feat-android.md)

### `layouts-chat-surface--android-compact`

Severity: 3
Likely cause: component code, probably compact message/markdown inline-code
wrapping inside `ChatView` or message bubble styling.

Screenshot: [compact-mobile-feat-android--layouts-chat-surface--android-compact.png](./screenshots/compact-mobile-feat-android--layouts-chat-surface--android-compact.png)

Expected from source: Android-class widths should show no horizontal overflow.
Observed: inline code chips inside message bubbles overflow the bubble width at
`390x844`, visually intruding toward the timeline rail. A `412x915` spot-check
still showed the long inline code extending past the bubble right edge.

### `navigation-bottomnav--chats-active`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [compact-mobile-feat-android--navigation-bottomnav--chats-active.png](./screenshots/compact-mobile-feat-android--navigation-bottomnav--chats-active.png)

The standalone BottomNav story renders `.bottom-nav` at the top of the mobile
canvas instead of the bottom. The full compact shell places the same component
correctly at the bottom, so the component is likely being misrepresented by the
Storybook harness.

### `navigation-bottomnav--activity-active`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [compact-mobile-feat-android--navigation-bottomnav--activity-active.png](./screenshots/compact-mobile-feat-android--navigation-bottomnav--activity-active.png)

Same BottomNav standalone harness issue: the Activity-active state renders at
the top of the mobile canvas instead of the bottom.

### `navigation-bottomnav--agents-active-with-badge`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [compact-mobile-feat-android--navigation-bottomnav--agents-active-with-badge.png](./screenshots/compact-mobile-feat-android--navigation-bottomnav--agents-active-with-badge.png)

Same BottomNav standalone harness issue: the Agents-active state renders at the
top of the mobile canvas instead of the bottom. The badge itself remains visible
and does not overflow.

### `navigation-bottomnav--tap-agents`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [compact-mobile-feat-android--navigation-bottomnav--tap-agents.png](./screenshots/compact-mobile-feat-android--navigation-bottomnav--tap-agents.png)

Same BottomNav standalone harness issue after the play interaction reaches its
stable state: the nav remains at the top of the mobile canvas instead of the
bottom.

## Deferred For Glass Theme Pass

### `navigation-roomheader--glass-skin-board-tab`

Severity if audited in glass pass: 3
Likely cause: story/provider wiring or missing skin propagation.

Screenshot: [navigation-roomheader--glass-skin-board-tab.png](./screenshots/navigation-roomheader--glass-skin-board-tab.png)

The story is intended to preview `skin: "glass"` with the board tab selected,
but the rendered output still reads as the brutal skin: cream background, heavy
outlines, and brutal tab treatment. This is intentionally not counted in the
current brutal-theme desktop confirmed list.

## Passed Buckets

- Dialogs desktop bucket: [agent-reports/dialogs-desktop.md](./agent-reports/dialogs-desktop.md)
  found no confirmed failures after settled isolated captures.
- AgentColorPicker desktop bucket: [agent-reports/agent-color-picker-desktop.md](./agent-reports/agent-color-picker-desktop.md)
  found no confirmed failures across all four assigned stories.
- ScrollControls residual stories `hidden`, `new-items-below`, and
  `jump-to-bottom` passed in [agent-reports/scroll-resize-residual-desktop.md](./agent-reports/scroll-resize-residual-desktop.md).
