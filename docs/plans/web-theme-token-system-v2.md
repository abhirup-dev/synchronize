# Web Theme Token System v2

Status: planning
Branch: `codex/ui-theme-token-plan`
Date: 2026-06-26

## Why this exists

The current web UI already has a useful theme mechanism: the app and Storybook set
`data-theme` and `data-skin` on `<html>`, `tokens.css` owns many CSS custom
properties, and Tailwind v4 utilities read those variables through `tw.css`.
That is the right foundation.

The missing piece is identity color ownership. Agent avatars, room glyphs,
mentions, author chips, board assignee bars, activity rows, and color picker
swatches still use literal hex strings that are generated or persisted outside
the theme. That means Kanagawa can tune surfaces and text while still showing
bright brutalist identity colors that do not belong to Kanagawa.

This plan makes identity colors a first-class part of the theme contract, then
uses that contract to reduce the theme-specific patchwork currently spread
across `tokens.css`, `styles.css`, `components/extra.css`,
`components/activity.css`, `skin-glass.css`, TypeScript fixtures, and local
storage.

## Existing system

### Strong foundations

- `usePersistentTheme()` stores `theme`, `skin`, and `chatBg`, then applies
  `data-theme`, `data-skin`, and chat background variables to `<html>`.
- Storybook mirrors the runtime contract in `.storybook/preview.tsx`; themes
  and skins are global toolbar traits, not duplicated stories.
- `themeTraits(theme)` is the palette-side analogue of `shellLayout(mode)` for
  behavior that truly differs per theme.
- `shellLayout(mode)` and `shell-mode.tsx` are a good example of the kind of
  typed contract this plan should copy for theme capability decisions.
- `tokens.css` already contains broad primitive, semantic, component, typography,
  radius, shadow, line, spacing, and z-index custom properties.
- `tw.css` maps CSS variables into Tailwind v4, so most component code can stay
  in Tailwind and still inherit runtime theme changes.
- `styles/README.md` documents CSS ownership and explicitly says new static
  styling should prefer inline Tailwind while CSS files should remain for tokens,
  base rules, theme hooks, skin hooks, and genuine JS/class hooks.

### Current themes and axes

- Palette axis: `light`, `rose-pine-dawn`, `kanagawa-wave`.
- Skin axis: `brutal`, `glass`.
- Chat background axis: `none`, plus SVG/image presets through CSS variables.
- Historical compatibility: stored `dark` and `catppuccin-mocha` normalize to
  `kanagawa-wave`.

This gives us a three-axis surface, not a simple dark-mode toggle:

```text
theme = color palette and contrast
skin = material language, shadow, border, radius, translucency
chatBg = optional conversation canvas image/pattern
```

The v2 contract needs to preserve that separation.

## Audit findings

### Identity colors are outside the theme

Primary sources:

- `web/src/data/daemon.ts`
  - `COLORS = ["#FFD23F", "#FF5DA2", "#4D7CFE", ...]`
  - `EMPTY_AGENT.color = "#111111"`
  - `colorForPeer(peerId)` hashes ids into that literal palette.
  - `changeAgentColor()` persists raw hex overrides under
    `synchronize.agentColor.${peerId}`.
  - `colorForGroup(groupId)` hashes group ids into the same literal palette.
- `web/src/data/seed.ts`
  - Seed agents, groups, and DMs use literal hex colors.
- `web/src/data/mock.ts`
  - Mock seeded colors are loaded from `AGENTS`.
  - Spawned agents use `#B49BFF`.
  - Agent color overrides are JSON of raw hex values.
- `web/src/data/types.ts`
  - `Agent.color: string`
  - `Room.color: string`
- `web/src/components/AgentColorPicker.tsx`
  - Swatches are hard-coded brutalist hex values.
  - API is `currentHex`, `defaultHex`, `onPick(hex)`.
- `web/src/components/primitives.tsx`
  - `inkFor(bgHex)` assumes six-digit hex and returns black/white.
  - `Avatar`, `MentionChip`, `IdentityBadge`, and `IdentityText` accept plain
    strings and often calculate foreground in JS.

This means the color contract is currently "whatever string the data layer
returns". It can be a hex, a CSS var, or a fallback literal, but no layer owns
which values are legal for a theme.

### Identity color consumers are widespread

Structural AST and text scans found the following consumers:

- `AgentRoster.tsx`: avatars and `AgentColorPicker`; defaults read from seed
  agents, not from theme slots.
