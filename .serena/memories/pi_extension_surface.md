# Pi Extension Surface Series

Covers Pi adapter updates after the original Pi extension memory. Search terms: Pi, extension, daemon rediscovery, SYNCHRONIZE_SESSION_NAME, subscription, delivery.

## Architecture reminder

`extensions/pi-synchronize/` is a co-versioned but out-of-tree adapter. Pi loads `src/index.ts` directly and the extension ships its own REST client because it cannot assume the root workspace runtime.

Important files:

- `src/index.ts` — extension entrypoint; registers session and starts subscription.
- `src/client.ts` — local REST client and daemon discovery mirror.
- `src/subscription.ts` — callback HTTP subscription, like the Claude-channel pattern.
- `src/delivery.ts` — maps daemon events to Pi `sendUserMessage` calls.
- `src/identity.ts` — resolves session/peer naming.
- `src/log.ts` — always-on file logging under `~/.synchronize/pi-extension.log`.

## Recent behavior changes

The Pi extension now rediscoveres the daemon URL on transport error. This prevents stale `daemon.json` / daemon restart issues from permanently breaking the extension until the host process restarts.

`src/index.ts` honors `SYNCHRONIZE_SESSION_NAME` over the Pi session id fallback. This is important for deterministic integration tests and for operators who want stable names.

The extension participates in agent-session registration/correlation, so server-side `/agent-sessions` can show Pi native session bindings.

## Delivery semantics

Events arrive in Pi as user messages, not native MCP notification payloads. Skills under `skills/synchronize-pi/` instruct Pi agents how to respond to injected synchronize events.

Thread and mention semantics are daemon-owned. Pi receives whatever the daemon delivers through the subscription path; Pi should not attempt to recompute group policy locally.

## Tests and harnesses

- `extensions/pi-synchronize/tests/subscription.test.ts` covers subscription behavior.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py` validates real Pi MCP DM workflow.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_group_policy.py` validates group policy from Pi agents.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_thread_baton.py` validates multi-agent thread/mention baton behavior.

## Operational debugging

Use `tail -F ~/.synchronize/pi-extension.log` when debugging Pi extension delivery. If delivery fails after daemon restarts, inspect rediscovery behavior in `extensions/pi-synchronize/src/client.ts` and `src/index.ts` before assuming the daemon is at fault.
