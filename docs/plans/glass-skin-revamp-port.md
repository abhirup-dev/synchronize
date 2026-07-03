# Glass Skin Revamp — Port onto the Unified Token System

**Status:** planned · **Branch:** `feat-design-sync` (already fast-forwarded to master `6028eae` "Unify web theme token system") · **Author:** design-sync session 2026-07-03

## 0. What this is

Re-implement the **glass skin revamp** — designed and review-hardened in the claude.ai/design project `41739566-4de3-4dda-90bc-a7777d50b42d` — as first-class code in `web/`, on top of master's unified theme-token system. This is **not only an aesthetic change**: the revamp ships four functional systems (expanding-rail controls, floating headers, floating composer, compact filter sheet) plus new surfaces (agent roster panel, model picker, artifacts view) that must land as real components with stories.

### Scope decisions (from the user, binding)

- **Only the `mono` variant ships.** The design bundle explored six variants (`mono/lumen/canopy/ledger/pulse/sediment`); those were ideation. Mono's token values BECOME the glass skin's values. **No `data-glass-v` axis, no variant fixtures, no variant registry entries, no variant settings UI.**
- **Only the `mesh` ambient ships.** No `data-bg` axis with grain/dots/grid; mesh is the single glass backdrop treatment (see §2.1).
- The bundle's `data-font` axis was already dropped in the design (fixed Grotesk pairing). Do not port it.

### Source material (where the design truth lives)

| Source | Location | What it holds |
|---|---|---|
| `glass-variants.css` | **local:** `ds-bundle/templates/glass-skin-revamp/glass-variants.css` (identical copy in `…-e2e/`) | The whole skin: token values per variant, rail standard, floating headers/composer, compact sheet. 1347 lines. Use the `mono` blocks only. |
| `glass-e2e.css` | **remote:** `templates/glass-skin-revamp-e2e/glass-e2e.css` via `DesignSync(get_file)`, project above | Additive §1–§13: rail extension (.gx-*), chip tooltips, compact sheet labels, roster/profile/artifacts/settings/connection styling, narrow-mode fixes, `data-you` axis, board rail, compact surface rail |
| `app.jsx`, `seed-e2e.js`, `revised/*.jsx` | **remote:** `templates/glass-skin-revamp-e2e/` | Shell wiring, state model, data contracts, RosterPanel/AgentProfile/ArtifactsView/SettingsSheet |
| Handoffs | **remote:** `handoffs/handoff-implemented-expanding-rail-buttons.md`, `handoffs/handoff-implemented-minimal-surfaces.md` | Design rationale + gotchas, FROZEN decisions |
| `ARCHITECTURE.md` | **remote:** `templates/glass-skin-revamp-e2e/ARCHITECTURE.md` | Two-layer architecture, gap→solution log, **§5 rebuild checklist** |
| Screenshots | **local:** `ds-bundle/glassSkinV2Screenshots/*.png` (12 files) + `reference-screenshots/` | Visual ground truth (01-chat-room, 02-board-kanban, 03/04-activity, 09/10-mobile, 15/16-closeups) |

Remote files are read on demand: `DesignSync(get_file, projectId: 41739566-4de3-4dda-90bc-a7777d50b42d, path: …)`. `ds-bundle/` is gitignored; a `package-build.mjs` rebuild wipes it, so re-pull per `glass-skin-revamp-sync-pull-handoff.md` if needed.

### The one big translation rule

The design bundle could not edit the components (read-only `_ds_bundle.*`), so **everything there is a CSS override hack**: labels via `::after { content: var(--lbl) }`, icons assigned by `:nth-child`, masked-SVG data-URIs, `display:contents` to flatten markup it couldn't change, `!important` to out-specify the bundle. **We own the components. Port the intent, not the hack:**

- Rail labels/icons go **in the markup** (lucide icons, real `<span>` labels), never `:nth-child`/`--lbl` CSS assignment.
- Markup restructuring (single-bar header, flattened activity header) is done **in the TSX**, not with `display:contents`.
- Behavior (compact sheet, roster toggle, thread replacement) is **React state + `shellLayout()` traits**, never CSS-only or `mode === "compact"` if-else (see `docs/agents/storybook-ui.md` wiring conventions — gated reading before touching `web/` components).
- `!important` should be unnecessary almost everywhere once styles live in the component's own CSS. Treat any surviving `!important` as a smell to justify.
- Token **values** go in `web/src/styles/tokens.css` under `:root[data-skin="glass"]` (the only place skins may define values; raw hex is allowed there). Selector-only skin behavior goes in `web/src/skin-glass.css` (allowlisted for `[data-skin]` selectors and raw colors). Anything reusable becomes a `--role` token consumed via `var()` or the Tailwind mapping in `web/src/tw.css`.

