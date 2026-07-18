# Handoff: Parity harness v2 + design-fixtures pipeline (Sigil)

Date: 2026-07-18 · Branch: `abhirup/ui-revamp-sigil-codex` · Status: POC complete, loop closed on the design side; impl-side seed adoption pending.

## Problem being solved

Design-sync designs (Claude Design project `41739566-4de3-4dda-90bc-a7777d50b42d`) use fresh, unconstrained components. Porting them into `web/` kept failing on small details — endless screenshot battles. The v1 parity harness was hard-coded to one design/worktree. We built a general-purpose v2 plus a data-parity pipeline so future design iterations are cheap to compare and port.

## What exists now (all tracked unless noted)

### 1. Parity harness — `tools/parity/`

- `parity-diff.mjs` — manifest-driven runner: Playwright screenshots both sides per scene×theme, pixelmatch diff (threshold 0.1, includeAA off), ranked `report.json` + reg-cli `report.html`. Hard staleness guard (impl storybook-static vs web/src mtimes). Deps resolve from `web/node_modules` via createRequire.
- `serve.mjs` + `index.html` — live viewer (Split/Ref/Impl/Onion modes, applies scene setup steps, outlines the diffed selector). `bun tools/parity/serve.mjs 8788`.
- `manifests/sigil-vs-aesthetic-rerun-r3.json` — the ONLY Sigil-specific file: ref = `ds-bundle/templates/aesthetic-rerun-r3/v2.html` (THE Sigil UI per `sigil/design.md`), impl = storybook iframe URLs. 6 scenes (whole-app, chat, chat-thread-open, thread-pane, activity, sidebar). New design version = new manifest, nothing else.
- `pull-file.sh` — per-file byte-faithful pull from the design project via a headless low-effort Claude Code child (`luna` default via VibeProxy :8318, `terra`, or `sonnet` — sonnet needs no env). Prints sha256. All three models verified byte-identical. NEVER pull design files in the main session's context (DesignSync get_file returns bytes into context; ~150k tokens wasted once this way). `pull.mjs` (direct MCP puller) was deleted — blocked by the server's `agent_design_projects` consent gate, which passes only for Claude Code's own client; DesignSync is a NATIVE Claude Code tool (not a claude.ai connector), which is why headless children can use it even with `ANTHROPIC_AUTH_TOKEN` set.
- `parity-ready-bundle.md` — tracked source of `guidelines/parity-ready-bundle.md` in the design project (upload via DesignSync after edits).
- `fixtures-merge.js` — tracked source of `fixtures/merge.js` in the design project.
- Gitignored: `ds-bundle/` (pulled refs + generated fixtures), `tools/parity/out/`.

### 2. Data-parity pipeline (Direction B, "own-world" mode)

Canonical data = `web/src/data/seed.ts` (stable seed; never edited during design iterations). Versioned iteration seeds go in `web/src/data/seeds/design-<name>.ts` (see its README).

- `web/scripts/export-fixtures.mjs` — dumps a seed to `ds-bundle/fixtures.json` + `ds-bundle/fixtures/{base.js,merge.js}` (mirrors design-project layout so pulled templates resolve `../../fixtures/*` locally). Deterministic: pins `Date.now` to epoch 2026-01-01T12:00Z. Stable-seed hash: `d61d3a2ac76ab1aa`.
- Design project carries `fixtures/base.js` (read-only to designer), `fixtures/merge.js` (id-upsert merge), and `guidelines/parity-ready-bundle.md`.
- Guideline defines two modes: `extend` (render base world + small overlay) and `own-world` (designer's curated world declared wholesale in the overlay, fixture schema). Overlay lives in the template's own folder (`templates/<name>/fixtures.active.js`) because `templates/` is the designer's only writable surface.

### 3. Designer's round-2 output — VERIFIED

The designer retrofitted `templates/aesthetic-rerun-r3/` to own-world mode. Render-tested with Playwright (12 checks): mode/hash/overlay flags correct; overlay text renders verbatim; board/artifacts now data-driven (inline arrays gone); view/mode/embed params work; deleting an overlay record removes it from the page. Pulled copies live in `ds-bundle/templates/aesthetic-rerun-r3/` (`fixtures.active.js`, `shared/content.js` adapter, `v2.html`).

Two residuals to send the designer:
1. `data-screen-label="sidebar"` still missing on `<aside class="side">`.
2. Thread pane synthesizes its parent-summary line in code instead of from fixture data (only untraceable string on any screen).

## Last diff numbers (data NOT yet matched — expect big drops after seed adoption)

dark/light %: whole-app 8.77/7.55 · chat 7.31/5.5 · chat-thread-open 8.76/7.05 · thread-pane 16.63/16.52 (real 40px width drift: impl 420 vs ref 380) · activity 4.03/3.97 · sidebar 6.21/6.43 (KNOWN major real drift — impl still renders the pre-Sigil sidebar). Pixel % is a ranking signal only; the onion/triptych view is the verification truth.

## Remaining work (bd issues filed)

1. Convert `ds-bundle/templates/aesthetic-rerun-r3/fixtures.active.js` → `web/src/data/seeds/design-sigil-r3.ts` (mechanical: same schema; designer's extras like `sigil`/`order`/`kind` flags can be kept or dropped; attachment payloads plan/doc have no app type yet).
2. Wire `MockDataSource` seed parameter + Storybook `dataset` toolbar global (constructor param defaulting to stable imports so existing stories stay bit-identical), then point manifest impl URLs at `&globals=dataset:design-sigil-r3`.
3. Re-run `bun tools/parity/parity-diff.mjs` with matched data; triage remaining real drift (sidebar redesign is the big one).
4. Send designer the two residual fixes above.

## Commands

```bash
bun web/scripts/export-fixtures.mjs [--seed design-<name>]   # seed -> fixtures
tools/parity/pull-file.sh <projectPath> [out] [luna|terra|sonnet]  # pull design file
cd web && bun run storybook:build                             # refresh impl side
bun tools/parity/parity-diff.mjs [--scene X --theme Y]        # diff (no piping through head!)
bun tools/parity/serve.mjs 8788                               # live viewer
```

## Gotchas

- Never edit the frozen reference; the manifest and impl are the mutable surfaces.
- Piping parity-diff through `head` SIGPIPEs the reg-cli step.
- Ref data epoch: content.js derives times from `FIXTURES.meta.epoch`.
- Uploads to the design project go through DesignSync finalize_plan → write_files (with localPath) from the main session — that direction is cheap; only downloads need `pull-file.sh`.
