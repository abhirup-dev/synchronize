# Handoff: Glass-skin Parity Harness (reference-vs-implementation pixel diff)

## Session Metadata
- Created: 2026-07-04 10:26:31
- Project: /Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-design-sync
- Branch: feat-design-sync
- Session duration: ~1 long session

### Recent Commits (for context)
  - fcb5bb8 fix(thread): group consecutive same-sender replies
  - d9ef7f6 fix(glass): vivid dark identity palette + more author-group spacing
  - 87fc319 fix(glass): revert floating-overlay headers + room-tabs rail (broke layout)

## Handoff Chain
- **Continues from**: None (standalone — the auto-linked multi-machine handoff is unrelated).
- **Supersedes**: None.

## Current State Summary

We built a **visual parity harness** that renders the frozen Claude-design "glass skin"
reference **side-by-side** with the current worktree implementation, using the **same mock
data**, so we can find every place the implementation drifts from the design. It works
end-to-end: a Playwright pixel-diff ranks components by % of differing pixels and emits
`ref | impl | diff` triptychs. We verified by eye that the top divergences it reports are
REAL (not harness artifacts). No divergence *fixes* have been applied yet — the next phase
is cataloguing the rest and then fixing (palette direction already decided: match reference).

Everything lives in the **gitignored** `ds-bundle/parity/` dir (except one tracked change:
a `Responsive` story added to `web/src/components/Shell.stories.tsx`).

## Important Context

The single most important thing: **the reference side is the genuine design bundle
(`_ds_bundle.js`), verified byte-identical, so "reference" == the golden 1:1.** The whole tool
is only trustworthy because of the guardrails in the "How we know it's NOT giving faulty
deductions" section — read that before believing any diff %. The pixel-diff is RECALL-first:
its % ranks where to look, but you MUST open the `ref | impl | diff` triptych to confirm the
cause (positional shifts inflate %). `impl.css` and `impl-bundle.js` are COPIES/BUILDS that go
stale — re-generate them after any component/CSS change or the impl side lies. Palette
direction is decided: **match the reference (muted)**.

## Immediate Next Steps

1. Catalogue the remaining atoms (message-self, message-group, avatar, identity-badge,
   agent-preview): open their triptychs in `ds-bundle/parity/diff-out/`, confirm each is real.
2. Start fixing in `web/src/styles/tokens.css` + `web/src/skin-glass.css`, highest-value first:
   identity palette → muted; board header hide (glass-e2e.css §12); composer surface + gold
   SEND; room-header emoji tile.
3. After each fix: rebuild Storybook → re-copy `impl.css` → rebuild `impl-bundle.js` → re-run
   `node ds-bundle/parity/pixel-diff.mjs` → confirm % dropped and triptych is clean.

## Codebase Understanding

### The two-layer skin architecture (why this harness is even possible)
- There are **no separate `*Glass` components**. The glass skin is a pure **CSS token
  re-skin** of the SAME base components, gated on `<html data-skin="glass">`
  (+ `data-theme="kanagawa-wave"` for dark). `ChatViewGlass` etc. are aliases.
- Therefore reference and implementation render the **same component source**; the
  divergence is almost entirely **CSS token values** (`tokens.css` + `skin-glass.css` in the
  worktree vs the frozen `glass-variants.css` + `glass-e2e.css` in the reference), plus a
  little app-level composition and some component-source drift.

### Where the reference comes from
- The reference is the claude.ai/design project `41739566-4de3-4dda-90bc-a7777d50b42d`,
  pulled locally into `ds-bundle/` via the `DesignSync` tool + `/design-sync` skill.
- The runnable reference is `ds-bundle/templates/glass-skin-revamp-e2e/app.html`: a
  zero-build page that loads React + `ds-bundle/_ds_bundle.js` (the REAL compiled components,
  `window.SynchronizeWeb.*`), skinned by `glass-variants.css` + `glass-e2e.css`, seeded by
  `seed-e2e.js`, wired by `app.jsx`. Default config = `variant=mono, theme=dark, bg=mesh` —
  exactly the shipped scope.

