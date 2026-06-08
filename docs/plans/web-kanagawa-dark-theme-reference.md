# Web Kanagawa Dark Theme Reference Plan

## Goal

Retune the web UI's Kanagawa dark theme against the saved reference screenshots in `reference-screenshots/`, changing one visible unit at a time and validating each unit in the in-app browser against production daemon data.

## Reference Set

The reference screenshots were copied into this worktree under `reference-screenshots/`. The target palette observed from the reference is:

- Base page surface: `#1f1f27`
- Primary raised panels/cards: `#2a2a36` / `#2a2a37`
- Active or self-authored raised panels: `#3a3a46`
- Border/rule accents: `#565566` to `#6b6a70`
- Hard drop shadow: `#05060c`
- Text ink remains Kanagawa-style warm cream, close to `#dcd7ba`

## Slices

### 1. Chat Message Cards

Reference files: `04-reference-chat-bubbles-and-shadows.png`, `18-reference-text-contrast-message-copy.png`.

Retune message bubble surfaces, borders, hard shadows, and web-author/self-authored message colors. Keep the geometric shadow treatment consistent, but theme the shadow color and border contrast for Kanagawa.

### 2. Composer Controls

Reference file: `06-reference-composer-controls.png`.

Match the composer container, toolbar buttons, disabled button treatment, dashed text area divider, keyboard hints, and send button border/shadow contrast.

### 3. Sidebar Rooms And Identity Chrome

Reference files: `02-reference-sidebar-room-list.png`, `08-reference-active-room-treatment.png`, `16-reference-sidebar-dm-section.png`, `19-reference-count-badges-labels.png`, `20-reference-bottom-left-nav-and-theme.png`.

Tune sidebar background, search field, room row active/hover states, count chips, unread badges, identity icon shadows, and bottom user control.

### 4. Room Header And Top Controls

Reference files: `03-reference-header-room-tabs.png`, `07-reference-top-right-controls.png`.

Match the room icon treatment, title contrast, group badge, tab strip, active tab underline, participant chips, pin/search/more controls, and top header separators.

### 5. Timeline Rail And Agent Roster

Reference files: `05-reference-timeline-agent-rail.png`, `17-reference-identity-chips-colors.png`.

Tune rail line contrast, event chips, timestamp opacity, roster section labels, agent card borders, status dots, and grouped identity chips.

### 6. Board View

Reference files: `09-reference-board-overview.png`, `10-reference-board-column-cards.png`, `11-reference-board-status-chrome.png`.

Match board background, column headers, task cards, status strips, assignee chips, progress bars, dashed add-card states, and hover shadows.

### 7. Artifacts View

Reference files: `12-reference-artifacts-overview.png`, `13-reference-artifact-card-detail.png`, `14-reference-artifact-toolbar-and-empty-space.png`.

Tune artifact cards, toolbar controls, empty-space canvas, metadata labels, attachment preview panels, and action buttons.

### 8. Activity View

Reference file: current production Activity page plus the same token set.

Bring the Activity page into the Kanagawa system after the core room surfaces are aligned, preserving its existing information density while matching the card/rule/shadow language.

## Validation Loop

For each slice:

1. Change only the selectors or tokens needed for that unit.
2. Let `web/build.ts --watch` rebuild `web/dist`.
3. Reload the in-app browser at `http://127.0.0.1:58405/web`.
4. Compare against the slice's reference screenshots.
5. Stop for feedback before moving to the next slice.
