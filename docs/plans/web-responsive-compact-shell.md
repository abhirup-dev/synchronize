# Web Responsive Compact Shell Plan

Status: implementation plan (2026-06-05)
Owner: abhirup

## Goal

Make the web UI adapt from the current three-column desktop shell into a
chat-focused compact experience without losing the existing desktop behavior.
The first collapse should remove the permanent agent roster. The second collapse
should remove the permanent room sidebar and let the chat occupy the full
viewport.

The compact result should feel closer to a WhatsApp-style chat surface, but with
Synchronize-specific controls for room/community navigation, agent roster access,
threads, and command-rich composition.

## Product Behavior

### Desktop

Desktop keeps the current mental model:

```text
[ room sidebar ][ chat + composer ][ agent roster ]
```

- The room sidebar stays visible.
- The agent roster stays visible.
- The timeline rail may stay beside the chat when there is room.
- The composer keeps its full toolbar, thread summary button, keyboard hints,
  and send button.

### Medium Width

When horizontal space gets tight, the agent roster collapses before the room
sidebar:

```text
[ room sidebar ][ chat + composer ]
```

- The room sidebar remains visible so long group names can still be scanned.
- The agent roster becomes an agents button in the room header.
- Clicking the agents button opens an animated roster panel.
- The panel should preserve the roster's existing content and interaction model.
- The timeline rail should collapse before it creates narrow message bubbles.

For medium widths, the roster panel should slide from the right because that is
where the roster lives on desktop.

### Compact Mobile Width

At the narrowest breakpoint, the app becomes chat-first:

```text
[ chat + composer ]
```

- The left room sidebar fully collapses.
- The top-level search field becomes a search icon/action.
- The room header remains visible, with a truncated room title and compact
  actions.
- The chat and composer should mostly preserve their existing internal layout.
- The composer footer gains a `Community` button as the leftmost footer action,
  immediately before `Threads`.

The compact composer footer should roughly read:

```text
[COMMUNITY] [THREADS]                         [SEND]
```

Clicking `Community` opens the room/community navigator. Clicking the agents
button opens the roster. In compact mode, both panels take over the full screen
from left to right with a smooth transform animation.

### Community Takeover

The community takeover is the compact replacement for the room sidebar:

```text
[ Communities                         x ]
[ search rooms...                        ]
[ GROUPS                                 ]
[ #discussion-round-table                ]
[ #pi-isolation                          ]
[ DMS                                    ]
[ prod-designer                          ]
```

- It should show the same group and DM sections as the sidebar.
- Selecting a room should switch rooms and close the takeover.
- Search should be available inside the takeover.
- The takeover should close on Escape and restore focus to the opener.

### Agent Takeover

The compact agent takeover is the replacement for the permanent roster:

```text
[ Agents                              x ]
[ READY                                 ]
[ Y You                                 ]
```

- It should show the same roster groupings and cards as the desktop roster.
- Agent focus and double-click jump behavior should continue to work.
- In compact mode, selecting or focusing an agent may close the takeover only
  when the action returns the user to chat.
- The takeover should close on Escape and restore focus to the opener.

## Frontend Design

### Responsive Shell State

Add a small viewport classification layer in the web shell:

- `desktop`: sidebar and roster visible.
- `medium`: sidebar visible, roster hidden behind a panel.
- `compact`: chat-only, sidebar and roster both hidden behind full-screen
  takeovers.

The exact breakpoints should be tuned against screenshots, but an initial shape
is:

- `desktop`: `>= 1180px`
- `medium`: `780px` through `1179px`
- `compact`: `< 780px`

Prefer CSS media queries for pure layout changes and React state only for
interactive overlay open/close state.

### Sidebar Reuse

Keep `Sidebar` as the canonical room/community list component. Add props or a
wrapper so the same list can render in:

- the persistent desktop/medium sidebar, and
- the compact full-screen community takeover.

This avoids duplicating room filtering, counts, active state, context menus, and
spawn-agent behavior.

### Agent Roster Reuse

Keep `AgentRoster` as the canonical roster component. Add wrapper classes or
props so the same roster can render in:

- the persistent desktop right column,
- the medium right-side slide-in panel, and
- the compact full-screen takeover.

### Header

Update `RoomHeader` so compact modes have stable, non-overlapping controls:

- The room title uses `min-width: 0`, single-line truncation, and no collision
  with action buttons.
- The member pile is hidden or reduced when it competes with the title.
- The `GROUP` sticker moves into metadata or hides when space is tight.
- Header actions collapse to icon buttons, including the agents opener.
- The room activity sparkline collapses to an activity button or hides before
  it squeezes tabs.

### Composer

Add an optional `onOpenCommunity` prop to `Composer`. When present in compact
mode, render a `Community` button as the leftmost footer action.

Compact composer behavior:

- Keep the textarea and command toolbar.
- Let toolbar actions wrap or horizontally scroll before they overlap.
- Hide keyboard-hint prose when it competes with `Community`, `Threads`, and
  `Send`.
- Keep `Send` stable and easy to reach.

### Accessibility And Motion

- Use transform-based animations (`translateX`) rather than animating width.
- Respect `prefers-reduced-motion`.
- Overlays should have modal semantics, close buttons, Escape behavior, and
  focus restoration.
- Avoid hidden sidebars receiving tab focus when collapsed.

## Implementation Plan

### Epic: Build responsive compact web shell

Goal: implement the staged responsive shell and validate it at desktop, medium,
tablet, and mobile widths.

