# Parity bootstrap — working notes (raw; fold into README Bootstrap section later)

Purpose: capture the real flow + the gaps that made it "random", so the eventual
Bootstrap section is general-purpose and deterministic. NOT the final doc.

## The flow (as the user frames it)

1. **Pull** the design reference into the harness (design files → `ds-bundle/`).
2. **Align** so Storybook-level parity can work:
   - 2a. Align the *reference* to the harness (own-world fixtures, screen labels).
   - 2b. Align the *harness/impl* to the reference (manifest, seed injection,
         scene selectors, and — when the design demands — impl changes).
3. **Run** the harness (diff + viewer) and read results.

Human-in-the-loop is a REQUIREMENT, not a nicety: the agent consults the human
at each decision fork (what to fix vs accept vs align). Bake that in.

## The core insight the flow was missing

There are TWO kinds of parity, and they must be established in order:
- **Structural / state parity** — do both sides render the SAME components in the
  SAME state? (thread open vs closed; rail present vs absent; which view.)
- **Visual / styling parity** — given identical structure, how far off is styling?

The pixel diff only measures the second. If structure/state differ, the % is
noise. The flow currently jumps straight to the pixel diff with no gated
structural checkpoint — so mismatches (timeline rail, thread-open, mis-scoped
selectors) were found by eyeballing, not systematically. **Add an explicit
structural-alignment gate between step 2 and step 3.**

## Gaps found this session (each → a determinism fix)

1. **Pull is manual per-file.** Had to hand-enumerate v2.html's `<script src>`
   deps. FIX: a "pull template" step that parses the reference HTML's local
   asset graph and pulls all deps, auto-selecting the model by size
   (list_files gives sizes; tiered guard already exists).

2. **No structural-parity checkpoint.** FIX: per scene, dump each side's
   `data-screen-label` (or top-level component) inventory and require they match
   (or be explicitly waived) before trusting the %. Fail loud like the staleness
   guard. This is the codified version of the manual image audit.

3. **Story/seed-id coupling breaks silently.** Stories hardcode seed ids
   (`parentId: "m2"`) that vanish under an injected design seed → pane renders
   empty, selector times out. FIX (constraint): parity-driving stories must reach
   state by interaction/args, not hardcoded ids; drive via URL `args=` override
   or a seed-agnostic click.

4. **Overlay→app-seed conversion is ad hoc.** Enum/field normalization
   (status/role/kind maps, timestamp offset-from-epoch, dropping designer extras)
   was decided case-by-case. FIX: write the normalization rules down once.

5. **Selectors chosen by hand, mismatches invisible.** `.main` (ref, chat+thread)
   vs `main` (impl, chat-only) diffed structurally-different subtrees. FIX: the
   structural checkpoint (gap 2) catches this; also prefer selectors that capture
   equivalent components, and use the viewer's Crop mode to confirm.

## Human-in-the-loop decision matrix (per structural mismatch)

After the structural audit, the agent presents each mismatch categorized, and the
human rules per item:
- **state-fixable** → align in the harness (e.g. open the thread). Agent does it.
- **real design gap** → the impl must change (the actual revamp). Human decides
  whether to fix now or file (e.g. timeline rail → remove; sidebar → accept-as-gap).
- **accept** → known, waived; record it as a manifest caveat so the % isn't
  mistaken for a styling defect.

## Session decisions (examples, not the general rule)
- timeline rail: REMOVE from the impl entirely (design has none).
- sidebar: ACCEPT as a known gap (fundamentally different, not fixing now).
- whole-app + chat-thread-open: STATE-FIX (render thread-open on both sides).