### Contract gates (run these; the pre-commit hook enforces the strict one)

```bash
bun run typecheck                          # root
cd web && bun run typecheck
cd web && bun run check:theme-contract:strict
cd web && bun run build
cd web && bun run storybook:build
cd web && bun run test:storybook           # story render + play tests, theme×skin matrix
bun test                                   # daemon/CLI integration tests (root)
```

---

## 1. Current state (post-merge) you build on

- `data-skin="glass"` already exists: registered in `web/src/theme/theme-registry.json` → `registry.generated.ts`; token values in `tokens.css` `:root[data-skin="glass"]` blocks; selector behavior in `web/src/skin-glass.css`. The revamp **replaces the look** of this skin in place — same skin id, no new registry entry needed (verify `label` in the registry still reads well, e.g. "Glass").
- CSS load order is owned by `web/src/styles/css.ts` (imported by both `main.tsx` and `.storybook/preview.tsx`). Any new CSS file must be added there and only there.
- Theme (`light`/`kanagawa-wave`/`rose-pine-dawn`) × skin (`brutal`/`glass`) are orthogonal `<html>` data attributes via `usePersistentTheme.ts`. Glass-dark = `[data-skin="glass"][data-theme="kanagawa-wave"]`. **Never** key dark off anything else; never touch brutal's rules.
- Storybook: theme + skin are **global toolbar traits**; stories mount through `web/src/storybook/shellFrames.tsx` decorators. Do not duplicate stories per skin. Pin `globals: { skin: "glass" }` only for genuinely glass-specific states.
- `backdrop-filter` is allowed **only on fixed chrome** (sidebar, headers, composer, roster, overlays) — never on per-message scroll content. Mono's values are modest (14–20px blur), keep them.

## 2. Design language to port (mono)

### 2.1 Mono token values → `tokens.css`

From `glass-variants.css` `[data-glass-v="mono"]` blocks, dropped into `:root[data-skin="glass"]` (light) and `:root[data-skin="glass"][data-theme="kanagawa-wave"]` (dark), mapped onto the existing required-token names (`--paper*`, `--ink*`, `--bubble`, `--rule`, card/control/overlay families…):

- Light: `--paper #ffffffee`, `--paper-3 #f4f6f8`, `--bubble #f2f5f7`, `--ink #0f1419`, accent `--you-bg #1d9bf0`; hue tokens collapse to the single accent (`--lime #00ba7c`, `--red #f4212e` stay semantic). Dark: `--paper #000000d9`, `--paper-3`/`--bubble #16181c`, `--ink #e7e9ea`.
- Radii: hair 5 / xs 7 / sm 9 / md 10 / lg 12 / xl 14 / 2xl 16; `--control-radius: 10px`.
- Blur: panels `blur(14px) saturate(1.1)`; overlays `blur(20px) saturate(1.2)` (fixed chrome only).
- Sidebar tint `color-mix(in srgb, var(--you-bg) 7%, #fff)` light / `13%, #0a0a0c` dark; active room = `#1d9bf012` fill + inset 3px accent left bar.
- **Mesh ambient (the only one):** three accent-colored radial gradients, `mix-blend-mode: multiply` (light) / `screen` (dark), on the fixed backdrop layer glass already has. No toggle, no `data-bg`.
- Cross-cutting: body/`#root` color `var(--ink)`; author chip/name weight 700; avatar radius `--radius-xl`; the `--text-8…--text-28` scale stays as-is unless the text-scale tweak (§ open questions) is adopted.
- Rose-pine-dawn + glass must still resolve every required token — mono only specifies light/dark; confirm the light block covers the `rose-pine-dawn` case the same way current glass does (theme families: rose-pine-dawn is a light theme; token blocks key off skin, with dark overrides keyed on `kanagawa-wave`).

The theme-contract checker requires every token in `requiredResolvedTokens` to resolve for glass — run it early and often.

