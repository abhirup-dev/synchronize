# Generic Agent Launch Profiles

Status: approved after Plannotator review; Beads issues filed
Worktree: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/agent-launch-profiles`
Branch: `codex/agent-launch-profiles`
Issue: `sync-c84i`
Implementation epic: `sync-c84i.1`

## Goal

Make `launch` and `spawn` accept configured agent profile names as first-class targets, while preserving the existing runtime identity model.

Examples:

```bash
synchronize launch glaude
synchronize spawn glaude --name worker --repo .
synchronize spawn claude --name worker --repo .
synchronize spawn rocky
```

`glaude` is not a new tool. It is an `[agent.glaude]` profile whose runtime tool is `claude`. The profile provides self-contained binary and environment configuration, so another machine can reproduce the invocation by copying config and setting referenced secret source variables.

## Non-Goals

- Do not add `glaude` to `LaunchTool`.
- Do not depend on shell functions, interactive Zsh, or `zsh -ic` wrappers.
- Do not persist resolved secret values into SQLite, logs, web state, API responses, or print-mode output.
- Do not replace the existing Letta remote-channel integration.
- Do not change archive/resume semantics beyond preserving profile selection.

## Current Code Shape

- `src/launch/build.ts`
  - Defines `LaunchTool = "claude" | "pi" | "letta"`.
  - Builds built-in runtime commands with `buildAgentCommand()` and faithful resume commands with `buildAgentResumeCommand()`.

- `src/config.ts`
  - Already parses `[agent.<name>]` with `tool`, `repo`, `model`, `thinking`, `args`, `session_name`, and Letta fields.
  - Does not yet parse profile binary or environment sections.

- `src/cli/commands/launch.ts`
  - Foreground launch. Parses the first positional as a built-in tool only, builds a command locally, then runs it with inherited sanitized env plus synchronize launch env.

- `src/cli/commands/spawn.ts`
  - Persistent launch. Parses the first positional as a built-in tool only.
  - Has a special configured Letta path: `synchronize spawn letta --name rocky` resolves `[agent.rocky]`.

- `src/api/agent-sessions.ts`, `src/daemon/routes/agent-sessions.ts`, `src/mcp/tools/launch.ts`
  - Pass launch requests into `LaunchService`.
  - Request shape currently has `tool`, `name`, `repo`, `group`, `model`, `thinking`, and `args`.

- `src/launch/service.ts`
  - Validates launch requests.
  - Applies tool-specific model/default args.
  - Resolves `LaunchSpec`.
  - Persists durable spawn state in `launch_intents`.
  - Rebuilds specs in `specFromRow()` for daemon retry/restart.

- `src/daemon/repo/archive.ts` and `src/daemon/services/archive.ts`
  - Plan archive/resume from stored peer/session/launch rows.
  - Resume currently preserves tool/model/args, but not a profile.

## Proposed Config Model

Extend `[agent.<name>]` into a generic agent launch profile:

```toml
[agent.glaude]
tool = "claude"
bin = "/Users/abhirupdas/.local/bin/claude"
repo = "/Users/abhirupdas/Codes/Personal/synchronize"
model = "claude-sonnet-4-6"
args = []

