---
name: lightpanda-synchronize-ui
description: "Use when Codex needs lightweight, headless validation of the synchronize web UI with Lightpanda: opening /web, exercising keyboard tab navigation, checking multi-tab/browser-context behavior, validating daemon-owned web session identity, and running fast DOM-level smoke tests without full Chrome or the Codex in-app browser."
---

# Lightpanda Synchronize UI

Use this skill for fast DOM-level checks of the synchronize web UI. It is not a visual regression tool: Lightpanda has no graphical renderer, so use the Codex in-app browser or real Playwright browsers for screenshots, layout, and CSS inspection.

## Quick Start

From the synchronize repo or worktree:

```bash
bun run web/build.ts
bun run .codex/skills/lightpanda-synchronize-ui/scripts/web-ui-smoke.mjs --url http://127.0.0.1:58405/web
```

The script starts two `lightpanda serve` processes, connects over raw CDP, opens one page in each lightweight browser to the same `/web` URL, tabs through focusable controls, sends a validation message from one page, and checks that the other page sees it.

## Workflow

1. Confirm the daemon is already running against the intended `SYNCHRONIZE_HOME`.
   - For existing local runtime, run `synchronize status` or `bun run src/cli.ts status`.
   - Do not run `make clean-slate`; this workflow intentionally preserves current daemon state.
2. Build the web bundle from the worktree under test.
3. Run `scripts/web-ui-smoke.mjs`.
4. Read the JSON result:
- `ok: true` means the lightweight browser path loaded `/web`, tab navigation found expected controls, repeated session resolution returned the same local web peer, and cross-tab message visibility worked.
   - `ok: false` includes failed checks, captured focus sequence, and body text snippets.
5. If the script fails due to unsupported browser APIs, confirm the behavior in the in-app browser or Playwright Chromium before treating it as an app regression.

## Use Cases

- **Multi-tab web identity:** use the default script. It checks `POST /web/session` id stability and DOM behavior across two contexts.
- **Keyboard/focus traversal:** inspect `focusSequence` in the JSON output. Expected controls include search, room controls, composer formatting buttons, attachment button, and send.
- **Fast CI smoke:** run the script after typecheck/build as a cheap pre-browser check.
- **Visual QA:** do not use this skill alone. Escalate to Codex in-app browser or Playwright Chromium.

## Resources

- `scripts/web-ui-smoke.mjs`: deterministic Lightpanda raw-CDP smoke harness.
- `references/lightpanda-notes.md`: local setup, limitations, and when to fall back to full browser testing.