- `MessageRow.tsx`: author chips, avatar colors, thread badge avatars,
  reactions, and theme-specific reaction overrides.
- `Composer.tsx`: mention popup avatars and mention chips.
- `Markdown.tsx`: inline mention chips.
- `RoomHeader.tsx`: room glyph, room icon, member pile avatars, thread banner.
- `Sidebar.tsx`: room icons; DM rooms prefer the other participant color,
  group rooms use room color.
- `ActivityItem.tsx` and `ActivityView.tsx`: room chips, room icons, latest
  actor chips, status dots, and row presence.
- `BoardView.tsx`: assignee avatar color is reused as task progress fill.
- `ThreadPane.tsx`: thread parent author chip.
- `ThreadSummaryPanel.tsx`: participant dots and thread summary identity marks.
- `PollWidget.tsx`: voter pills.
- `ArchiveRecovery.tsx`: fallback agent and room colors use `#111111`.
- Story files: primitive, iconography, agent color picker, attachment, and
  typography stories include hard-coded colors.

The identity palette is not just "avatar paint"; it is also used as a data-viz
color in board progress, activity latest actor, thread participants, and mention
surfaces. A v2 contract has to decide which of those remain identity-coded and
which move to data-viz semantic tokens.

### CSS theme ownership is too scattered

Theme-specific color work is split across several files:

- `tokens.css` defines the broad theme token layer.
- `skin-glass.css` overrides core tokens and then patches many component classes.
- `styles.css` contains base shell and component hooks plus Kanagawa-specific
  overrides for topbar controls, active rooms, reactions, activity dock controls,
  identity icons, archived room states, and more.
- `components/extra.css` contains Kanagawa-specific composer, chat-region,
  thread, and room-tab overrides.
- `components/activity.css` contains its own Kanagawa surface, border, shadow,
  control, identity tint, room glyph, and activity filter overrides.
- `chat-bg.css` adds theme plus skin combinations for chat background opacity.
- `code-light.css` is a separate syntax highlight theme for light mode.

The split is historically understandable, but the result is that adding a new
theme means hunting through multiple CSS files to discover what must be copied.

### `skin-glass.css` is compensating for component CSS

`skin-glass.css` explicitly says `activity.css` bypasses the token layer and that
glass maps activity's hard-coded brutal literals back to variables. That is a
high-value deletion opportunity.

The desired direction is:

- activity components consume semantic/component tokens directly;
- skins override tokens, not individual activity selectors;
- theme files do not need to know activity's DOM structure unless the component
  has a genuine visual behavior difference.

### `--accent` appears under-defined

`tw.css` exposes `--color-accent: var(--accent)`.

`activity.css`, `skin-glass.css`, and `styles.css` use `var(--accent)` and
`var(--on-accent)`.

The scanned `tokens.css` defines `--on-accent`, `--shadow-accent-inset`, and
theme accent families like `--yellow`, `--pink`, `--blue`, etc., but no obvious
base `--accent` definition was found in `tokens.css`.

If this is not defined indirectly elsewhere, any `var(--accent)` without a
fallback is invalid at runtime. Even if browser fallback behavior masks this in
some paths, the token contract is incomplete.

### Older tokenization left identity as an exception

Existing epic `sync-75p` successfully tokenized static visual values and
documented that inline style should only be used for dynamic data. In that plan,
agent color was explicitly classified as dynamic data and left as a literal.

That was correct for the earlier scope, but it is the wrong boundary for
themeable agent/room identities. Identity color is data-derived, but the palette
that data maps into is a theme concern.

This v2 plan does not reject `sync-75p`; it builds on it and moves identity
color from "dynamic arbitrary value" to "dynamic reference into a themed slot
set, with a custom-color escape hatch".

### Dead CSS and stale hooks exist

`cd web && bun run scripts/dead-css.mjs` currently reports:

```text
defined classes: 362  |  dead candidates: 84
```

Not all 84 are actionable:

- Highlight.js classes are intentionally external.
- Several activity classes are shipped dropped variants or reserved layouts.
- Some status classes are referenced structurally or by external class naming.

Still, the list includes likely stale hooks such as old composer/thread classes,
media view classes, tabbar classes, poll classes, and several activity variants.
This should be treated as a deletion stream after theme contract migration, not
as a prerequisite.

## Target architecture

### Principles

1. Runtime theme switching stays CSS-variable driven.
2. TypeScript owns references, validation, migration, deterministic assignment,
   and UI affordances; it does not hard-code theme-specific hex palettes inside
   adapters or components.
