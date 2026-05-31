# Session handoff — Web chat UI: vim nav, agent colors, toasts, UX polish

**Date:** 2026-05-22
**Branch:** `feat/web-chat-ui` (worktree at `~/Codes/Personal/synchronize-worktrees/feat-web-chat-ui`)
**Status:** all work committed and pushed to `origin/feat/web-chat-ui`. Working tree clean.

---

## 1. Session overview

This session continued the V0 build of the **synchronize web chat UI** — a React 19 + TypeScript single-page app served by the existing Bun daemon under `/web/`. The session started with a white-screen bug (relative asset paths broke when `/web` was hit without a trailing slash) and ended after a major round of UX polish, three new power-user features (vim navigation, agent colour customisation, toasts), and a dark-mode legibility refresh grounded in web research.

The visual reference throughout was `docs/ui-reference/claude-design-screenshots/` (Claude Design prototype frames). The data layer is mock-first (`MockDataSource`) — every component was exercised against in-memory seed data; the live `DaemonDataSource` is still a stub.

Iteration loop used: edit code → `bun run web/build.ts` → reload in **Claude Preview** in-app browser → screenshot → diff against design refs.

---

## 2. Repo state

### Commits added this session (in order, all on `feat/web-chat-ui`)

| SHA | Message |
|---|---|
| `ed6e9de` | `feat(web): scaffold neo-brutalist chat UI + daemon /web serving` — 30+ files: daemon /web route, full chat UI scaffold |
| `494de5f` | `chore(beads): track shadcn evaluation epic (sync-99s)` — epic + 6 children |
| `b5673c3` | `chore: add Claude Preview launch config for the web bundle` — `.claude/launch.json` so preview can spin up the daemon on port 47823 with `SYNCHRONIZE_HOME=/tmp/synchronize-preview` |
| `3513714` | `feat(web): vim navigation, agent color overrides, toasts, UX polish` — 19 files, 1175+ / 90− |

### Key file map

```
web/
├── build.ts                            # Bun.build pipeline, rewrites HTML to absolute /web/ paths
├── DESIGN.md                           # Tokens + components contract — the source of truth
├── index.html                          # Has __JS_BUNDLE__ / __CSS_BUNDLE__ placeholders
├── package.json                        # +react-hotkeys-hook 5.3.2
├── src/
│   ├── App.tsx                         # Shell, vim hook, jumpToAgentLast, ToastProvider tree
│   ├── main.tsx                        # Entry — imports styles.css then extra.css
│   ├── styles.css                      # ~2,500 lines — full prototype tokens + light/dark themes
│   ├── components/
│   │   ├── extra.css                   # ~1,000 lines — component-scoped CSS (composer, threads, polls, vim ring, toasts, picker, etc.)
│   │   ├── AgentColorPicker.tsx        # (NEW) 12-swatch popover + native color input
│   │   ├── AgentRoster.tsx             # right rail; declutter + color-picker + double-click→jump
│   │   ├── ChatView.tsx                # chat-region wrapper (timeline ends at composer top)
│   │   ├── Composer.tsx                # textarea + collapse + mention popup (Radix follow-up)
│   │   ├── ContextMenu.tsx             # homegrown — Radix follow-up tracked in beads
│   │   ├── Markdown.tsx                # react-markdown + sanitize + custom code override for mentions
│   │   ├── MessageRow.tsx              # bubble, author pill, mentions, thread badge, poll, hideAvatar prop
│   │   ├── PollWidget.tsx              # POLL pill + option fills + voter avatars + countdown
│   │   ├── primitives.tsx              # Avatar, MentionChip, Sticker, StatusDot, CountChip, inkFor()
│   │   ├── ResizeHandle.tsx            # (NEW) draggable 6 px col between chat + thread
│   │   ├── RoomHeader.tsx              # title, tabs, member pile, room activity
│   │   ├── ScrollControls.tsx          # direction-aware ↑/↓ tied to .is-scrolling
│   │   ├── Sidebar.tsx                 # dual-scrollers, user-bubble at bottom with mode chip
│   │   ├── ThreadPane.tsx              # right-side pane, hideAvatar messages, own composer
│   │   ├── TimelineRail.tsx            # vertical event rail w/ portal tooltip
│   │   └── Toast.tsx                   # (NEW) pill notifications, top-center of .main
│   ├── data/
│   │   ├── context.tsx                 # +useSetAgentColor hook
│   │   ├── daemon.ts                   # +setAgentColor stub (live impl TBD)
│   │   ├── mock.ts                     # +color override persistence in localStorage
│   │   ├── seed.ts                     # +heartbeat poll + thread reply seeds
│   │   ├── store.ts                    # tiny snapshot store
│   │   └── types.ts                    # +Poll + setAgentColor on DataSource
│   └── hooks/
│       ├── useAutoScrollbar.ts         # adds .is-scrolling class during scroll
│       └── useVimNav.ts                # (NEW) modal keymap + focus model
```

