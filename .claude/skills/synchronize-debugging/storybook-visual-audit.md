# storybook-visual-audit.md

Use this for qualitative Storybook sweeps: visually inspect every component
state, identify broken UI, and save reference screenshots only for confirmed
failures.

## Goal

Find visual states that look broken to a user:

- overlapping or colliding controls
- unreadable or low-contrast text
- missing expected state from the story source
- wrong skin/theme/state rendered
- garbled content, broken layout, or shoddy dense-control regions

This is not a replacement for `test:storybook`. It is a human-quality pass over
the rendered final state.

## Setup

1. Start Storybook if needed:

   ```bash
   cd web && bun run storybook
   ```

2. Open the visible browser at:

   ```text
   http://localhost:6006
   ```

3. Enumerate stories from:

   ```text
   http://localhost:6006/index.json
   ```

4. Navigate focused previews with:

   ```text
   http://localhost:6006/iframe.html?id=<story-id>&viewMode=story
   ```

## Parallel Worker Capture

Parallel workers must avoid the shared in-app browser. Use isolated headless
access instead.

Static screenshot command verified in this repo:

```bash
bunx playwright screenshot --viewport-size=1280,720 \
  'http://localhost:6006/iframe.html?id=<story-id>&viewMode=story' \
  /tmp/<story-id>.png
```

Multiple `bunx playwright screenshot` processes can hit the same Storybook
server in parallel because each process launches its own headless browser. This
is safe for static final-state screenshots and does not move the user's in-app
browser tab.

For interaction-heavy stories, use an isolated Playwright context/process. If
the local Playwright module is not resolvable, do not fall back to the shared
in-app browser; mark that bucket blocked/suspect or run the interaction serially
in the parent visible browser.

## Audit Protocol

For each story:

1. Read the matching `*.stories.tsx` source before judging. The comments, args,
   `render`, and `play` function define the intended state.
2. Decide the correct final stable state:
   - Static stories: judge the settled initial render.
   - `play` stories: wait for the play function to finish, then judge the
     post-play stable state.
   - Interaction-preview stories: perform the intended interaction first, then
     judge the result. Examples: right-click context-menu targets, click
     add-reaction buttons, open sheets/dialogs.
3. Capture a temporary screenshot and visually inspect it.
4. Verify ambiguous missing-state failures with DOM evidence. For example, if a
   story says reactions should render, check for reaction buttons or footer
   nodes before filing.
5. Save screenshots only for confirmed failures. Keep pass screenshots
   temporary.
6. Add a note for each confirmed failure with:
   - story id
   - expected state from source
   - observed failure
   - severity score from 1 to 5
   - screenshot path
   - any uncertainty or required follow-up

## Severity Scale

Use a 1-5 score for every confirmed failure:

- 1: Minor polish issue. UI is usable and understandable.
- 2: Noticeable visual defect, but the main task is still clear.
- 3: Meaningful quality issue. Some content/control is hard to read or a story
  fails to demonstrate an intended state.
- 4: Major breakage. Important content/control is missing, unreadable, or
  substantially overlapping.
- 5: Unusable. The component/story cannot be understood or operated in this
  state.

## False Positive Traps

- In-app browser screenshots can falsely clip far-right content. Do not file
  right-edge clipping unless the visible browser also shows it or the component
  is internally overlapping.
- Do not let parallel agents share the same in-app browser tab. It creates race
  conditions and invalidates visual judgments. Parallel workers must use
  isolated browser contexts/processes, or report the bucket as blocked/suspect.
- Story names alone are insufficient. Some interaction stories complete their
  interaction in `play`, so the final stable state may intentionally hide the
  transient popup.
- Main content can pass while dense peripheral controls fail. Inspect headers,
  agent/member piles, banners, tab rows, and footer controls carefully.
- A wrong theme or skin is a valid failure even when the layout is readable.
  Example: a `skin: "glass"` story that still renders with brutal styling.
- Do not judge responsive modes from desktop captures. Keep desktop, compact,
  and medium passes separate. Compact is the priority; medium can be skipped if
  time is tight.
- During a desktop pass, skip stories whose purpose is explicitly compact or
  medium responsive validation. Put them in a deferred compact/responsive list
  instead of filing them as failures.
- If the pass is scoped to one theme, do not file findings for other themes in
  the confirmed list. Put them in a separate deferred theme section even when
  the mismatch is real.

## Current Run Learnings

- Save only confirmed failure screenshots in the audit artifact directory.
- If the user disputes a screenshot artifact, recalibrate against the visible
  browser and remove false-positive saved screenshots.
- For missing expected UI, use the story code plus DOM checks. This catches
  failures like reactions that are expected by source comments but absent from
  the render.
- For play stories, the desired screenshot is usually the final post-play state,
  not the first frame after navigation.
- Responsive story names matter. A compact/medium story viewed while the browser
  is still in desktop mode is not a valid failure for the desktop pass.
- If subagents are used, require each report to state whether it used a shared
  in-app browser or an isolated browser. Do not merge findings from workers that
  cannot prove isolated visual capture.
- For compact/mobile audits, inspect source from the active responsive worktree
  if it differs from the master worktree. The report should name the exact
  worktree, port, viewport, and screenshot prefix it used.
- Keep the audit folder fix-ready: provide a top-level index, bucket reports,
  and screenshots referenced from the documents. Mark superseded or blocked
  reports clearly so future agents do not treat them as final evidence.