3. Components consume semantic tokens and typed identity references.
4. Skins override token values, not component DOM structure.
5. New themes should be added by editing one palette definition and one generated
   CSS block, then verifying Storybook and live `/web`.
6. Custom user colors remain possible, but custom colors are explicit exceptions,
   not the default deterministic path.

### Suggested module boundary

Add a deep theme module:

```text
web/src/theme/
  ids.ts
  palette.ts
  identity.ts
  contrast.ts
  storage.ts
  generated.css
  README.md
```

Responsibilities:

- `ids.ts`
  - exports `ThemeName`, `SkinName`, `ThemeTraits`, `themeTraits()`.
  - can absorb or re-export the current `usePersistentTheme` names so callers
    have one theme import path over time.
- `palette.ts`
  - source-of-truth theme objects.
  - primitive palette values, semantic roles, identity slots, status roles,
    component roles.
- `identity.ts`
  - `IdentitySlot`, `IdentityColorRef`, deterministic hashing, display labels.
  - `identityStyle(ref)` returns CSS custom properties for React inline style.
  - no component should hash ids or choose swatches directly.
- `contrast.ts`
  - contrast helpers for custom hex colors only.
  - slot foreground comes from the theme, not from `inkFor(var(...))`.
- `storage.ts`
  - localStorage key names and migrations from old hex overrides.
- `generated.css`
  - generated or hand-authored CSS custom properties from the theme objects.
- `README.md`
  - contributor contract: how to add a theme, add an identity slot, migrate a
    component token, and verify.

Initial implementation can be hand-authored TypeScript plus hand-authored CSS.
Style Dictionary or DTCG JSON should be considered only after the contract is
stable; the current codebase already has the right runtime mechanism.

### Theme object shape

Use a richer-than-base16 palette, but do not invent "Base64" as the public
contract. Standard UI practice is layered design tokens:

```ts
type ThemePalette = {
  id: ThemeName;
  family: "light" | "dark";
  primitives: {
    bg0: string;
    bg1: string;
    bg2: string;
    fg0: string;
    fg1: string;
    border0: string;
    shadow0: string;
    red: string;
    orange: string;
    yellow: string;
    green: string;
    cyan: string;
    blue: string;
    purple: string;
    pink: string;
  };
  semantic: {
    surface: string;
    surfaceRaised: string;
    surfaceSelected: string;
    fg: string;
    fgMuted: string;
    rule: string;
    accent: string;
    onAccent: string;
    danger: string;
    success: string;
    warning: string;
    info: string;
  };
  identity: IdentitySlotDefinition[];
  status: {
    online: string;
    busy: string;
    idle: string;
    offline: string;
  };
  components: {
    composer: Record<string, string>;
    activity: Record<string, string>;
    reaction: Record<string, string>;
    archivedRoom: Record<string, string>;
    code: Record<string, string>;
  };
};
```

The CSS variable surface can remain flat:

```css
:root[data-theme="kanagawa-wave"] {
  --surface: ...;
  --accent: ...;
  --identity-0-bg: ...;
  --identity-0-fg: ...;
  --identity-0-border: ...;
  --activity-control-bg: ...;
}
```

The important shift is not the exact object shape. It is having one source that
generates or documents every theme role, including identity colors.

### Identity color references

Replace raw data colors with references:

```ts
type IdentityColorRef =
  | { kind: "slot"; slot: IdentitySlot }
  | { kind: "custom"; hex: HexColor }
  | { kind: "token"; token: ThemeTokenName };
```

Recommended v0 slot count: 16.

Why 16:

- It matches the mental model of Base16 and terminal palettes without inheriting
  terminal-specific semantics.
- It is enough for common rooms without immediate repeats.
- It keeps Storybook swatches, localStorage migrations, and visual QA manageable.
- It can expand later to 24 or 32 without changing the reference model.

Slot variables:

```css
--identity-0-bg
--identity-0-fg
--identity-0-border
--identity-0-soft-bg
--identity-0-text
--identity-0-shadow
```

The foreground should be curated per slot and theme. Do not compute foreground
for slots with JS luminance; that fails once the background is a CSS variable or
a theme-specific mix.

### Persistence and migration

Current persistence:

- live data source: `synchronize.agentColor.${peerId}` -> raw hex or absent.
- mock data source: JSON map of agent id -> raw hex.

Target persistence:

```json
{ "kind": "slot", "slot": 5 }
```

or

```json
{ "kind": "custom", "hex": "#3B0A45" }
```