### How to bring this up again

```bash
cd ~/Codes/Personal/synchronize-worktrees/feat-web-chat-ui

# Build the bundle
cd web && bun install && bun run build.ts && cd ..

# Daemon already runs on port 47823 via Claude Preview's .claude/launch.json,
# or run manually with:
SYNCHRONIZE_HOME=/tmp/synchronize-preview \
SYNCHRONIZE_PORT=47823 \
  bun run src/daemon.ts

# Open http://127.0.0.1:47823/web/
```

To use the Claude Preview MCP tools:
- `preview_start({ name: "synchronize-daemon" })` — picks up `.claude/launch.json`
- `preview_navigate / preview_screenshot / preview_eval / preview_inspect`

---

## 3. Major work, in narrative order

### 3.1 White-screen fix (entry point)

`web/build.ts` was emitting relative `./main.*.js` paths in the built `index.html`. Hitting `/web` (no trailing slash) made the browser resolve those relative to the host root, not `/web/`. Fixed by:
- Substituting absolute `/web/main.*.js` and `/web/main.*.css` in `build.ts`
- Dropping the leading `./` in `web/index.html`

### 3.2 Claude Preview wiring

Created `.claude/launch.json` with a `synchronize-daemon` config (port 47823, `SYNCHRONIZE_HOME=/tmp/synchronize-preview`). `preview_start` honours it; the daemon serves `/web/` correctly.

### 3.3 Initial design iteration

Diffed the rendered UI against the Claude Design reference screenshots and fixed the obvious deltas:
- Built `TimelineRail.tsx` — was just a placeholder div before
- `AgentRoster` no longer filters out `"you"` (READY section now shows You)
- Removed slanted Sticker rotations everywhere (`tilt=-3` removed from primitive)
- Fixed empty-bordered-box around the author-name pill (was a leftover `.author-chip` rule with `transform: rotate(-0.5deg)` + border + shadow in `styles.css`)
- Coloured `@mention` chips via a custom react-markdown `code` renderer that detects backticked `@@handle` tokens and renders `MentionChip` with the agent's identity colour
- Added `inkFor(hex)` (WCAG-style luminance) so light backgrounds get dark text (Cortex yellow + black) and dark backgrounds get white text (Vega blue + white). Applied to Avatar, MentionChip, author-name pill, poll voter chips, thread-badge avs

### 3.4 Threads, polls, context menus

- **`ContextMenu.tsx`** — global provider + `useContextMenu()` hook. Wired into MessageRow, Sidebar room item, AgentRoster card (3 surfaces). Auto-dismiss on outside-click / Escape / scroll. Most menu actions are still `console.log` stubs (copy actions work via `navigator.clipboard`).
- **`ThreadPane.tsx`** — right-side panel: header (`Thread · replying to <pill>` + ×), parent message (reuses MessageRow), divider with reply count / participants, replies, dedicated `Composer` with `parentMessageId`. Triggered by clicking the new `.thread-badge` under any message *or* the right-click "Reply in thread" menu.
- **`PollWidget.tsx`** — POLL pill + question + options (icon, label, lime progress fill, vote count, voter avatar stack on the right) + footer ("N of M voted · closes in 4 m 32 s · click an option to vote"). Wired to a new `Message.poll` field. Seeded `hb-poll` in `#heartbeat-checks`.