### 2.2 The expanding-rail control standard (FUNCTIONAL — the heart of the revamp)

A single control language for every top-of-surface single-select cluster:

- **Rail** = recessed well (`--rail-well-h: 40px`, radius 13px, faint fill, hairline border, **no blur**) holding **segments**.
- **Segment** = square line-icon at rest (`--rail-seg-h: 32px`, icon 18px, `--rail-seg-pad: 7px`); the `.active` one expands into a raised pane (`--rail-seg-pad-active: 0 12px 0 9px`, `--rail-active` fill, flat `--rail-active-shadow`) revealing its **label** (slide+fade, `--rail-label-delay: .08s`) and, for filters, a **count badge** trailing last (`--rail-count-delay: .13s`). Collapsed badge must fully collapse (`min-width:0; max-width:0; overflow:hidden` — flex min-width gotcha).
- **Chip** = standalone companion (sort, mark-all, working, room menu): same height/surface, **never accent-filled**; the only accent chip state is the live toggle's genuine `.active`.
- **Tooltips**: hover on a collapsed segment shows its label below (~.28s delay, `--ink` on `--paper` pill); active segments excluded. Chips get tooltips too (from e2e §3: "Mark all read", "Only working agents", "Filter rooms", "Sort: newest/oldest first" tracking `aria-pressed`).
- Exactly **one accent pane per cluster**.

**Where it applies:** room header tabs (Chat/Board/Artifacts) · activity filters (All/Awaiting/Mentions + counts) · activity layout toggle (Timeline/Grouped) · board filter rail (from e2e §12) · artifacts Grid/List toggle · compact surface rail. Chips: `.act-sort-toggle`, `.act-markall`, `.act-live`, `.act-room-filter-trigger`.

**Implementation shape:** a real primitive — `web/src/components/rail.tsx` exporting `Rail`, `RailSegment`, `RailChip` — geometry/motion/color driven by `--rail-*` component tokens defined once in `tokens.css` under glass (and given sane brutal-compatible defaults or scoped so brutal surfaces are untouched — decide in Phase 2; simplest: rail components are only mounted on the surfaces being restyled, and their tokens are defined per-skin so the same markup renders brutal-correct under brutal). Icons are lucide components; labels are real elements. Kill the shipped brutalist offset-shadow/translate on these controls under glass.

### 2.3 Floating headers, hard-cut mask (FUNCTIONAL)

- Room header and activity header become **overlay chrome**: absolutely positioned over the scroll surface, transparent, `pointer-events:none` with interactive children re-enabling.
- **Room header collapses to a single bar:** identity (left) · tab rail centred (desktop: absolute-centred; medium: static flow between truncating identity and AGENTS — e2e §10 fix) · AGENTS button (right). The second row, room-activity sparkline, "x/y working" meter, and member avatar pile are **removed** (design review verdict). Do this in `RoomHeader` TSX, not `display:contents`.
- **Activity header flattens to one axis:** title · filters rail · (gap) · sort pin + layout well · mark-all · working · room menu; the "· N awaiting you" subtitle is dropped.
- Scroll surfaces clear the chrome with `padding-top: var(--float-clear)` (chat 76px, activity 74px, medium 116px, compact 62px) and a **hard-cut `mask-image`** — fully transparent through the header zone, `#000` at exactly `--float-clear`, **0px transition. No fades, ever** (explicit, repeated design decision).

### 2.4 Floating composer (FUNCTIONAL)

- Kill both dock separators via the existing `--composer-separator-line` variable (glass sets it to `0 solid transparent`; if the style no longer reads the var, remove the border in the component under glass).
- Composer becomes `position:absolute; bottom:0` in `.chat-col` and the thread pane, flush to the bottom (square bottom corners, rounded top, keeps shadow) — reads as a floating opaque glass card; messages disappear behind it (no fade).
- Scroll padding so the last message clears it: chat 168px / thread 150px (compact 132/120 per e2e §10). Follow-up (optional): drive from measured composer height.

### 2.5 Minimal surfaces (aesthetic but structural)

