# Backend / Group Policy Series

Covers group policy v0 behavior added after the older Serena memories. Search terms: backend, daemon, groups, group policy, alias, rename, description, durable groups.

## Core behavior

Groups now carry stronger identity and membership policy:

- Group names are collision-checked case-insensitively.
- Group aliases are identity-bound and unique per group.
- A member can rename their alias inside a group through `/groups/:name/rename` and MCP `bridge_rename_in_group`.
- Alias rename emits a `group_member_renamed` audit event.
- Groups have optional `description` metadata, treated as the room/topic line.
- Ephemeral group cleanup also cleans up associated media directory state.

## API facade

`src/api/groups.ts` is the canonical TypeScript client surface. Important functions now include:

- `createGroup(client, { name, ephemeral?, creatorPeerId?, description? })`.
- `patchGroup(client, { name, description })` for changing/clearing description.
- `joinGroup(...)` and `leaveGroup(...)`.
- `renameInGroup(client, { name, peerId, newAlias })`.
- `sendGroupMessage(...)` with thread and mention support.
- `getGroupHistory(...)` with main-channel, thread, and event-id retrieval modes.

`src/api/types.ts` now exposes group/event fields needed by these behaviors: `description`, `parent_event_id`, and `mentions_json`.

## CLI surface

`src/cli/commands/group.ts` implements the human CLI path. Recent commands/options include:

- `synchronize group create NAME --as SESSION_NAME [--ephemeral] [--description TEXT]`.
- `synchronize group rename NAME NEW_ALIAS --as SESSION_NAME`.
- `synchronize group describe NAME --as SESSION_NAME --description TEXT` / clearing semantics through the command surface.
- `synchronize group history NAME --as SESSION_NAME [--thread-of EVENT_ID]`.

CLI identity guardrails still live in `src/cli/identity.ts`. The daemon trusts REST callers; the CLI is responsible for resolving `--as` session names to peer ids.

## MCP surface

`src/mcp/tools/groups.ts` exposes group policy to agents. The relevant tools are:

- `bridge_create_group` returns `description` and creator metadata.
- `bridge_join_group` joins under the current peer.
- `bridge_rename_in_group` changes the caller's alias in a group.
- `bridge_send_group` supports `in_reply_to` and mention semantics.
- `bridge_group_history` has three retrieval modes: main channel, `thread_of`, and `event_ids`.

## Daemon-side notes

- Rename to a colliding alias returns an alias collision error.
- Rename to the same alias is a no-op-style error path; check current tests/docs before changing exact error code text.
- Group description input is trimmed. Blank descriptions normalize to `null`.
- Groups created without description default to `null`.

## Executable specs

`tests/api.test.ts` has focused tests for:

- `rename_in_group` audit event.
- group member listings carrying `host_session_id` when bound.
- group description create/list/patch/clear behavior.
- case-insensitive name collision and ephemeral cleanup.

The AoE CLI scenario `scripts/integration-aoe/sync_itest_aoe/scenarios/group_policy_cli.py` validates the group-policy flow end-to-end via shell/REST.
