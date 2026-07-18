# CSS ownership

Where styles live and why (sync-imeu.1.14). Keeps mode / theme / skin / component
concerns from cross-cutting each other.

## Layers (load order in `main.tsx`)

1. **`tw.css`** — Tailwind. The default for component styling: layout, spacing,
   color via role tokens, states. New/changed component styles go here, inline in
   the `.tsx` (optionally via a `cva()` for variants + `cn()` to compose).
2. **`styles/tokens.css`** — the **design-token contract**. The ONLY home for CSS
   custom properties. Two orthogonal axes: `:root[data-theme]` (palette) and
   `:root[data-skin]` (aesthetic; Sigil is the sole skin). Components reference
   role tokens (`var(--ink)`), never raw hex.
3. **`styles.css`** — reset, base element styles (`body`, `kbd`, keyframes), the
   component rules that are *not yet* migrated to inline Tailwind, the structural
   shell/layout rules and `[data-theme]` state overrides, and the folded
   Sigil shell/identity/overlay composition (the `:root`-prefixed section at the
   end). Reference tokens here; never redefine them.
4. **`components/extra.css`, `components/activity.css`, `components/rail.css`** —
   component-scoped rules for the message/chat, activity, and rail surfaces, each
   ending with its folded Sigil composition section. There is no separate skin
   file: Sigil's selector behavior lives with the components it styles.

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
  The local pre-commit hook runs strict mode automatically when staged changes
  touch `web/src`, Storybook, or theme tooling files. Use
  `scripts/precommit-theme-contract.sh --force` to run the same guard manually.
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

## Class extraction audit

Run before writing class-string codemods:

```bash
cd web && bun run audit:class-strings
```

This reports exact repeated utility bundles and frequent utility tokens in TS/TSX
files. Treat the output as an extraction queue for CVA helpers, component props,
or Base UI wrappers; do not blindly rewrite hook classes that are still consumed
by `skin-glass.css`, Storybook flows, keyboard navigation, or descendant CSS.
