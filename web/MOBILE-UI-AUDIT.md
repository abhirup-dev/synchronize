# Compact (mobile) UI/UX audit

Scope: **compact shell mode only** (`shellMode === "compact"`, width < 780px),
verified at 412×915 (Pixel-class). Desktop and medium are explicitly out of
scope and confirmed working — do not change them.

Focus order (per user direction): **navigation → layout → UX**. Colors/themes
are deferred to a later loop; do not chase them here.

Rubric (world-class mobile chat heuristics): touch targets ≥44px; thumb-zone
reachability; navigation depth + a clear back affordance; persistent vs.
transient chrome; "where am I" state visibility; one-handed operability; no
horizontal clipping; coherent iconography.

Severity: **P0** breaks a core flow / visibly broken layout · **P1** significant
friction · **P2** secondary view or polish.

---

## Fixed during the audit pass

- **[F1] Agents tab from Activity didn't open the roster.** `onNavAgents` set a
  room to leave Activity, and the "reset secondary state on room change" effect
  clobbered `agentPanelOpen` in the same render. Moved the reset into
  `selectRoom`. ✅ `App.tsx`
- **[F2] Agents roster sheet rendered empty in compact.** A legacy
  `@media (max-width:1100px){ .agent-roster{display:none} }` hid the roster
  globally, including inside the overlay sheet. Scoped to
  `.main-body > .agent-roster` (the persistent desktop column only). ✅ `styles.css`

---

## Open findings

### A. Room header (conversation top bar) — every room view
- **[A1] P0** Header is three stacked rows (identity · action icons · tabs) ≈
  190px tall — eats a sixth of the screen before any message. Collapse to a
  single compact bar; demote the tab strip.
- **[A2] P0** Action buttons are emoji glyphs (☀️ 🖼 🫧 📌 🔍 ⋯), not the new
  Lucide `IconButton` system — inconsistent sizing, weak contrast, sloppy hit
  areas. Convert to `IconButton`; fold rarely-used toggles into a `⋯` overflow.
- **[A3] P2** Theme / skin / chat-bg toggles are top-level header buttons on
  mobile — they're settings, not per-conversation actions. Move to overflow /
  a settings sheet. (Placement, not color.)

### B. Thread view
- **[B1] P0** Thread banner is crammed into the CHAT/BOARD/ARTIFACTS tab row and
  **overlaps the tabs** ("≡ThreadCTS replying to ×C"). In compact, a thread
  should be a **pushed full screen** with its own header (back chevron +
  "Thread" + parent author), not a banner in the tab strip.
- **[B2] P0** No clear back affordance from a thread; the close `×` is buried in
  the overlap. Dedicated thread header with a back button.
- **[B3] P1** The thread-summary toggle lived in the desktop composer footer,
  which the compact composer replaced — so **thread summaries are unreachable**
  in compact. Surface via the thread screen or room overflow.

### C. Activity view
- **[C1] P0** Header overlaps badly: the large "ACTIVITY" title collides with
  the "TIMELINE ▸" toggle, the "LIVE · 3 working" pill, and "feed"/"you"
  subtitles. Rebuild as a single compact row.
- **[C2] P1** Filter-chip row (ALL / AWAITING YOU / MENTIONS / …) overflows
  horizontally and clips the last chip. Make it a horizontal snap-scroll row.
- **[C3] P2** Thin vertical strip at the right edge (stray rail / overflow) —
  investigate.

### D. Room-switcher sheet ("Chats" tab)
- **[D1] P1** The desktop Sidebar footer (vim "NAV" pill, "Y" self-avatar, an
  Activity-pulse shortcut with badge, a greyed "RESUME" button) renders inside
  the sheet, directly above the global bottom nav — two stacked bottom bars; the
  Activity shortcut duplicates the bottom-nav Activity tab; "NAV"/vim is
  meaningless on touch. Hide the sidebar footer (or its vim/activity bits) in
  compact.
- **[D2] P2** Terminology mismatch: bottom-nav label "Chats" vs sheet title
  "Communities". Unify.
- **[D3] P2** `⌘K` hint in the room-search field is meaningless on touch.

### E. Board view (secondary)
- **[E1] P1** Kanban columns overflow horizontally — only ~1.5 columns visible,
  cards clipped, REVIEW/SHIPPED off-screen with no scroll affordance. Add
  horizontal snap-scroll or a column switcher.
- **[E2] P2** "drag to reorder" is the only reordering affordance — hostile to
  touch. Provide a tap-based move.

### F. Global / debt
- **[F3] P1** A legacy raw media-query block (`max-width` 1280/1100/760/880 in
  `styles.css`) coexists with and contradicts the JS `shellMode` system. It is a
  latent source of compact bugs (it caused F2). Consolidate responsive logic
  into `shellMode`; remove the conflicting media queries.
- **[F4] P2** Tailwind preflight isn't normalizing `<button>` backgrounds, so a
  bare `<button>` inherits the UA light button-face (caused the bottom-nav grey
  flash, now fixed). Add a global button-bg reset so new bare buttons are safe.

### G. Composer (compact)
- **[G1] P1] Verify the `@` mention picker and `/` skill picker render correctly
  as compact popovers (not yet confirmed; the skill picker did not visibly open
  on tap during the pass).
- **[G2] P2** Own ("You") messages render near full-width; weak "mine"
  distinction beyond bubble color. Consider tighter max-width + right inset.

### H. Cross-cutting
- **[H1] P2** Long code lines in message bubbles clip at the right edge in the
  main chat (e.g. `BIGINT N|`) with no horizontal scroll. `pre { overflow-x:auto }`
  + `min-w-0` on the bubble.

---

## Priority order

1. **P0 — broken nav/layout (do first):** B1+B2 (thread screen), C1 (activity
   header), A1+A2 (room header collapse + Lucide icons).
2. **P1 — significant friction:** C2, D1, F3, B3, E1, G1.
3. **P2 — secondary/polish:** A3, C3, D2, D3, E2, F4, G2, H1.
