# Parity harness

Renders a frozen design-bundle reference and the current worktree implementation
side by side under identical viewport/theme, screenshots both per scene, and
pixel-diffs them into a ranked gap report. General-purpose: everything
design-version-specific lives in a manifest; the harness core knows nothing
about bundle structure.

## Model

Both sides of a scene are just **a URL that deterministically renders one view
in one theme**, plus an optional CSS `selector` (element-level screenshot) and
optional `setup` steps (clicks/eval to reach a state):

- **Reference** — the pulled design bundle (static mock or live-React app),
  served same-origin from `ds-bundle/` (gitignored).
- **Implementation** — the Storybook static build (`web/storybook-static`),
  driven per view via story id + `&globals=theme:...`. Stories carry mock data
  via the global decorator, so data is deterministic.

## Bootstrap: making a designer's design parity-ready

A design handed off by the designer does not compare against the app out of the
box — the two sides render different data, and the reference needs a few hooks.
These are the modifications the harness applies to onboard a new design. Do them
in order; each is idempotent.

1. **Pull the reference to disk.** See *Pulling reference files* below. Land the
   design's HTML + its `shared/*.js` under `ds-bundle/templates/<name>/`, and
   regenerate the shared fixtures with `bun web/scripts/export-fixtures.mjs`
   (emits `ds-bundle/fixtures/{base.js,merge.js}` the templates load).

2. **Write the manifest** (`manifests/<name>.json`) — the one design-specific
   file. `vars` (ref + impl URL templates), `themes`, `hideCss`, `staleness`,
   `implRootSelector`, `scenes`. See *Adding a scene* below.

3. **Match the data (uniform seed).** The reference renders the designer's
   curated world; the impl must render the *same* world or the pixel diff is
   just content drift. Three pieces make that happen:
   - The design must render from the shared fixture chain in **own-world** mode
     (`fixtures/base.js` → the template's `fixtures.active.js` overlay →
     `fixtures/merge.js` → `window.FIXTURES`). This is the designer's contract
     (`guidelines/parity-ready-bundle.md`); verify `FIXTURES.meta.mode`.
   - Convert that own-world overlay into an **app-shape seed** at
     `web/src/data/seeds/design-<name>.ts` (the 9 exports, typed like
     `web/src/data/seed.ts`; keep on-screen strings verbatim, normalize enums).
   - Point the manifest at it with `"implSeed": "web/src/data/seeds/design-<name>.ts"`.
     The runner (`parity-diff.mjs`) and viewer (`serve.mjs`) then inject it as
     `window.__PARITY_SEED__` into the Storybook iframe before its bundle runs.
     `MockDataSource` reads that global through an inert seam
     (`__PARITY_SEED__ ?? stableSeed`) — **stable Storybook is untouched**; the
     global is undefined in every normal render.

4. **Screen-label hooks.** Element-scoped scenes need the reference to tag each
   panel with `data-screen-label="<scene>"`. If a panel is unlabelled (a common
   designer residual), the scene can't be captured element-only — flag it back
   to the designer or scope the scene to a stable selector instead.

5. **Build + run.** `cd web && bun run storybook:build`, then `parity-diff.mjs`.
   The staleness guard hard-fails if the build lags `web/src`, so rebuild after
   any seam/seed change.

## Commands

```bash
cd web && bun run storybook:build        # refresh impl side (guard hard-fails if stale)
bun tools/parity/parity-diff.mjs         # full run: captures + diffs + reports
bun tools/parity/parity-diff.mjs --scene chat --theme dark   # one cell, fix-loop
bun tools/parity/serve.mjs               # interactive viewer at :8788 (split/ref/impl/onion)
                                         # Split auto-orients: wide scenes stack (each full-width),
                                         # narrow scenes sit side-by-side. Injects implSeed too.
```

Outputs land in `tools/parity/out/<manifest>/` (gitignored):
`report.json` (ranked % per scene×theme — the agent-facing fix backlog),
`report.html` (reg-cli interactive triptychs: side-by-side, slider, onion),
`ref/ impl/ diff/` PNGs.

## Adding a scene / a new design version

New scene = one manifest entry (both sides). New design version = pull its
files under `ds-bundle/` + write a new manifest in `manifests/`. No harness
code changes. Manifest reference: see `manifests/sigil-vs-aesthetic-rerun-r3.json`
— `vars` (URL templates), `themes` (per-side theme-name mapping), `hideCss`
(per-side review-chrome suppression), `staleness` (impl build guard), `scenes`.

## Honesty rules (carried from harness v1)

- The pixel % is recall-first: it says *where* to look, never *why*. Confirm
  every gap in the triptych before filing it.
- `report.json` prints the manifest's `caveats` (content drift, shift
  inflation, font-CDN dependency) — read them.
- The staleness guard hard-fails rather than warning: a stale impl build is
  the #1 source of false conclusions.

Deps (playwright, pixelmatch, pngjs, reg-cli) live in `web/` devDependencies.

## Pulling reference files (context discipline)

DesignSync `get_file` returns file bytes into the calling agent's context and
there is no fetch-to-disk path. Therefore: **the main session never pulls
template files itself.** Use the per-file pull command:

    tools/parity/pull-file.sh <projectPath> [outFile] [model] [expectedBytes]
    # model: luna (default, VibeProxy) | terra (VibeProxy) | sonnet (Anthropic)

It runs a headless low-effort Claude Code child with a complete, minimal
prompt (exact tool named — zero searching), writes bytes to
`ds-bundle/<path>`, and prints the sha256. Re-run to confirm determinism if a
pull looks suspect. The main session then verifies from disk (grep,
node --check, Playwright) — judgment reads at most the small files (overlay,
adapter), never the big HTML.

**Pick the model by file size** (pass the size from `list_files` as the 4th
arg — the script hard-fails past a model's ceiling instead of writing a
silently truncated file):

| size | pull with |
|---|---|
| `< 32 KiB` | `luna` (default) |
| `32 KiB – 256 KiB` | `terra` — `pull-file.sh <path> <out> terra <size>` |
| `≥ 256 KiB` | `mcp__claude_design__read_file` in the main session, then `node tools/parity/extract-tool-result.mjs <spilled.json> <out> --expect <size>` (the harness spills the large result to disk; the extractor unwraps + unescapes it — no model re-emits the bytes) |

Local disk must mirror the project layout the templates expect:
`ds-bundle/fixtures/base.js` + `ds-bundle/fixtures/merge.js`
(`export-fixtures.mjs` emits base; merge is tracked at tools/parity/fixtures-merge.js).
