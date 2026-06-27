# CSS ownership

Where styles live and why (sync-imeu.1.14). Keeps mode / theme / skin / component
concerns from cross-cutting each other.

## Layers (load order in `main.tsx`)

1. **`tw.css`** — Tailwind. The default for component styling: layout, spacing,
   color via role tokens, states. New/changed component styles go here, inline in
   the `.tsx` (optionally via a `cva()` for variants + `cn()` to compose).
2. **`styles/tokens.css`** — the **design-token contract**. The ONLY home for CSS
   custom properties. Two orthogonal axes: `:root[data-theme]` (palette) and
   `:root[data-skin]` (aesthetic). Components reference role tokens (`var(--ink)`),
   never raw hex. Skin/theme token values live here, even when Glass needs a
   completely different value set from Brutal.
3. **`styles.css`** — reset, base element styles (`body`, `kbd`, keyframes), and
   the component rules that are *not yet* migrated to inline Tailwind, plus the
   structural shell/layout rules and `[data-theme]` state overrides that need a
   real stylesheet. Reference tokens here; never redefine them.
4. **`components/extra.css`, `components/activity.css`** — component-scoped rules
   for the message/chat and activity surfaces.
5. **`skin-glass.css`** — the `[data-skin="glass"]` selector-behavior layer.
   Adds glass-only effects and component tuning that cannot be expressed as
   reusable role tokens. **`backdrop-filter` only on fixed chrome
   (sidebar/header/composer), never on scrolling lists** (WebView perf).
6. **`chat-bg.css`** — chat background presets.

## Rules of thumb

- **New styling → inline Tailwind** in the component. Reach for a `.css` file only
  for: `:root`/token defs (tokens.css), keyframes/base elements, `[data-theme]` /
  `[data-skin]` overrides, or a class that is a genuine skin/JS hook.
- **Theme identities → `src/theme/theme-registry.json`**, then run
  `bun run generate:theme-registry`. Do not hand-edit Storybook toolbar theme
  lists or `ThemeName` unions.
- **Before committing theme/CSS work**, run `bun run check:theme-contract`.
  `bun run check:theme-contract:strict` is the cleanup target; it fails on raw
  color leaks, undefined legacy vars, scoped variable definitions outside
  `tokens.css`, and theme selectors that are not explicitly skin-scoped.
- **A class kept only as a hook** (skin override target or `classList`/vim target)
  gets a one-line comment saying so, so it isn't mistaken for dead.
- **Mode is a capability, not a selector.** Prefer the `shellLayout()` contract
  (shell-mode.tsx) over `.shell-compact .foo` cascades where practical; raw
  `shell-*` / `data-shell-mode` classes are CSS hooks only.

## Dead-selector check

Run before committing CSS changes:

```bash
cd web && bun run scripts/dead-css.mjs   # lists class selectors with no .ts/.tsx reference
```

It's conservative (substring + known dynamic prefixes `shell-*`/`flash-*`), so its
hits are high-confidence dead. ~63 candidates remain by design — they're rules
whose selectors compound a dead class with a **live** one (e.g.
`.act-row-presence.status-busy`, where `status-busy` is built dynamically), an
element target, or a descendant; removing those needs manual judgement, not a
blind sweep. Verify any removal with `make verify-web` + a pixel check in both
skins before committing.