[agent.glaude.env]
ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic"
API_TIMEOUT_MS = "3000000"
CLAUDE_CODE_AUTO_COMPACT_WINDOW = "1000000"
ANTHROPIC_DEFAULT_OPUS_MODEL = "glm-5.2[1m]"
ANTHROPIC_DEFAULT_SONNET_MODEL = "glm-5.2[1m]"
ANTHROPIC_DEFAULT_HAIKU_MODEL = "glm-4.5-air"
ANTHROPIC_AUTH_TOKEN = { from_env = "ZAI_API_TOKEN" }
```

Fields:

| Field | Meaning |
| --- | --- |
| `tool` | Runtime identity: `claude`, `pi`, or `letta`. Required. |
| `bin` | Optional executable path/name replacing the default runtime binary. Intended for CLI runtimes such as Claude and Pi. |
| `repo` | Optional default working directory. |
| `model` | Optional runtime model default. |
| `thinking` | Optional runtime thinking/effort default where supported. |
| `args` | Optional default runtime args. |
| `[agent.NAME.env]` | Environment values injected into the launched process. Values can be literal strings or secret source objects such as `{ from_env = "ZAI_API_TOKEN" }`. |

Environment source object forms:

| Form | Meaning |
| --- | --- |
| `{ from_env = "SOURCE_ENV" }` | Read the secret from another process environment variable at launch time. |
| `{ from_file = "/path/to/file" }` | Read the secret from a local file at launch time. Trim one trailing newline. |

Literal string values are ordinary config values. Source-object values are secret values.

Precedence:

1. Base process env after `sanitizeLaunchBaseEnv`.
2. Profile literal `env`.
3. Profile secret sources resolved from the launcher/daemon environment or local files.
4. Tool-specific launch env, for example Letta passthrough or Pi provisioning.
5. Synchronize-owned launch identity env, such as `SYNCHRONIZE_LAUNCH_ID`, `SYNCHRONIZE_PEER_ID`, `SYNCHRONIZE_SESSION_NAME`, and `SYNCHRONIZE_HOME`.

`SYNCHRONIZE_*` identity keys must win last so profiles cannot break registration.

Missing secret sources should fail the launch before spawning. That avoids a half-configured agent booting with a missing auth token.

Secret handling rule:

- Secret source values are resolved only in the launching process or daemon worker process.
- Secret source values must not appear in `launch_events.payload_json`, `/web/state`, CLI status output, API responses, Plannotator-facing docs generated by commands, or archive/resume print mode.
- Displayable surfaces may show target keys and source descriptors, for example `ANTHROPIC_AUTH_TOKEN <- env:ZAI_API_TOKEN`, never the resolved value.

## Target Resolution

Create a shared resolver, tentatively:

```ts
resolveAgentLaunchTarget(config, target, env): ResolvedAgentProfile | ResolvedBuiltInTool
```

Resolution order:

1. If `target` names `[agent.<target>]`, use that profile.
2. Else if `target` is a built-in `LaunchTool`, use built-in defaults.
3. Else throw with known built-ins and configured profile names.

Recommended collision policy:

- Built-in runtime names are reserved profile names: `claude`, `pi`, `letta`.
- If config defines `[agent.claude]`, the resolver should reject it with a clear message rather than silently shadowing the built-in.
- Config doctor should report reserved-name profile collisions before launch time.

Resolved target shape should carry:

```ts
interface ResolvedAgentLaunchTarget {
  target: string;
  profileName?: string;
  tool: LaunchTool;
  bin?: string;
  repo?: string;
  model?: string;
  thinking?: string;
  args?: string[];
  env: Record<string, string>; // resolved only in the process about to launch
  envDisplay: Array<{ target: string; source: "literal" | "env" | "file"; redacted: boolean }>;
}
```

## CLI Shape

### Foreground launch

Keep the existing built-ins:

```bash
synchronize launch claude
synchronize launch pi
synchronize launch letta
```

Add profile targets:

```bash
synchronize launch glaude
```

Profile defaults apply. CLI flags and passthrough args override/append:

```bash
synchronize launch glaude --name reviewer -- --resume abc
```

The foreground command runs locally, so `launch.ts` must load `~/.synchronize/config.toml`, resolve `target`, compose env, build the command, and run it.

### Persistent spawn

Keep built-ins:

```bash
synchronize spawn claude --name worker --repo .
synchronize spawn pi --name planner --repo .
synchronize spawn letta --name rocky
```

Add profile targets:

```bash
synchronize spawn glaude --name worker --repo .
synchronize spawn rocky
```

Rules:

- For local/profiled Claude and Pi, persistent `--name` should remain required unless `session_name` is present in the profile. The profile name is the invocation profile; the session name is the durable peer identity.
- For remote configured Letta, continue supporting `synchronize spawn letta --name rocky`, and add `synchronize spawn rocky` as a natural profile-target form.
- CLI-provided `--repo`, `--model`, `--thinking`, and passthrough args override or extend profile defaults.

Example of the profile/session-name distinction:

```toml
[agent.glaude]
tool = "claude"
session_name = "reviewer"
```

```bash
synchronize spawn glaude
```

This means "spawn a Claude process using the `glaude` profile, and register the peer as `reviewer`." Without `session_name`, the operator must say:

```bash
synchronize spawn glaude --name reviewer
```

This avoids accidentally using `glaude` as both the invocation profile and the durable human-facing peer alias.

## API And MCP Shape

This section is about the launch/spawn transport into the daemon, not the MCP installation inside Claude/GLaude.

GLaude shares the Claude runtime. The launched process still uses normal Claude MCP installation, hooks, and live-channel flags. No separate `glaude` MCP server install is needed.

The API shape changes only because persistent `spawn` is daemon-owned. The CLI can resolve `synchronize launch glaude` locally, but `synchronize spawn glaude` must tell the daemon which profile to use so the daemon can:

- validate the profile,
- persist the profile name in `launch_intents`,
- re-resolve the same profile on durable retry/restart,
- preserve the profile through archive/resume.

Extend launch request shape with:

```ts
target?: string;
profile?: string;
tool?: LaunchTool;
```

Recommended simpler transport:

- Keep `tool` for backward compatibility.
- Add `profile?: string`.
- The daemon resolves `profile` against its config.
- If both `tool` and `profile` are provided, require `profile.tool === tool`.

MCP `bridge_launch` only needs optional `profile` if agents should be able to spawn profiled agents. That is an API transport addition, not MCP installation work. It can keep `tool` required initially for schema compatibility, or allow either `tool` or `profile` in a follow-up if the MCP schema can express it cleanly.

The CLI can call the daemon with both:

```json
{ "tool": "claude", "profile": "glaude", "name": "worker", "repo": "." }
```

## LaunchSpec Construction

Refactor command building in two layers:

1. Runtime args:
   - Existing `withLaunchDefaults()` keeps owning model/thinking/default args.
   - Profile args are merged before CLI passthrough args, then tool-specific defaults strip/replace model flags as today.

2. Command base:
   - Built-in Claude: `["claude", ...args]`
   - Profiled Claude with `bin`: `[profile.bin, ...args]`
   - Built-in Pi: `["pi", ...args]`
   - Profiled Pi with `bin`: `[profile.bin, ...args]`
   - Built-in Letta: existing `["bun", "run", extensions/letta-synchronize/src/index.ts, ...args]`

Do not add shell command strings. The backend already shell-quotes argv for AOE. Profiles should remain argv/env data, not executable shell snippets.

## Durable Spawn Persistence

Add migration fields to `launch_intents`:

```sql
profile_name TEXT
```

Do not persist resolved secret values from environment source objects.

Persisting `profile_name` is enough to prevent silent fallback:

- On retry/restart, `specFromRow()` resolves the stored profile name.
- If the profile is missing or now has a different tool, fail the launch work with a clear error.
- If env source variables are missing, fail before spawning.

Consider also storing `profile_snapshot_json` later for auditability. Do not put secrets in it.

This is a real schema change. It should be implemented as a new SQLite migration because archive/resume and durable spawn retry both read from `launch_intents`. The migration stores only the non-secret profile name. It does not store resolved secret env values.

## Archive And Resume

Archive/resume must preserve profile selection:

- `planResume()` reads `profile_name` from the latest launch intent.
- `ResumePlan` includes `profileName`.
- `resumeSessionApply()` passes `profileName` into `LaunchRequest`.
- Print mode should emit the profiled command, non-secret literal env, and redacted secret-source descriptors. It must not emit resolved secret values.

If the profile is missing on resume, return a typed error such as `resume_profile_missing`, not a plain fallback to the built-in tool.

Why schema changes are required:

- A spawned profile is part of how the agent was invoked.
- Archive/resume rebuilds launch requests from stored state, not from the original CLI process.
- Therefore `launch_intents.profile_name` is required to distinguish "resume this as default Claude" from "resume this as the `glaude` Claude profile."
- Only the profile name is stored. The current config is re-read at resume time, and secret sources are resolved then.

## Web Surface

This plan does not need a large web redesign, but it should expose profile metadata for spawn.

API `/web/state` should eventually include:

```ts
launch_profiles?: Array<{
  name: string;
  tool: "claude" | "pi" | "letta";
  label?: string;
  available: boolean;
  missing_env?: string[];
}>
```

The web spawn dialog can then show profiles as runtime choices or a profile selector. For the first implementation, web can continue built-in-only if CLI/API/MCP are complete, but a follow-up issue should be filed if web is deferred.

## Implementation Steps

1. Config schema
   - Extend `AgentProfile` with `bin` and typed `env` entries.
   - Parse `[agent.NAME.env]` string literals and source objects such as `{ from_env = "ZAI_API_TOKEN" }` and `{ from_file = "/path" }`.
   - Serialize those sections.
   - Add config tests.

2. Target resolver
   - Add shared profile-or-tool resolver.
   - Enforce built-in name collision policy.
   - Validate profile tool with `isLaunchTool`.
   - Validate secret sources.
   - Add config doctor coverage for reserved-name collisions, invalid profile tools, and missing secret sources where cheaply detectable.

3. Foreground launch
   - Update `parseLaunchArgs()` to accept profile targets.
   - Load config in `launch.ts`.
   - Resolve profile locally.
   - Apply profile env and binary.
   - Add tests for `launch glaude` resolution and env composition.

4. Persistent spawn CLI
   - Update `parseSpawnArgs()` to treat first positional as target.
   - Preserve existing `spawn letta --name rocky`.
   - Add `spawn rocky` and `spawn glaude --name worker`.
   - Pass `profile` to the daemon when target is a profile.

5. API/MCP
   - Extend `LaunchAgentInput`.
   - Extend `/agent-sessions/launch` validation to accept profile.
   - Extend `bridge_launch` with optional `profile`.
   - Require profile/tool agreement when both are supplied.

6. Launch service
   - Add `profileName` to `LaunchRequest`.
   - Inject a profile resolver into `LaunchService`, or load config from daemon paths in the route before validation.
   - Build `LaunchSpec` from resolved profile data.
   - Keep tool-specific defaulting centralized.

7. Database migration
   - Add `profile_name` to `launch_intents`.
   - Add it to `LaunchIntentRow`, `CreateLaunchIntentInput`, inserts, and reads.
   - Include profile name in lifecycle event payloads for visibility.
   - Do not include resolved environment values in lifecycle event payloads.

8. Durable worker and resume
   - Re-resolve profile in `specFromRow()`.
   - Carry profile name through archive/resume planning and apply paths.
   - Add failure tests for missing profiles.

9. Docs
   - Update `docs/configuration/spawn.md`.
   - Add launch-profile examples to `docs/configuration/README.md` or a focused subsection.
   - Update CLI help/schema for profile targets.

10. Web follow-up
   - If web profile selection is not implemented in this change, create a Beads follow-up.
   - If implemented, add `/web/state` profile data and spawn dialog selection tests.

## Verification Plan

Run focused tests:

```bash
bun test tests/config.test.ts tests/launch-build.test.ts tests/launch-service.test.ts tests/launch-command.test.ts tests/cli-spawn-config.test.ts tests/mcp-archive.test.ts
```

Run broad checks:

```bash
bun run typecheck
cd web && bun run typecheck
cd web && bun run build
```

If web profile selection is implemented:

```bash
bun test tests/web-daemon-data.test.ts
cd web && bun run test:storybook -- --runInBand
```

Manual non-secret smoke:

```toml
[agent.fake-claude]
tool = "claude"
bin = "/usr/bin/env"