### 3.5 Scrolling + scroll controls

- **`useAutoScrollbar`** hook — adds `.is-scrolling` class to a scroll container during active scrolling; removes after 800 ms idle. Applied to 4 surfaces:
  - Sidebar GROUPS list, Sidebar DMs list (each has its own independent thin scrollbar)
  - Chat list, ThreadPane body
- CSS variant `.autoscroll` pinned to `--scroll-bg` per surface (paper-2 for sidebar, paper for chat/thread). Thumb is transparent at rest, fades in on hover/focus/`.is-scrolling`.
- **`ScrollControls.tsx`** — direction-aware floating ↑ / ↓ button anchored bottom-right of chat / thread. Tracks scroll direction (J or K, well — wheel direction); only renders the matching arrow. Visibility synced to `.is-scrolling` via `MutationObserver` so the arrow and the scrollbar fade in/out *together*.

### 3.6 Resizable thread pane

**`ResizeHandle.tsx`** — 6 px column between chat and thread. Pointer Events with `setPointerCapture`. Width clamped to 320–820 px (DESIGN.md), persisted in `localStorage["synchronize.threadWidth"]`. Arrow keys nudge ±16 px. `userSelect: none` + `cursor: col-resize` on `<body>` during drag.

**Bug caught + fixed mid-build:** initial version used `useState` for the dragging flag; the `pointermove` closure was stale on the first move after `pointerdown` because React hadn't re-rendered yet. Switched to a `useRef` for the truth + state only for the `.is-dragging` CSS class.

### 3.7 Composer redesign

- Slim padding (6 px / 8 px / 4 px stack vs old 12 px / 14 px / 8 px)
- Textarea `min-height: 38 px` (was 56)
- Dashed separator between textarea and foot **removed** (added zero info, ate real estate)
- Send button shrunk; foot hints smaller
- Centring math: `padding: 6px max(18px, calc((100% - 880px) / 2)) 8px` — content tops out at 880 px (DESIGN.md `bubble-maxw`) centred within whatever chat-column width is available. Re-centres automatically when thread opens and chat column narrows
- **Collapse** — a bare `▼` glyph (no circle, no border) at top-right of the input wrap. Click → collapses to a 1-line stub with the (truncated) draft text + ▲ to expand. Each composer (main chat / thread) has its own collapse state
- **Auto-collapse when thread opens** — `ChatView` passes `isThreadOpen` → `Composer` mounts with `collapsedDefault={true}`; `key="thread-open"` forces remount on flip

### 3.8 Chat region restructure (timeline ends at composer)

Previous layout had the timeline rail as a sibling column of the whole chat column, so it stretched the full panel height — under the composer. User wanted it to end at the top of the composer.

Refactor: `ChatView` now nests a `.chat-region` (`display: grid; grid-template-columns: minmax(0, 1fr) 112px`) for chat-list + timeline-rail, with the composer rendered BELOW that region. `.main-body` dropped to 2 columns (`1fr | 260px`) instead of 3. Composer can now span the full chat-column width.

### 3.9 ThreadPane hideAvatar + compactness

- `MessageRow` accepts a `hideAvatar` prop. When set, the gutter element is not rendered and the grid template collapses to `minmax(0, 1fr)`. Applied to parent message and every reply in the thread pane
- Tighter pane padding (head 8 × 12 px, body 12 × 12 × 4 px), tighter bubble padding inside the pane (10 × 12 vs 12 × 16)
- **20 px gaps between messages** with **2 px gap between a pill and its bubble** — pills now read as belonging to the message *below* them, not glued to the message above

### 3.10 Sidebar rework

- Two `<section class="sidebar-section">` blocks, each with its own `.list` autoscroller. Separated by a `1.5 px solid 20%-ink` divider so the boundary is obvious
- **User bubble** replaces the old `.user-footer` — small 40 px circular avatar at bottom-left. Click stub + right-click context menu (Signed in as / status / copy handle / view profile / sign out). Status dot peeks out at bottom-right corner
- Vim mode chip (`NAV` / `INS`) rides above the user bubble as a small pill