### Critical Files
| File | Purpose | Relevance |
|------|---------|-----------|
| `ds-bundle/parity/index.html` | The harness UI: scene picker, Split/Ref-only/Impl-only views, width + theme controls, two iframes | entry point — open in browser |
| `ds-bundle/parity/ref-atom.html` | REFERENCE micro-page: renders one bundle component with frozen glass CSS + shared fixture | reference side of atoms |
| `ds-bundle/parity/impl-atom.html` | IMPL micro-page: renders one impl-bundle component with worktree CSS + shared fixture | impl side of atoms |
| `ds-bundle/parity/atom-render.js` | SHARED render logic (identical on both sides); reads `window.__SW` + `window.PARITY`, renders `?comp=` | the symmetry guarantee |
| `ds-bundle/parity/fixtures.js` | SHARED mock data (`window.PARITY`): message content + a runtime blob + `seedInto(ds)` | identical-data guarantee |
| `ds-bundle/parity/reassert-glass.js` | Re-asserts `data-skin=glass`/theme AFTER the bundle resets them; pins `--chat-text-scale:1` | both micro-pages |
| `ds-bundle/parity/parity-frame.css` | Identical framing + Google Fonts `@import` (Space Grotesk etc.) on both sides | font/zoom normalization |
| `ds-bundle/parity/impl-bundle.js` | Current worktree components compiled to `window.SynchronizeWebImpl` (esbuild) | impl side rendering |
| `ds-bundle/parity/impl.css` | COPY of Storybook's compiled CSS (tokens+skin-glass+tailwind+component css) | impl styling |
| `ds-bundle/parity/build/` | esbuild shims (`react.js`, `react-dom.js`, `jsx-runtime.js`, …) + `impl-entry.mjs` | rebuild impl-bundle |
| `ds-bundle/parity/pixel-diff.mjs` | Playwright+pngjs: screenshots both sides, diffs, ranks %, writes triptychs to `diff-out/` | the divergence detector |
| `ds-bundle/templates/glass-skin-revamp-e2e/*` | The frozen reference app (app.html/jsx, seed-e2e.js, glass-variants.css, glass-e2e.css, revised/*) | golden source |

## How the tool was BUILT (chronological, so it can be rebuilt)

1. **Located the reference.** `ds-bundle/` holds the pulled design project. The runnable
   golden is `templates/glass-skin-revamp-e2e/app.html`. Its content files (`app.jsx`,
   `seed-e2e.js`, `glass-e2e.css`, `revised/*.jsx`) were NOT on disk — only `glass-variants.css`
   + `support.js` had been pulled. Fetched the rest via `DesignSync(get_file)`.
2. **Wrote them to disk byte-faithfully.** Each fetched file's JSON string was piped through
   `JSON.parse` (deterministic un-escape) rather than hand-transcribed. Then **re-fetched and
   byte-diffed** every file — this CAUGHT one real transcription drop in `glass-e2e.css`
   (a dropped `()` in a comment), which was fixed. `HistoryRail.jsx` is a deliberate **no-op
   stub** (out of scope; no impl counterpart) so `app.html`/`app.jsx` stay unedited.
3. **Rebuilt Storybook static** (`cd web && ./node_modules/.bin/storybook build -o storybook-static`)
   because the impl side reads its compiled CSS from there, and it was stale.
4. **Built the impl bundle** so both sides are symmetric micro-pages (not "reference app vs
   Storybook", which mismatches framing/data). esbuild compiles `web/.ds-entry.tsx` +
   `.ds-providers.tsx` into an IIFE global `SynchronizeWebImpl`, with `react`/`react-dom`/
   `react/jsx-runtime` aliased to shims in `build/` that re-export `window.React`/`ReactDOM`
   (the reference bundle externalizes React the same way; `_vendor/react.js` provides both).
5. **Shared fixture + shared renderer.** `fixtures.js` pins the MESSAGE content only;
   `atom-render.js` (identical file loaded by both pages) sets `S = window.__SW` (the bundle
   namespace each page assigns) and renders the requested component. This makes data +
   framing identical; only the component build + CSS layer differ.
6. **Pixel diff.** `pixel-diff.mjs` loads `ref-atom` and `impl-atom` per component at a fixed
   viewport, screenshots, computes per-pixel euclidean color distance (threshold 40), counts
   differing pixels, and writes a `ref | impl | diff` triptych (diff pixels painted red over a
   faded reference backdrop).

## How the tool is SUPPOSED TO WORK (operating instructions)

**Start the static server (serves the repo root):**
```bash
cd /Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-design-sync
python3 -m http.server 8777 --bind 127.0.0.1   # background it
```

**Interactive harness:** open `http://127.0.0.1:8777/ds-bundle/parity/index.html` (non-headless
Chrome). Controls: **Scene** (Whole app + per-atom), **Width** (1440→390 / Fit), **Theme**
(Dark/Light), **View** (Split / Ref only / Impl only — the last two go full-width so you can
cascade screenshots).

**Automated divergence sweep:**
```bash
cd web && node ../ds-bundle/parity/pixel-diff.mjs
# ranked % printed; triptychs -> ds-bundle/parity/diff-out/*.png  (read them to verify)
```

**Atoms available** (shared-fixture, pixel-diffable): message-agent, message-self,
message-group, avatar, identity-badge, agent-preview, room-header, composer, board.
The **Whole app** scene drives the real reference app vs the impl Shell — both interactive;
navigate each to the same state to compare full composition.

## How we know it's NOT giving faulty deductions (guardrails)

This is the section to trust — the harness earns credibility from these checks:

1. **The reference is the REAL bundle, verified byte-identical.** The reference side loads the
   genuine `_ds_bundle.js` (the actual design components), not a reimplementation. Every
   reference source file was re-fetched and `diff`ed against disk; the one drift found was
   fixed. So "reference" == the design bundle, 1:1.
2. **Identical data by construction.** Both sides load the SAME `fixtures.js` and the SAME
   `atom-render.js`. Message content is pinned; the ONLY intentional per-side difference is
   agents/room identity (the two Avatars consume identity differently — see gotchas — which is
   a real divergence, not noise).
3. **Identical framing + fonts + zoom.** Same `parity-frame.css` (same padding, same Google
   Fonts) and `--chat-text-scale:1` on both, so text metrics match. Measured: body font =
   "Space Grotesk" on both.
4. **Recall-first, then human verify.** The pixel diff is tuned for RECALL (any visual delta
   > threshold shows red). Because that inflates % on positional shifts, **you MUST open the
   triptych** and confirm the cause before trusting a number. We did this for the top 4
   (composer, board, room-header, message-agent) — all confirmed REAL.
5. **Numeric cross-check.** Beyond pixels, `atom-render`-rendered components can be measured
   via `getComputedStyle` (we did this for the avatar/pill: exact hex, radius, size, font),
   which corroborated the pixel finding independently.
6. **Known false-positive sources are documented** (below) so a number is never taken at face
   value.

### Known measurement caveats (don't over-read these)
- **Positional shift inflation.** If one side has an extra header row (e.g. board), everything
  below shifts and the % balloons (board 19%, composer 37%). The % ranks attention; the
  triptych tells you the true cause. Precision is deliberately secondary to recall.
- **`impl.css` staleness.** It's a COPY of Storybook's compiled CSS. After ANY component/CSS
  change you MUST `cd web && ./node_modules/.bin/storybook build -o storybook-static` then
  re-copy `web/storybook-static/assets/iframe-*.css` → `ds-bundle/parity/impl.css`, else the
  impl side shows stale styling (false "no divergence" or false divergence).
- **`impl-bundle.js` staleness.** Rebuild it (esbuild via `build/` shims) after component
  source changes, else the impl side renders old component logic.
- **Reference bundle may be a pre-port snapshot.** Some divergences are component-LOGIC drift
  (I changed a component since the bundle was built), not CSS. Note which is which when fixing;
  do NOT "fix" the reference to match — the reference is the golden.
- **Light mode** may show a `data-theme` handling difference (reference removes `data-theme`
  for light; Storybook sets `data-theme=light`). Treat light-mode diffs cautiously.

## Errors & Divergences FOUND so far

### Harness wiring bugs (found + FIXED during the build)
- Reference atoms rendered **brutal/light** because the bundle's `.ds-providers` resets
  `data-skin`/`data-theme` at load. Fixed with `reassert-glass.js` + a MutationObserver.
- `MessageRow` crashed (`ArchiveRecoveryProvider missing`) — added it to the provider chain.
- Impl `App-Shell` rendered brutal (App re-asserts its persisted skin) — the harness now
  re-asserts glass into the same-origin impl iframe (`implLockGlass`).
- Fixture initially omitted `agent.color`, crashing the reference `Avatar`'s luminance calc
  (`relLum(undefined)`). Fixed by keeping each side's OWN agents and pinning only messages.

### REAL implementation-vs-reference divergences (verified by eye — the fix backlog)
Ranked by pixel-diff attention; all confirmed real via triptych:
1. **composer (37%)** — reference composer surface is LIGHTER; SEND button is GOLD-accented.
   Impl: darker surface, plain grey SEND.
2. **board (19%)** — reference glass **HIDES the KANBAN header** (`glass-e2e.css §12:
   .board-header{display:none}`; filters move to the floating header). Impl still shows the
   KANBAN header + brutalist filter chips. → impl never ported that hide rule.
3. **room-header (2.3%)** — reference: neutral emoji tile, a **"3/5 working" + agent-avatar
   cluster**, and an **icon-collapsed tab rail** (active=labeled, inactive=icon). Impl: GOLD
   emoji tile, no working cluster, all-text tabs. (Mix of CSS + component drift.)
4. **message-agent (1.3%)** — **identity palette**: avatar + author pill are reference MUTED
   `#354F9B` with LIGHT text vs impl VIVID `#4D8DFF` with DARK text. This is the user's
   original avatar complaint, traced to `--identity-0-bg` / `--identity-0-fg` in the glass-dark
   token block. Avatar SHAPE/size are identical (both 34px, 14px radius) — it was never shape.
5. **message-self / message-group / avatar / identity-badge / agent-preview (0.5–1.4%)** —
   flagged, same palette family; NOT yet individually eyeballed. **Catalogue these next.**

### DECISION already made
- **Palette: match the reference (muted).** The vivid palette was an earlier response to
  "make colors pop", but the frozen reference is muted, so parity wins. When fixing, revert
  the glass-dark identity tokens toward the reference values.

## Known Tool Issues & Limitations

Be honest about these when reading results — grouped by impact.

### A. Can make a finding misleading (correctness) — OPEN
- **% is an attention-ranker, not a severity score.** A 1px shift (extra header row) turns
  everything below red → composer 37% / board 20% are mostly *shift*, not *style*. Always open
  the triptych to confirm cause.
- **Text goes fully-red on any sub-pixel shift** — can't distinguish "bubble moved 2px" from
  "text restyled". Low precision on text.
- **Reference bundle is a pre-port snapshot** → some divergences are my *newer* component-logic
  changes vs the old bundle, not CSS drift (e.g. room-header cluster/tabs). Don't "fix" the
  reference; decide per-finding whether it's CSS or component drift.
- **Identity consumed differently per side** (reference Avatar reads `agent.color`→luminance;
  impl reads `colorRef`→tokens). Real divergence, but the harness can't fully isolate
  token-value vs consumption-logic.
- **Atoms use hand-wired props** (my `atom-render.js`), not necessarily the app's real usage;
  only the whole-app scene is unambiguous.
- **Light mode has a built-in skew** (reference drops `data-theme`; impl sets
  `data-theme=light`). Trust dark-mode results more.
- **`--chat-text-scale` force-pinned to 1.0** on both (reference default is 0.9), so the tool
  deliberately cannot detect text-scale parity issues.

### B. Coverage gaps (silent false-negatives) — OPEN
- **Only 9 atoms + whole-app wired.** Sidebar, ActivityView, ThreadPane, ThreadSummaryPanel,
  PollWidget, attachments, dialogs, context menus, compact/mobile chrome are NOT covered.
- **Default render only** — no hover/focus/active/expanded-rail/open-menu states.
- **Whole-app scene isn't auto-diffable** (manual side-by-side only).
- **Diff threshold (40) is uncalibrated.**

### C. Operational fragility — FIXED this session
- **[FIXED #11] Stale copies.** `impl.css`/`impl-bundle.js`/`atom-render.compiled.js` are
  snapshots. Now: one-command `bash ds-bundle/parity/build-impl.sh` regenerates all three, and
  `pixel-diff.mjs` prints a loud STALE warning if `web/src` is newer than the artifacts.
- **[FIXED #12/#13] Babel/CDN + transpile flakiness.** The micro-pages no longer transpile JSX
  in-browser or fetch Babel from unpkg — `atom-render.js` is precompiled to
  `atom-render.compiled.js` (esbuild). (The reference `app.html` full-app scene still uses
  unpkg Babel — it's the golden file, left unedited; needs network only for that scene.)
- **[FIXED #14] Background mesh asymmetry.** `parity-frame.css` now forces a flat backdrop on
  both sides so the ambient mesh (impl-only) stops adding false edge noise. Verified: impl
  message-agent backdrop is now flat black, matching the reference.
- **[still present] Playwright launch occasionally hangs** under repeated headless launches
  (saw one 2-min timeout) — infra flakiness, just re-run.
- **[still present] Fonts load from Google CDN** — but both sides use the same CDN, so a
  failure degrades both identically (no false divergence); not a correctness risk.

## Pending Work

### Immediate Next Steps
1. **Catalogue the remaining atoms** (message-self, message-group, avatar, identity-badge,
   agent-preview): open their triptychs in `ds-bundle/parity/diff-out/`, confirm each real
   divergence, add to the backlog.
2. **Start fixing** (in `web/src/styles/tokens.css` + `web/src/skin-glass.css`), highest-value first:
   - identity palette → muted (`--identity-*-bg`/`-fg` in the glass `kanagawa-wave` block).
   - board: port the `.board-header { display:none }` glass rule (glass-e2e.css §12) into `skin-glass.css`.
   - composer: surface lightness + gold SEND accent.
   - room-header: emoji tile neutralization; verify working-cluster/tab-rail (may be component drift).
3. After each fix: rebuild Storybook, re-copy `impl.css`, re-run `pixel-diff.mjs`, confirm the % dropped and the triptych is clean.

### Blockers/Open Questions
- Whether the room-header working-cluster/tab differences are CSS or component-source drift
  (the reference bundle predates recent RoomHeader edits). Inspect before "fixing".

### Deferred Items
- History rail (stubbed out — out of scope).
- Full-app (whole shell) pixel diff — currently only the interactive Split view; app-level
  pixel diff would need the app driven to matched state on both sides.

## Environment State

### Tools/Services
- Static server: `python3 -m http.server 8777 --bind 127.0.0.1` from repo root (serves
  `/ds-bundle/...` and `/web/storybook-static/...` same-origin).
- Playwright (headed or headless) resolved from `web/node_modules/playwright` (CommonJS —
  import via `import pw from ".../playwright/index.js"; const { chromium } = pw;`). `pngjs`
  from `web/node_modules/pngjs`. No `pixelmatch` (diff is hand-rolled).
- esbuild `web/node_modules/.bin/esbuild` (0.28.1) for the impl bundle.
- The reference `app.html` + both micro-pages pull Babel standalone from unpkg → **needs
  network**. Fonts also come from Google Fonts CDN.

### Active Processes
- A `python3 -m http.server 8777` may be running from this session. Restart if `curl
  http://127.0.0.1:8777/` fails.

### Environment Variables
- None required for the harness. (Daemon envs like `SYNCHRONIZE_HOME` are unrelated.)

## Related Resources
- Reference project: claude.ai/design `41739566-4de3-4dda-90bc-a7777d50b42d`
- `ds-bundle/templates/glass-skin-revamp-e2e/ARCHITECTURE.md` — the reference's own design notes
- `glass-skin-revamp-sync-pull-handoff.md` — how the reference was pulled local
- `docs/plans/glass-skin-revamp-port.md` — the original 5-phase port plan