[agent.fake-claude.env]
SYNCHRONIZE_FAKE_PROFILE = "1"
```

Use unit/fake backend tests instead of launching a real Claude billing session.

Secret redaction checks:

- Assert launch lifecycle payloads do not contain secret values.
- Assert resume print output does not contain secret values.
- Assert web state/profile metadata does not contain secret values.

## Decisions And Remaining Questions

1. `spawn PROFILE` session naming
   - Decision: require `--name` for Claude/Pi unless `session_name` is explicitly configured.
   - Example: `spawn glaude --name reviewer` means profile `glaude`, peer alias `reviewer`; `[agent.glaude].session_name = "reviewer"` allows `spawn glaude`.

2. Built-in-name collisions
   - Decision: profile names `claude`, `pi`, and `letta` are invalid.
   - Config doctor should report this. Launch/spawn should also reject it if encountered.

3. Should web profile selection be included in the first implementation?
   - Recommendation: CLI/API/MCP/durable behavior first. Web can be included if small after the backend shape is stable.

4. Secrets in literal env
   - Decision: docs should say secrets belong in source objects such as `{ from_env = "ZAI_API_TOKEN" }` or `{ from_file = "/path" }`.
   - The software cannot prove a literal value is not a secret, but it must not render any profile env values on displayable surfaces by default.