### 3.11 Dark mode legibility refresh

Driven by user feedback ("white borders are distracting, drop shadows are thicker than the text"). Researched dark-mode best practices ([Atlassian Elevation](https://atlassian.design/foundations/elevation), [Muz.li dark-mode systems](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/), [Material 3 Elevation](https://m3.material.io/styles/elevation), [DubBot a11y](https://dubbot.com/dubblog/2023/dark-mode-a11y.html)) and applied:

- **New `--rule` token** — full `--ink` in light, `rgba(236, 227, 205, 0.42)` in dark. Borders + shadows now reference `--rule`; text still references `--ink`. The "halve the visual weight of chrome" lever
- **Border weights halved in dark**: `--line` 3 → 1.5 px, `--line-2` 2 → 1 px
- **Shadow offsets cut**: `--shadow` 4 → 2 px, `--shadow-sm` 2 → 1 px, `--shadow-lg` 6 → 3 px, hover-lift 3 → 2 px
- **Surface ladder tuned**: `--paper-2` and `--paper-3` brighter by ~6 % so elevation reads tonally, not via shadow
- **Body weight 400 → 500 in dark** to combat halation on thin glyphs
- Swept inline `var(--ink)` references in borders/shadows to `var(--rule)` everywhere (Avatar, MentionChip, MessageRow author pill, ThreadPane parent chip, etc.) so they all inherit the softer dark-mode tone

### 3.12 DESIGN.md compliance pass

- TimelineRail `TYPE_COLOR` now reads CSS variables (`var(--yellow)` etc.) instead of hex literals — recolours with theme
- Off-scale radii (4 px, 6 px) snapped to the 0/3/5/8/999 ramp (thread badge av, poll option icon, poll voter chip, Avatar)
- `.poll-option.picked` no longer uses a coloured border (DESIGN.md: borders are always ink) — communicates via the lime fill + thicker shadow
- Removed all `transform: rotate(-3deg)` from the `Sticker` primitive — user feedback was emphatic ("no slanted bars")

### 3.13 Vim-style keyboard navigation

The biggest single feature this session. Modal navigation layer on top of the UI.

**Library**: `react-hotkeys-hook@5.3.2` (chosen for its scope feature + form-tag handling — `tinykeys` was the alternative but the scope feature won)

**Modes**:
- **navigate** (default) — J/K/H/L etc. work
- **typing** — any keystroke goes to the textarea
- Toggle via document-level `focusin` / `focusout` listeners — components stay mode-agnostic
- `Escape` from a textarea blurs it → returns to navigate

**Keymap**:

| Key | Action |
|---|---|
| `J` / `K` | Next / previous item in active panel |
| `gg` / `G` | First / last item in active panel |
| `L` / `Tab` | Next panel (sidebar → chat → roster\|thread) |
| `H` / `Shift+Tab` | Previous panel |
| `Enter` | Activate focused item (sidebar→switch room; chat→open thread; roster→jump to agent's last msg) |
| `i` | Focus the active panel's composer (chat composer if on sidebar/roster). Auto-expands if collapsed |
| `c` | Close active panel (only thread is closable today) |
| `Escape` | Blur composer → navigate, or back to chat panel if already navigating |

**Item registry**: DOM-based via `data-vim-panel` / `data-vim-item` attributes. Cheaper than threading refs through every component; trade-off is that new messages arriving mid-navigation don't auto-update focus state (covered in §6).

**Focus tracking**: stored on the element via `data-vim-focused="true"` — **not** a class. **This is important.** React owns `className=` on most items (`.room-item` toggles `.active`, `.roster-card` toggles `.focused`, etc.); a class set imperatively would be stripped when sibling state changes. Data attributes survive React reconciliation.

**Visual cursor**: muted tangerine (`--tangerine`) ring — 2 px solid at 55 % alpha + 12 px outer glow at 28 % alpha + existing brutalist shadow. Steady, **not animated** — the throbbing yellow `.flash-highlight` is reserved for timeline-click and jump-to-last-message.

**Mode chip**: small pill above the user bubble — tangerine "NAV" / lime "INS".

**Per-panel focus memory**: `lastFocusedByPanel` ref in the hook restores cursor position when re-entering a panel (e.g., sidebar→chat→sidebar returns you to the same room item you left).

**Auto-fallback**: when active panel disappears (e.g., thread closes while you were on it), hook detects via `!order.includes(activePanel)` and snaps back to `chat`.

### 3.14 Agent identity-colour overrides

Right-click any roster card → **Change color…** → 12-swatch popover (8 DESIGN.md accents + forest/navy/rust/slate extras) + native `<input type="color">` + **Reset to default**.

**Mechanics**:
- `DataSource.setAgentColor(agentId, hex | null)` added to the contract; `null` reverts to seed
- `MockDataSource` mutates the agents snapshot in place — every component reading `useAgents()` re-renders automatically via `useSyncExternalStore`. No prop drilling, no per-component plumbing
- Overrides persist in `localStorage["synchronize.agentColors"]` as `{ atlas: "#1F7A3A", ... }`. Restored on construction
- Sidebar DM rooms now use the *live* partner agent's colour instead of `room.color` (a snapshot of the seed). The `RoomItem` accepts an `otherColor` prop that the parent populates from `useAgents()` — so DM Atlas recolours when Atlas's colour changes
- `inkFor()` keeps the chip text readable on any picked hex

**Verified propagation**: changing Atlas to dark green updates the roster avatar, the DM room icon, the author pill above messages, the avatar tile on messages, the member pile in the room header — all in a single mutation.

### 3.15 Toasts + jump-to-agent's-last-message

**`Toast.tsx`** — `ToastProvider` + `useToast()` hook:
- Pill-shaped notification at the top-center of `.main` (anchored via `position: absolute`, so it sits over chat content, never over the sidebar or roster)
- 180 ms slide-down + fade-in animation
- Auto-dismiss after 3 s (configurable); click to dismiss early
- Kinds: `info` (default cream), `warn` (yellow-tinted), `error` (red-tinted), `success` (lime-tinted)
- Stacks vertically; `aria-live="polite"`
- z-index 1800 — above scroll controls, below context menus and the colour picker

**`jumpToAgentLast(agentId)` helper** in `App.tsx`:
- Searches `useMessages(room.id)` in reverse for the first message authored by that agent
- **Found**: `scrollIntoView({ block: "center", behavior: "smooth" })` + applies the existing `.flash-highlight` throbbing yellow animation for 2.4 s
- **Not found**: `toast.show("<Name> has not posted in <#room> yet", { kind: "info" })`

**Two trigger paths**:
1. **Double-click a roster card** → `onAgentDoubleClick(agent.id)` prop on AgentRoster, wired in App.tsx to `jumpToAgentLast`
2. **`Enter` on a roster card via vim navigation** → `onActivate("roster", "agent-…")` calls `jumpToAgentLast` (was previously toggling focus)

Single-click on a roster card still toggles agent focus (dim-others) — unchanged.

---

## 4. Design decisions worth carrying forward

### Big choices

1. **Keep the brutalist visual identity exactly as DESIGN.md prescribes** — even at the cost of a heavier dark mode. The dark refresh softens chrome via `--rule` but doesn't switch to a softer style language.

2. **Mock-first, with a clean `DataSource` interface** — every component subscribes via `useSyncExternalStore` to snapshots. New features (color overrides, toasts) didn't need any component refactors; just data-layer mutation.

3. **DOM-based vim item registry over React-based** — chose for V0 simplicity. Trade-off documented in §6.

4. **Single big commit (`3513714`) for the whole polish round** — files were too interleaved (App.tsx alone touches vim + colour + toasts + polish + jump) to split cleanly without hunk-by-hunk staging. Commit message is structured to serve as a changelog if a PR description ever needs it.

5. **Keep `react-hotkeys-hook` over barebones** — its scope feature maps cleanly to the modal navigate/typing design.

6. **Use `data-vim-focused="true"` attribute instead of a class** — React strips classes set imperatively when it re-writes `className`. Data attributes survive reconciliation. This bug cost ~30 min to diagnose; future imperative DOM ops on React-managed elements should default to data attributes.

7. **`inkFor(hex)` returns literal `#111111` / `#FFFFFF`, not CSS vars** — agent colours are theme-invariant (DESIGN.md: `peer.color` is owned by the daemon). So the contrast text matches the fixed-colour background, not the page theme.

### Smaller calls

- **Composer collapse arrow**: bare ▼ glyph, no circle, no border, no shadow. User explicitly rejected the circular pill version.
- **Scroll helpers**: only the direction-relevant arrow shows, tied to `.is-scrolling`. Two-arrow stack was rejected as cluttered.
- **`Sticker` tilt removed everywhere** — user feedback was emphatic. DESIGN.md allows sparing `±3°` tilts; brand-mark in `styles.css` still tilts but no in-content Stickers do.
- **Avatar size 34 px** with `gap: 4 px` between gutter and body — user wanted bigger, closer to the pill.
- **Vim focus colour: tangerine** (warm orange) — yellow was the first attempt; user requested red/orange and picked orange.
- **Enter on roster card jumps to last message** (not focus toggle). Focus toggle stays on single-click. Better activation semantics; in line with how `Enter` works on sidebar/chat.

### Rejected / deferred

- **Full shadcn migration** — explicitly chose à-la-carte Radix adoption instead (epic `sync-99s` documents the rationale)
- **`Ctrl+H/J/K/L` for vim** — conflicts with browser shortcuts (Ctrl+H history, Ctrl+L URL, Ctrl+K search, Ctrl+J downloads)
- **Help overlay (`?`)** — discussed, not built; vim shortcuts aren't yet self-documenting
- **Auto-snap-to-nearest** when the vim-focused item disappears (e.g., from a stream of new messages) — covered in §6

---

## 5. Beads issues created

All under epic `sync-99s` (shadcn evaluation). Stored in `.beads/issues.jsonl` (committed in `494de5f`). **`bd dolt push` was failing** because GitHub credentials aren't configured non-interactively in this worktree — the issues are in the git-tracked jsonl so they'll propagate via normal `git push`, just not via the Dolt shadow.

| ID | Pri | Title | Notes |
|---|---|---|---|
| `sync-99s` | P3 (epic) | Evaluate/adopt shadcn for web chat UI | Captures à-la-carte vs full migration paths; recommends à-la-carte first |
| `sync-0ap` | P3 | Baseline: a11y + bundle-size measurements before migration | Run first to establish comparison floor |
| `sync-e0t` | P3 | Migration matrix: which components swap, which stay custom | Planning artifact; blocked by sync-0ap |
| `sync-30s` | P3 | Integrate Tailwind into the Bun.build pipeline | Precondition for full-migration path |
| `sync-ea8` | P2 | Replace homegrown ContextMenu with Radix (a11y win) | À-la-carte — no Tailwind required |
| `sync-kmt` | P2 | Replace mention-autocomplete popup with Radix Popover + cmdk | À-la-carte — no Tailwind required |
| `sync-157` | P4 | Re-theme shadcn primitives to brutalist | Only if full-migration path chosen; blocked by sync-30s |

Each issue has a thorough description with rationale, complexity notes, and a realistic time estimate. Parent-child links wired via `bd dep add --type=parent-child`.

---

## 6. Known gaps & follow-ups (not Beads-tracked)

These were called out during the session but not implemented. Worth tracking if any become friction:

### Functional stubs

- **Context-menu items** beyond Copy actions are `console.log` stubs (Pin/Unpin, Mute, Delete, Leave group, Open DM, View profile, Set status)
- **Sidebar pin/search/more icons** in RoomHeader are static decoration
- **Theme toggle button** (☀/🌙) is real but the toolbar `+` buttons in sidebar sections don't open anything
- **Composer toolbar buttons** (B / I / `</>` / link / 📎) are disabled placeholders — only `@` (which doesn't open the popup directly) and Send are wired

### Vim navigation gaps

- **`?` help overlay** — keymap isn't self-documenting
- **`gg/G` chord** works but isn't visually indicated; first `g` waits 500 ms for the second
- **No auto-snap-to-nearest when focused item disappears** — if a streamed message arrives and removes the focused row, focus is lost rather than snapping to a neighbour
- **No `f` for focus toggle on roster** — Enter changed to "jump to last", focus toggle now only via single-click

### Reactions

- Seed has reactions for `m2` (`🚀 by atlas,nova`) and `m5` (`🎉 by you,atlas`) but `MessageRow` doesn't render the reactions row yet. Reference image 1 shows the design (`🚀 3 · 👀 1 · +`).

### Other visual deltas from reference screenshots

- **TIP card** at bottom-right corner of the chat (visible in `10-present-chat-overview-clean.png`) — not built
- **Image-attachment message style** (the "DROP IN MOBILE PREVIEW" mock screenshot in Atlas's message) — needs a new attachment field on `Message`
- **Day divider pill** ("TODAY" / specific date) between message groups — CSS exists for `.day-divider`, no JS to insert it yet
- **Composer collapse on the thread side** has its own state — currently if you collapse the thread composer it stays collapsed even after navigating away. Probably fine but worth noting

### Daemon side

- `DaemonDataSource` is still a stub. `setAgentColor` throws there. Live mode (`sync-jix`) hasn't been picked up since the V0 scaffold.
- Daemon `.beads` and worktree `.beads` have diverged independently (worktree's jsonl has the shadcn epic; master's doesn't). Will reconcile on merge.

### Design.md drift

- `Sticker` no longer tilts (user requested no slants). DESIGN.md allows sparing `±3°`. Brand-mark in `styles.css` still tilts. If a future use of Sticker wants to tilt, opt in explicitly.

---

## 7. How to continue (next agent)

1. **Read `web/DESIGN.md`** — the design token contract and component map are the source of truth.
2. **Run the bundle**: `cd web && bun run build.ts`. Daemon-side static serving is already wired in `src/daemon.ts` (committed in `ed6e9de`).
3. **Use the Claude Preview MCP** — `.claude/launch.json` is configured. `preview_start({ name: "synchronize-daemon" })` boots a clean preview daemon on port 47823.
4. **Read the most recent commit message** (`git show 3513714 --stat`) — structured H2s for each feature group, much more granular than this handoff in places.
5. **Beads workflow** — `bd ready` for current to-dos; the shadcn epic (`sync-99s`) is the natural next pickup point for accessibility wins.
6. **Worktree note** — this work is on `feat/web-chat-ui` worktree at `~/Codes/Personal/synchronize-worktrees/feat-web-chat-ui`. Sibling primary checkout is `~/Codes/Personal/synchronize` (currently on master). The `.beads/issues.jsonl` files have diverged independently between the two checkouts.

### Recommended next pickup

**Option A: a11y baseline (sync-0ap)** — quickest visible win. Run axe / Lighthouse, document the gaps, capture bundle size. Then either pull Radix ContextMenu (sync-ea8, ~3–4 h) or stop and decide on Tailwind direction.

**Option B: wire real handlers** for the context-menu stubs (Pin, Mute, Delete, etc.). Most need `DataSource` interface extensions.

**Option C: pick up DaemonDataSource polling** (sync-jix follow-ups). Largest scope; would let us drop the mock fallback for the demo path.

---

## 8. Outstanding questions for the user (if they come back)

- **Tailwind in / out?** Blocks the full-migration path. à-la-carte Radix doesn't need it.
- **Reactions row** — render now (10 min), or defer until daemon supports reaction events?
- **Master branch beads merge** — when do we sync the shadcn epic onto master?
- **Vim help overlay** — wanted (per session discussion), no priority assigned. ~30 min to build.
- **DaemonDataSource live mode** — when does the polling path get picked up? It's gating multi-tab + real agent presence.
