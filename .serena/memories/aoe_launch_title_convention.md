# AOE Launch Title Convention

Applies to daemon/AOE-launched Synchronize agents. Added in commit `56f1f95` for Beads `sync-wpcz`.

## Convention
- Backend title format: `<hash8>-<alias11>`, total <= 20 chars.
- `hash8`: deterministic SHA-256/base32 prefix over canonical identity: `launchId`, `peerId`, optional group name, normalized alias/session name, and tool.
- Tool is in the hash input only; visible title does not include tool because AOE already has tool metadata.
- `alias11`: readable group-scoped alias, normalized to lowercase alnum/dashes, max 11 chars.

## Why
AOE/tmux exposes only the first 20 sanitized title characters plus the AOE session id suffix. Long titles broke Claude dev-channel prompt auto-confirm because the pane lookup searched for the full untruncated title.

## Code
- `src/launch/service.ts`: `normalizeLaunchAlias`, `aoeTitle`.
- `src/launch/backend.ts`: tmux pane lookup resolves by `aoe list --json` id suffix first.
- `src/daemon.ts`: stop-by-peer recomputes backend title from launch binding + peer/group metadata.
- `web/src/components/SpawnAgentDialog.tsx`: UI enforces alias budget.

## Related Launch Defaults
Claude AOE launches are pinned to `--model haiku`; Pi launches are pinned to `--provider openai-codex --model gpt-5.4-mini` during v0 testing.