Affected areas:

- `web/src/App.tsx`
- `web/src/components/Sidebar.tsx`
- `web/src/components/AgentRoster.tsx`
- `web/src/components/RoomHeader.tsx`
- `web/src/components/Composer.tsx`
- `web/src/components/ChatView.tsx`
- `web/src/styles.css`
- `web/src/components/extra.css`
- Browser verification flow for `/web`

Verification:

- Desktop keeps the existing three-column layout.
- Medium width hides the permanent roster and opens it from the header.
- Compact width hides the room sidebar and opens it from the composer
  `Community` button.
- Compact agent roster opens as a full-screen takeover.
- Long group names do not collide with header actions.
- Message bubbles and the composer do not become unusably narrow.
- No horizontal overflow at tested widths.

Create these child issues under the epic:

1. **Add responsive shell breakpoint state**
   - Description: Establish the desktop/medium/compact shell modes and the
     overlay state needed to open/close community and agent panels.
   - Impact area: `App.tsx`, shell CSS, focus restoration helpers.
   - Acceptance criteria: CSS and shell state can distinguish desktop, medium,
     and compact modes; collapsed panels are not focusable when closed.
   - How to verify: inspect DOM/classes at target widths and run web
     typecheck.
   - Test plan: web TypeScript check plus browser screenshots.
   - Dependencies: none.
   - Labels: area/frontend, risk/med.

2. **Refactor sidebar into reusable community panel**
   - Description: Make the room/sidebar content reusable in both the persistent
     sidebar and compact full-screen community takeover.
   - Impact area: `Sidebar.tsx`, room filtering/search UI, spawn dialog
     placement, sidebar CSS.
   - Acceptance criteria: persistent sidebar behavior is unchanged on desktop;
     compact community takeover shows groups, DMs, search, counts, active room,
     and closes after room selection.
   - How to verify: switch rooms from desktop sidebar and compact community
     takeover.
   - Test plan: web typecheck and manual/browser interaction test.
   - Dependencies: responsive shell breakpoint state.
   - Labels: area/frontend, risk/med.

3. **Move agent roster into responsive panels**
   - Description: Hide the permanent roster at medium widths, add an agents
     opener in the header, and render roster content inside medium and compact
     panels.
   - Impact area: `AgentRoster.tsx`, `RoomHeader.tsx`, `App.tsx`, roster CSS.
   - Acceptance criteria: desktop roster remains visible; medium roster opens
     from the right; compact roster takes over the screen; focus/jump behavior
     still works.
   - How to verify: open/close roster at medium and compact widths and
     double-click/focus an agent.
   - Test plan: web typecheck and browser interaction test.
   - Dependencies: responsive shell breakpoint state.
   - Labels: area/frontend, risk/med.

4. **Compact header, tabs, timeline, and composer**
   - Description: Tune the room header, tabs, timeline rail, and composer footer
     so compact layouts avoid collisions and preserve chat readability.
   - Impact area: `RoomHeader.tsx`, `Composer.tsx`, `ChatView.tsx`, timeline and
     composer CSS.
   - Acceptance criteria: long room titles truncate cleanly; actions do not
     overlap; timeline collapses before it narrows messages; composer shows
     `Community`, `Threads`, and `Send` without crowding.
   - How to verify: browser screenshots at desktop, medium, tablet, and mobile
     widths with long room names.
   - Test plan: web typecheck, web build, screenshot review.
   - Dependencies: sidebar community panel and roster panels.
   - Labels: area/frontend, risk/high.

5. **Verify responsive web shell end to end**
   - Description: Run the final quality pass for responsive behavior and capture
     any follow-up issues.
   - Impact area: local dev server/browser verification, web build pipeline,
     follow-up Beads.
   - Acceptance criteria: no horizontal overflow; screenshots cover `1440`,
     `1024`, `768`, and `390` widths; web typecheck/build pass; remaining work
     is filed as Beads issues.
   - How to verify: use the in-app browser or browser automation against `/web`
     and inspect screenshots.
   - Test plan: `cd web && bun run typecheck`, `cd web && bun run build`, and
     browser screenshot verification.
   - Dependencies: compact header/tabs/timeline/composer.
   - Labels: area/frontend, risk/low.

Parallelism: after the responsive shell state lands, the community panel and
agent panel work can proceed in parallel. The compact header/composer pass should
wait until both panel surfaces exist because it wires the visible controls.

## Tests

- `cd web && bun run typecheck`
- `cd web && bun run build`
- Browser screenshots at `1440`, `1024`, `768`, and `390` widths.
- Browser interaction checks:
  - open and close agents panel,
  - open and close community panel,
  - switch rooms from the community panel,
  - verify Escape closes overlays,
  - verify no horizontal overflow.

## Out Of Scope

- Replacing the web visual design language.
- Implementing a native mobile app.
- Changing daemon state, room membership semantics, or message delivery.
- Redesigning board/artifact views beyond preventing obvious overflow.
- Adding a global command palette.

## Beads

Created from this plan:

- `sync-ogbk` — epic: build responsive compact web shell.
- `sync-ogbk.1` — frontend: responsive shell breakpoint state.
- `sync-ogbk.2` — frontend: reusable community panel.
- `sync-ogbk.3` — frontend: responsive agent roster panels.
- `sync-ogbk.4` — frontend: compact header/tabs/timeline/composer.
- `sync-ogbk.5` — frontend: responsive verification pass.