Migration rules:

1. Missing override: deterministic slot from stable id hash.
2. Stored old hex exactly matches old brutalist palette: convert to equivalent
   slot when possible.
3. Stored old hex does not match a known palette: keep as custom hex.
4. Invalid value: drop override and fall back to deterministic slot.
5. The old storage reader should be tolerant for at least one release because
   users may switch branches.

Room colors should follow the same reference model:

- group rooms: deterministic slot from group id;
- DM rooms: use the other participant identity color as today;
- fallback/archive rooms: stable neutral token or deterministic slot, not
  `#111111`.

### Component seam

`IdentityBadge` should become the main implementation seam:

```tsx
<IdentityBadge colorRef={agent.colorRef}>...</IdentityBadge>
```

Internally it sets:

```tsx
style={{
  "--identity-color": "var(--identity-5-bg)",
  "--identity-ink": "var(--identity-5-fg)",
  "--identity-border": "var(--identity-5-border)",
}}
```

During migration, preserve compatibility:

```tsx
<IdentityBadge color={agent.color}>...</IdentityBadge>
```

but treat `color` as deprecated and route through a compatibility parser.

`inkFor(bgHex)` should survive only for `{ kind: "custom", hex }`. Components
should not call it directly.

### Agent color picker

The picker should stop being a raw hex palette by default.

New behavior:

- show theme slot swatches with names from the active theme;
- show the current deterministic default slot;
- reset means "remove override and return to deterministic slot";
- optional custom hex entry remains available;
- if a custom hex is active, clearly distinguish it from theme slots;
- Storybook stories should cover:
  - deterministic slot;
  - custom hex;
  - old-hex migration;
  - Kanagawa slot set;
  - Rose Pine Dawn slot set;
  - light brutal and glass skins.

### CSS contract

Move toward four token tiers:

1. Primitive palette tokens
   - curated color values per theme.
   - examples: `--kg-wave-bg0`, or only TypeScript-side primitives if CSS stays
     semantic.
2. Semantic role tokens
   - app-wide roles.
   - examples: `--surface`, `--fg`, `--rule`, `--accent`, `--success`.
3. Identity and data-viz tokens
   - `--identity-*`, `--status-*`, `--chart-*`.
4. Component tokens
   - only when app-wide semantics are not enough.
   - examples: `--activity-control-bg`, `--composer-send-border`,
     `--archived-room-bg`.

Avoid copying Kanagawa selector blocks per component. Prefer:

```css
.act-row {
  background: var(--activity-row-bg);
  border-color: var(--activity-row-border);
  box-shadow: var(--activity-row-shadow);
}
```

Then each theme changes:

```css
:root[data-theme="kanagawa-wave"] {
  --activity-row-bg: var(--surface-raised);
  --activity-row-border: var(--rule);
  --activity-row-shadow: 2px 2px 0 var(--shadow-color);
}
```

## Scope of work

### Phase 0: freeze inventory and contract decisions

Deliverables:

- Add this plan.
- Confirm `--accent` runtime behavior and either define it or document where it
  is defined.
- Add a small theme-token inventory script or extend `dead-css.mjs` to report:
  - raw hex values in `web/src`;
  - `var(--*)` references without definitions;
  - deprecated `agent.color` / `room.color` consumers;
  - theme-specific selector count by file.
- Document which existing Beads are superseded, narrowed, or still valid:
  - `sync-75p` remains the v1 static-tokenization history.
  - `sync-75p.8` is still open verification debt but does not cover identity.
  - `sync-08hm` and Kanagawa slices remain visual-retune work, but should avoid
    adding more per-component hex overrides once v2 starts.

Acceptance:

- audit script output checked into notes or issue comments;
- no code migration yet;
- Storybook and runtime theme axes documented.

### Phase 1: create the typed theme and identity module

Deliverables:

- `web/src/theme/ids.ts`
- `web/src/theme/palette.ts`
- `web/src/theme/identity.ts`
- `web/src/theme/contrast.ts`
- `web/src/theme/storage.ts`
- `web/src/theme/README.md`
- CSS variables for 16 identity slots in all current themes.
- Stable definitions for `--accent` and `--on-accent`.

Acceptance:

- root and web typecheck pass;
- every current theme defines the full identity slot set;
- no component behavior changes except additive CSS variables;
- a static validation test or script fails if a theme omits required variables.

### Phase 2: migrate data adapters and persistence

Deliverables:

- Extend `Agent` and `Room` types with `colorRef` or replace `color` after a
  compatibility window.
