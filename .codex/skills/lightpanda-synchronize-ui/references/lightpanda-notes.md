# Lightpanda Notes

## What Lightpanda Is Good For

- Loading the synchronize React app and executing JavaScript.
- Querying DOM text and controls.
- Exercising form fill, button click, and keyboard tab traversal.
- Running separate Lightpanda browser processes cheaply to simulate multiple local web surfaces.
- Connecting through Chrome DevTools Protocol (CDP).

## What It Is Not Good For

- Screenshots and pixel/visual comparison.
- CSS layout correctness, overflow, typography, or responsive geometry.
- Browser-extension/profile testing.
- Bugs that depend on Chromium/WebKit/Firefox rendering behavior.

## Local Requirements

- `lightpanda` installed and on `PATH`.
- Bun available. The bundled smoke script uses raw CDP because the current Lightpanda nightly can serve CDP directly even when Playwright's `connectOverCDP` handshake times out.
- synchronize daemon running and serving `/web`.
- web bundle built with `bun run web/build.ts`.

## Useful Commands

```bash
lightpanda version
lightpanda serve --host 127.0.0.1 --port 9222
bun run .codex/skills/lightpanda-synchronize-ui/scripts/web-ui-smoke.mjs --url http://127.0.0.1:58405/web
```

## Interpreting Failures

- If `load` or `domReady` fails, the app likely did not boot or Lightpanda lacks a required Web API.
- If `sessionPeerStable` fails, the daemon-owned local web identity endpoint is regressing.
- If native Tab dispatch does not move focus, treat it as a Lightpanda capability gap and inspect `keyboardFocusableTraversalSynthetic`.
- If live message visibility fails but reload visibility passes, treat it as a Lightpanda SSE/live-refresh limitation, not necessarily an app regression.
- Current Lightpanda nightly supports one browser context and target per process, so the bundled smoke script uses two Lightpanda processes rather than two targets in one process.