- **Sidebar = one continuous surface:** remove `sidebar-brand` bottom border and `sidebar-bottom` top border + its distinct dock shade (these are Tailwind arbitrary utilities in the TSX — remove/conditionalize them properly rather than out-specifying).
- **Activity grouped feed flattened:** group container transparent (no card/border/shadow), header = quiet heading (no shade/rule), between-group gap 30px vs within-group 5px; `.act-row`/`.act-card` (ink-9% fill + hairline, hover 14%) stay the only contrasting surfaces.

### 2.6 Compact / mobile (FUNCTIONAL)

- **Activity Filters sheet:** all rails collapse behind one "Filters" button (funnel + caret, pinned top-right); tap opens a dropdown sheet (backdrop, tap-to-dismiss) stacking every cluster vertically with mono kicker labels ("Filter", "Sort · layout", "Working", "Actions", "Room" — e2e §4). React state (`actFiltersOpen`-equivalent), not DOM injection. Duplicate banner title hidden (compact app bar titles the screen).
- **Compact surface rail** (e2e §13): floating icon-only Chat/Board/Artifacts rail pinned top-left of the room surface; board additionally gets a Filters chip → dropdown sheet. All compact surfaces clear the floating chrome via the same hard-cut mask, `--float-clear: 62px`.
- **Thread replaces the surface column below desktop** (e2e §10): the side-by-side thread pane (and its second composer) is desktop-only; medium/compact swap it in; compact thread shows the app bar only (no second pane header).
- Audit `ShellModeContext`: in the real app the provider exists — verify every revamped surface actually consumes `shellLayout(mode)` traits rather than assuming desktop (the e2e found the harness's missing provider made components silently render desktop variants; our equivalent risk is a component not reading the trait).

### 2.7 New surfaces / features (from the E2E — FUNCTIONAL, cross-stack)

1. **Agent roster panel** — upstream the e2e's `RosterPanel` additions into `AgentRoster` (preferred over a clone): status-grouped rows (online/busy/idle/offline with status dots), **model chip** per agent (`modelShort()` of `runtimeDetails.model`), Spawn chip in the header. Desktop/medium: right column (292px/264px) toggled by the header AGENTS rail button; compact: the Agents bottom-nav surface (roster full-screen, ✕ returns to Chats, badge = member count − you).
2. **Agent profile + model picker** — extend `AgentProfileDialog`: real `AgentPreview` card + MODEL section (radiogroup of models for the agent's tool); picking updates the agent and toasts. **Needs a real daemon command** (`setAgentModel` — daemon route + client + MCP/CLI surfaces as appropriate); the e2e mock-store write defines the UX contract. Model registry must stay single-source with `SpawnAgentDialog`'s `MODEL_OPTIONS`.
3. **Artifacts view — OUT OF SCOPE (user decision 2026-07-03).** The Artifacts tab stays a placeholder; do not build ArtifactsView, do not extend the Artifact type, no daemon artifacts feed. The design e2e's grid/list spec remains in the remote bundle if this is ever revived.
4. **Self-message treatment — `tint` only (SCOPE CUT 2026-07-03: not configurable).** The design's `data-you` axis (tint/edge/halo/fill) is dropped; ship the `tint` default directly as glass CSS on self bubbles: 11% accent wash + hairline accent ring (box-shadows, no layout shift). No `<html>` attribute, no persistence, no settings row.
5. **Agent labels — `pill` default only (SCOPE CUT 2026-07-03: not configurable).** No `data-agentlabel` axis; the existing author-pill rendering stays as-is. Compact settings sheet keeps only what already exists (theme appearance etc.) — **no variant / accent / ambient / agent-label / your-messages rows**.
6. **Connection overlay** — full-screen scrim (`blur(9px)`) wrapping the real `ConnectionError` + Reconnect chip, shown on daemon connection failure.
7. **Seed/mock data** (`web/src/data/seed.ts` / `MockDataSource`): `agent.runtimeDetails {tool, model, thinking?, source, machineId, hostSessionId, launchState, cwd, gitBranch, gitDirty}` on several agents; `room.paths` on group rooms (SpawnAgentDialog requires them); a live poll message + a two-attachment message; artifacts array. These power the stories.

Timeline rail: **deliberately skipped** (product call in the e2e — keep it skipped).

---

## 3. Phases

Every phase ends with: `bun run typecheck` (root + web) · `cd web && bun run check:theme-contract:strict` · `cd web && bun run build` · `cd web && bun run test:storybook` · `bun test` — all green — plus the phase-specific checks listed. Commit per phase; the pre-commit hook runs the strict contract automatically.

### Phase 1 — Glass token foundation (mono) + mesh backdrop

Rewrite the glass skin's values to mono, in place.

1. In `tokens.css`, replace the current glass value blocks with mono's (light + `kanagawa-wave` dark), covering every `requiredResolvedTokens` entry; add the rail component tokens (`--rail-*` full set from §2.2) and `--float-clear` defaults under glass.
2. Rework `skin-glass.css` to mono's selector behavior: sidebar tint + active-room inset bar, blur-on-fixed-chrome values, mesh backdrop gradients (light `multiply` / dark `screen`), body gradient, cross-cutting rules (§2.1). Delete glass rules that mono retires.
3. Remove any variant/ambient fixtures if present anywhere (there should be none in-app today — verify: `rg "data-glass-v|data-bg" web/src`).
4. Registry: no new entries; confirm glass label/order; regen check (`bun run check:theme-registry`).

**Phase-1 checks:** contract strict passes; Storybook toolbar sweep — glass × {light, kanagawa-wave, rose-pine-dawn} over Sidebar, ChatView, ActivityView, BoardView, composer, overlays stories renders mono (no stray old-glass look, brutal pixel-identical to before — spot-check brutal × dark on the same stories); `rg "data-glass-v" web/src` empty; screenshot-compare key surfaces against `ds-bundle/glassSkinV2Screenshots/{01,07}` for direction (not pixel parity — markup differs until Phase 3).

### Phase 2 — Expanding-rail control system

1. Build `Rail` / `RailSegment` / `RailChip` primitives (`web/src/components/rail.tsx` + CSS consuming `--rail-*`), with the staggered expand animation, count-badge collapse fix, tooltips (segment + chip), a11y (`role=tablist`/`radiogroup` as appropriate, `aria-pressed`, keyboard focus).
2. Convert in place: room header tabs; activity filters (+ counts); activity layout toggle; sort/mark-all/working/room chips. Neutralize brutalist offset shadows on these under glass; decide + document how the primitives render under **brutal** (goal: brutal keeps its current look — either rail tokens defined per-skin, or the rail primitive is glass-scoped styling over the same markup).
3. Stories: `Rail.stories.tsx` (rest/active/hover-tooltip/count-badge states + `play` test driving selection); update RoomHeader / ActivityView story args & play tests for the new markup. Run the staleness audit from `docs/agents/storybook-ui.md` on every touched component.

**Phase-2 checks:** `test:storybook` including new play tests; axe/a11y pass on the rail stories; manual toolbar sweep both skins (brutal unchanged); every control in a cluster measures exactly 40px outer / 32px segment (the "shrinking order" bug class — assert in a play test via `getBoundingClientRect`).

### Phase 3 — Layout: floating headers, floating composer, minimal surfaces

1. `RoomHeader`: single-bar restructure (remove sparkline, working meter, member pile rows) — TSX change; desktop absolute-centred rail, medium static-flow (e2e §10).
2. `ActivityView` header: one-axis flatten, drop subtitle.
3. Floating chrome + hard-cut masks + `--float-clear` paddings for chat/activity/board scroll surfaces (board's own header row is removed; its filter rail moves into the floating header — e2e §12; board filter rail itself may ship as visual-only parity with the e2e demo, wired to whatever board filtering exists).
4. Floating composer (chat + thread) + scroll paddings.
5. Sidebar one-surface + activity group flattening.
6. Thread-pane replacement below desktop (shellLayout trait, e.g. `layout.threadPresentation: "side-by-side" | "replace"`); compact thread header suppression.

**Phase-3 checks:** play tests asserting (a) mask is hard-cut (computed `mask-image` has a 0px transition — assert stop positions), (b) composer is absolutely pinned and last message scrolls clear of it, (c) exactly one composer in DOM below desktop with a thread open; viewport matrix 390/412/768/1024/1440 via `test:storybook`; visual pass vs screenshots `01/02/03/04/15/16`; brutal skin re-verified untouched on every restructured component (markup changes hit brutal too — its stories must still pass unchanged or be updated deliberately with the staleness-audit rules).

> **Risk note:** this is the phase where markup restructuring can break brutal. The removals (sparkline, working meter, member pile) apply to the component, not just glass — confirm with the user before deleting them for brutal too; otherwise gate presence on a skin/`themeTraits`-style trait. Default assumption in this plan: the removals are universal (the design review called them unearned on any skin), with brutal stories updated accordingly.

### Phase 4 — Compact & medium behaviors

1. Compact activity Filters sheet (button + backdrop + stacked clusters + kickers), React state.
2. Compact surface rail (Chat/Board/Artifacts) + board compact Filters chip/sheet.
3. BottomNav Agents surface (full-screen roster; badge count; ✕ semantics), app-bar title logic (Agents/Activity/Thread/#room).
4. Medium fixes: header rail static centring, composer keyboard-hint hidden, compact composer max-height 30vh, compact scroll paddings.
5. ~~Settings sheet axes~~ (SCOPE CUT: `data-you`/`data-agentlabel` are not configurable — tint + pill defaults ship as plain glass CSS; no settings work in this phase beyond what exists).

**Phase-4 checks:** compact stories (390/412) for: filters sheet open/close via play test; surface rail switching; roster surface open/return-to-chats; settings sheet axes actually flip `<html>` attributes (assert in play). `test:storybook` matrix green; no horizontal overflow at 390 (wiring-conventions rule).

### Phase 5 — New surfaces, data plumbing, sync-back

1. AgentRoster upstream: status groups, model chips, Spawn chip (+ stories).
2. AgentProfileDialog: MODEL picker section; **daemon `setAgentModel`** (route in `src/api/peers.ts` or agents equivalent, client method in `src/client.ts`, optimistic UI + toast; `bun test` coverage at the daemon level); single-source model registry with `SpawnAgentDialog`.
3. ~~ArtifactsView~~ (OUT OF SCOPE — see §2.7.3; tab remains a placeholder).
4. ConnectionOverlay wiring to real connection state.
5. `data-you` bubble treatments (§2.7.4) + seed updates (runtimeDetails, room.paths, poll, attachments).
6. Full Storybook staleness audit over everything touched; update `.design-sync/conventions.md` if the class/token vocabulary changed; **re-run `/design-sync`** so the design project reflects the shipped skin (this also clears the stale `--tw-*` token-extraction flags noted in `uploads/design-sync-handoff.md` if that config fix lands).

**Phase-5 checks:** `bun test` (daemon route tested); model-pick play test (pick → chip updates → toast); artifacts grid/list play test; connection overlay story; full gate suite; `bun run scripts/dead-css.mjs` (in `web/`) for orphaned selectors; final visual matrix glass × 3 themes × 5 viewports; squash-merge readiness per repo convention.

---

## 4. Explicit non-goals / deferred

- Variants lumen/canopy/ledger/pulse/sediment; ambient grain/dots/grid; font axis; accent axis (mono keeps its single `#1d9bf0` accent) — **cut**.
- Timeline rail — deliberately skipped in the design.
- Daemon-backed artifacts feed — separate ticket after the UI contract lands.
- Composer-height-driven scroll padding; `--chat-text-scale` text-size setting — optional follow-ups, not in v1.

## 5. Open questions for the user (non-blocking, defaults chosen)

1. **Do the room-header removals (sparkline, working meter, member pile) apply under brutal too?** Plan assumes yes (universal removal). If no, they gate on a skin trait.
2. ~~`data-you` default~~ RESOLVED (2026-07-03): not configurable — tint ships as glass-only CSS, brutal untouched, no attribute.
3. **Accent axis** (slate/blue/violet/teal/amber remaps) — cut with the variants, or wanted as a user setting later? Plan: cut.

## 6. Gotcha ledger (inherited from the design rounds — do not re-litigate)

- **No fades.** Hard-cut masks, 0px transitions, top and bottom. The user rejected all fade treatments emphatically.
- One accent pane per cluster; chips never accent-filled (except live's true active state).
- Flat active-pane shadow (no inset bevel / 3D).
- Rail wells: no blur (they sit over the masked-out zone; blur bought nothing).
- Badge collapse needs `min-width:0` (flex default `min-width:auto` bug).
- `--float-clear` is per surface/mode; if a floating header grows, bump it.
- Sort direction reads from the flipping arrow icon, not a color change.
- `backdrop-filter` on fixed chrome only (perf rule from the token-system plan).
- Kanagawa Wave is the canonical dark; never hardcode `"dark"` (it's a legacy normalization).