- Migrate `DaemonDataSource` peer/group color assignment from hex palette to
  deterministic identity slots.
- Migrate `MockDataSource`, seed data, spawned agent defaults, and archive
  fallbacks.
- Implement localStorage migration from old hex overrides.
- Keep raw hex custom overrides working as explicit custom refs.

Acceptance:

- old stored values do not crash or produce invisible colors;
- deterministic slot assignment is stable for the same peer/group id;
- DMs still inherit the other participant identity;
- archive recovery no longer falls back to `#111111`;
- tests cover slot assignment, old hex migration, invalid value fallback, and
  custom hex preservation.

### Phase 3: migrate identity primitives and component consumers

Deliverables:

- Update `IdentityBadge`, `IdentityText`, `Avatar`, `MentionChip`, and
  `IdentityLogoTile` to consume `IdentityColorRef`.
- Restrict direct `inkFor()` use to custom hex paths.
- Migrate consumers in:
  - `AgentRoster.tsx`
  - `MessageRow.tsx`
  - `Composer.tsx`
  - `Markdown.tsx`
  - `RoomHeader.tsx`
  - `Sidebar.tsx`
  - `ActivityItem.tsx`
  - `ActivityView.tsx`
  - `BoardView.tsx`
  - `ThreadPane.tsx`
  - `ThreadSummaryPanel.tsx`
  - `PollWidget.tsx`
  - `ArchiveRecovery.tsx`
- Update stories that currently hard-code old swatches.

Acceptance:

- `rg "agent\\.color|room\\.color|inkFor\\(" web/src/components web/src/data`
  returns only approved compatibility sites;
- all identity displays resolve through slot variables in normal paths;
- custom hex override still renders legibly;
- board progress bars and activity actor chips are deliberately assigned either
  identity slots or data-viz tokens, not accidental raw colors.

### Phase 4: replace component-specific Kanagawa patches with component tokens

Start with the highest-noise files:

- `components/activity.css`
- `skin-glass.css`
- `components/extra.css`
- `styles.css`

Deliverables:

- Activity control tokens for buttons, filters, row surfaces, latest strip,
  room list, badges, and identity tint.
- Composer tokens for container, separators, controls, send button, disabled
  state, placeholder.
- Sidebar/room tokens for archived state, active rooms, dock badges, and status
  borders.
- Reaction tokens for reaction chips and popovers.
- Code/syntax decision: either leave `code-light.css` as a syntax-theme module
  or fold it into theme component tokens. Do not leave it ambiguous.

Acceptance:

- adding a new palette should not require editing `activity.css` selector blocks;
- `skin-glass.css` no longer has to translate activity brutal literals back to
  glass values;
- hard-coded Kanagawa hexes are concentrated in theme definitions, not component
  CSS;
- no visual regression in current themes.

### Phase 5: simplify CSS and delete stale hooks

Deliverables:

- Re-run `dead-css.mjs`.
- Remove confirmed stale classes in small batches.
- Document intentional dynamic/reserved classes in the script allowlist instead
  of letting them appear as surprising dead candidates forever.
- Consider splitting the remaining CSS by ownership:
  - `styles/tokens.css`
  - `styles/theme-generated.css`
  - `styles/base.css`
  - `styles/shell.css`
  - `styles/components.css` or smaller component hooks
  - `styles/skins/glass.css`

Acceptance:

- dead candidate count falls materially or every candidate is documented;
- no component story or live view depends on removed hooks;
- CSS import order remains explicit in `styles/css.ts`.

### Phase 6: verification matrix

Automated gates:

- `bun run typecheck`
- `cd web && bun run typecheck`
- `cd web && bun run build`
- `cd web && bun run scripts/dead-css.mjs`
- Storybook build/test if available in the current branch.
- Targeted data tests for identity assignment and migration.

Visual gates:

- Storybook matrix:
  - light + brutal
  - rose-pine-dawn + brutal
  - kanagawa-wave + brutal
  - light + glass
  - rose-pine-dawn + glass
  - kanagawa-wave + glass
- Viewport matrix:
  - 390px compact
  - 820px medium
  - 1440px desktop
- Surface matrix:
  - main chat;
  - thread open;
  - composer with mention popup;
  - sidebar active room and archived room;
  - room header and member pile;
  - agent roster and color picker;
  - activity digest and flat timeline;
  - board view;
  - poll widget;
  - archive recovery fallback;
  - reaction picker/popover;
  - markdown code block.

Live gate:

- Use throwaway `SYNCHRONIZE_HOME`.
- Load `/web` against a daemon-backed source.
- Verify theme switching, skin switching, and persisted color migration against
  live localStorage keys.

## Edge cases

- Existing localStorage values may be old raw hex, invalid strings, or absent.
- Users can switch branches; the storage migration must tolerate old and new
  formats.
- Offline/historical authors may have no currently registered peer.
- Archive recovery constructs fallback agents and rooms without live data.
- DM rooms currently use the other participant color while group rooms use room
  color; preserve this.
- The local human/self identity uses special treatment (`identity-self`,
  `you-bg`, `you-fg`) and should not be accidentally assigned a random slot.
- Mention chips appear inside rich markdown and need line-height-safe styling.
- Board progress bars use assignee identity color as a progress fill; this may
  be too visually loud in some themes and should be explicitly decided.
- Activity "awaiting you" and presence colors are status semantics, not identity
  semantics.
- Glass skin mixes colors with transparency; foreground contrast must be checked
  against chat backgrounds.
- `color-mix()` support is assumed by existing code, but new tokens should keep
  fallbacks practical for critical text and controls.
- Highlight.js classes are external and should not be treated as dead CSS.
- Storybook stories must continue mounting through shared shell frames; do not
  create per-theme duplicate stories.

## Recommended library posture

Do not add a large theming UI library for this step.

The repo already has:

- CSS variables;
- Tailwind v4 variable-backed utilities;
- Storybook global theme/skin controls;
- typed React code;
- `cva`, `clsx`, and Base UI/Radix-adjacent primitives where useful.

Best near-term choice:

- hand-authored typed theme module;
- hand-authored or generated CSS variables;
- a small validation script for missing tokens and raw color leaks.

Possible later additions:

- Style Dictionary or DTCG JSON if theme count grows and generated outputs
  become useful.
- APCA/WCAG contrast tooling for identity slot foreground validation.
- A token visualizer Storybook page that renders every semantic, identity,
  status, component, and skin token.

Avoid for now:

- DaisyUI or a full component-theme framework. It would fight the custom product
  UI and current Storybook/shell contracts.
- A Base64-style fixed palette as the public API. It sounds structured but hides
  the real need: named semantic and component roles. Use 16 identity slots, but
  keep the broader theme as layered tokens.

## Expected effort

Small version: 2 to 3 focused days.

- Defines identity slots.
- Migrates data adapters and primitives.
- Leaves some component-specific CSS patches in place.
- Good enough to make Kanagawa agent colors coherent.

Robust version: 1.5 to 2.5 weeks.

- Adds typed module and validation scripts.
- Migrates data, primitives, picker, stories, and localStorage.
- Tokenizes activity/composer/sidebar patchwork.
- Deletes stale CSS.
- Runs full Storybook/live visual matrix.

Long-lived design-system version: 3 to 4 weeks.

- Adds generation from theme objects.
- Adds token visualizer.
- Adds visual regression screenshots.
- Fully reduces theme-specific component selectors.
- Makes new themes mostly data entry plus visual QA.

Recommended path: robust version, staged behind Beads. The identity slot
migration is the highest-value work; CSS deletion should follow after the slot
contract is proven.

## Beads to create

Create a new epic for v2 theme identity tokens rather than overloading
`sync-75p`. Link the old epic in the description as prior art.

Suggested issue tree:

- Epic: Web UI theme token system v2: identity palettes and component tokens.
- Task: Freeze token inventory and define `--accent` / identity contract.
- Task: Add typed theme and identity module.
- Task: Migrate data adapters, persistence, and localStorage color overrides.
- Task: Migrate identity primitives and component consumers.
- Task: Rebuild AgentColorPicker around theme slots and custom refs.
- Task: Tokenize activity, composer, sidebar, reaction, and archived-room
  component colors.
- Task: Delete confirmed stale CSS hooks and add token-leak checks.
- Task: Run Storybook and live theme verification matrix.

## Definition of done

- Agents and rooms use deterministic theme identity slots by default.
- Kanagawa, Rose Pine Dawn, and light each define curated identity palettes.
- User custom colors still work and are visually legible.
- No common UI path relies on the old brutalist hex sequence unless the active
  theme intentionally defines that sequence.
- New themes can be added without editing data adapters or identity consumers.
- Theme-specific component hex values are concentrated in the theme contract.
- Storybook and live `/web` both exercise the same theme/skin axes.
- The plan, Beads, and skill index entry are all committed together.
