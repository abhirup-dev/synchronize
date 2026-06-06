# CLI Completion Carapace V0 Plan

Status: implementation plan (2026-06-06)
Owner: abhirup

## Goal

Make the `synchronize` CLI feel complete under tab completion without turning
completion support into a second hand-maintained command tree.

V0 is Carapace-first because this Mac already has Carapace wired into zsh, and
Carapace gives a higher-quality completion surface with much less shell-specific
code. The codebase must still stay shell-neutral internally so a later raw zsh
renderer can be added without redesigning command metadata or live candidate
lookup.

## Product Behavior

Users should be able to install and use completion with:

```bash
synchronize completion carapace
synchronize completion install --shell carapace
```

The generated Carapace spec should complete:

- top-level commands: `status`, `top`, `register`, `group`, `media`, `threads`,
  `launch`, `spawn`, and the rest of the current CLI surface;
- nested subcommands such as `group send`, `media share`, and `threads summary`;
- flags and flag value enums;
- path-shaped arguments where appropriate, such as media files and spawn repos;
- live daemon values when a daemon is already healthy, such as group names,
  peer ids, session names, media ids, and thread root event ids.

Completion must be quiet and safe:

- Tab completion must not auto-start the daemon.
- Tab completion must not mutate daemon state.
- Live lookups must use a short timeout and fall back to static completion.
- Completion errors should not print stack traces into the shell prompt.
- Generated install output must be deterministic and testable.

## V0 Choice

### Why Carapace first

Carapace handles shell integration, escaping, descriptions, and multi-shell
behavior. That lets this repo focus on the real long-term problem: making the
CLI grammar a typed source of truth instead of duplicating command knowledge
across `index.ts`, `help.ts`, completion scripts, and tests.

Raw zsh is still valuable later, but it is lower leverage for V0. A hand-written
zsh function would immediately add shell-specific parsing and escaping code to
this repo. That is a higher maintenance surface before the command schema is
even centralized.

### Forward compatibility rule

No completion logic may depend on Carapace concepts directly. Carapace is only a
renderer and install target.

```text
CLI command schema
        |
        v
Shell-neutral completion model
        |
        +--> Carapace renderer       V0
        |
        +--> Raw zsh renderer        later
        |
        +--> Bash/fish renderers     later, if useful
```

## Architecture

### Source of truth

```text
                 src/cli/schema.ts
          +--------------------------------+
          | Command tree                   |
          | - names and aliases            |
          | - descriptions                 |
          | - flags                        |
          | - positionals                  |
          | - enum values                  |
          | - dynamic candidate providers  |
          +--------------------------------+
              |          |            |
              |          |            |
              v          v            v
        help text    parser glue   completion generators
```

`src/cli/schema.ts` owns the command tree. The existing command handlers remain
responsible for behavior, but the declarative grammar moves out of ad hoc help
strings and switch statements.

V0 does not need a full parser rewrite. It can introduce the schema and use it
for help/completion first, then keep dispatch behavior compatible with the
current modules. Parser consolidation can follow once completion coverage is
stable.

### Completion runtime

```text
User presses TAB
      |
      v
Carapace shell integration
      |
      v
Generated synchronize spec
      |
      +--------------------+
      |                    |
      v                    v
Static grammar        Dynamic bridge commands
commands/flags        groups/peers/threads/media
      |                    |
      |                    v
      |           synchronize completion complete ...
      |                    |
      |        read daemon discovery only
      |        short timeout query if healthy
      |        no daemon autostart
      |                    |
      +---------+----------+
                v
        candidate list rendered by shell
```

Carapace can complete static commands directly from the spec. Dynamic values go
through a small CLI subcommand that returns shell-neutral candidates.

### Module layout

```text
src/cli/
  index.ts
  schema.ts
  help.ts
  completion/
    types.ts
    command.ts
    static.ts
    dynamic.ts
    render-carapace.ts
    install.ts
```

Responsibilities:

```text
schema.ts
  Owns command grammar and completion metadata.

completion/types.ts
  Defines shell-neutral candidates, providers, and render options.

completion/static.ts
  Resolves command position, subcommands, flags, and enum values.

completion/dynamic.ts
  Fetches live candidates without daemon autostart.

completion/render-carapace.ts
  Emits the Carapace spec from the shell-neutral schema.

completion/install.ts
  Installs or prints deterministic install instructions.

completion/command.ts
  Implements `synchronize completion ...`.
```

## CLI Schema Model

The current CLI framework is intentionally small and local: `src/cli/index.ts`
dispatches through a top-level `switch`, command modules own their argument
validation, and `src/cli/flags.ts` provides the shared `--flag value` /
`--boolean` parsing helper. There is no Commander/Yargs/Cobra-style framework
in the repo today.

V0 should reuse that existing handler framework instead of replacing it. The
typed schema is an additive metadata layer that sits beside the current command
modules and feeds help/completion. Command behavior stays in the current
handlers until there is a separate reason to consolidate parsing.

This avoids two bad outcomes:

- introducing a third-party CLI framework just to get completion metadata;
- inventing a parallel completion-only grammar that drifts from the existing
  local handlers.

Use small TypeScript objects for the metadata layer because they match the
current codebase style and can reference the existing command modules without
forcing a parser rewrite.

```ts
export interface CliCommandSpec {
  name: string;
  aliases?: string[];
  description: string;
  flags?: CliFlagSpec[];
  positionals?: CliPositionalSpec[];
  subcommands?: CliCommandSpec[];
  passthrough?: CliPassthroughSpec;
}

export interface CliFlagSpec {
  name: string;
  description: string;
  value?: CliValueSpec;
  boolean?: boolean;
  repeatable?: boolean;
}

export interface CliPositionalSpec {
  name: string;
  description: string;
  value?: CliValueSpec;
  required?: boolean;
  variadic?: boolean;
}

export type CliValueSpec =
  | { kind: "enum"; values: string[] }
  | { kind: "file" }
  | { kind: "directory" }
  | { kind: "dynamic"; provider: DynamicCompletionProvider };
```

The model should be expressive enough for current commands but intentionally not
try to become a generic framework.

## Dynamic Providers

Dynamic providers are named capabilities, not shell-specific callbacks:

```text
group-names
peer-ids
session-names
media-ids
thread-root-event-ids
```

Candidate examples:

```text
GROUP
  `group send GROUP ...`
  `media list GROUP`
  `threads list --group GROUP`

PEER_ID
  `dm PEER_ID MESSAGE`
  `threads list --started-by-peer-id PEER_ID`

SESSION_NAME
  `--as SESSION_NAME`
  `threads list --started-by-session-name SESSION_NAME`

MEDIA_ID
  `media get MEDIA_ID`

ROOT_EVENT_ID
  `threads show ROOT_EVENT_ID`
  `threads status ROOT_EVENT_ID`
  `threads summary ROOT_EVENT_ID`
```

Dynamic lookup should use existing REST API helpers only after a cheap health
check proves the daemon is already running.

```text
dynamic.ts
  read ~/.synchronize/daemon.json
        |
        v
  GET /health with timeout
        |
        +--> unhealthy: []
        |
        v
  GET /groups, /peers, /threads, /media...
        |
        v
  CompletionCandidate[]
```

Do not call `ensureDaemon()` from dynamic completion.

## Command Surface

Add:

```text
synchronize completion carapace
synchronize completion install --shell carapace
synchronize completion complete PROVIDER [--context JSON]
```

`completion carapace` prints the spec to stdout.

`completion install --shell carapace` writes the spec to the local Carapace spec
directory when it can be discovered. On macOS this is normally:

```text
~/Library/Application Support/carapace/specs/synchronize.yaml
```

If the directory cannot be discovered or created, the command prints exact
manual instructions and exits non-zero only for real filesystem failures.

`completion complete` is an internal bridge. It prints a compact JSON array:

```json
[
  { "value": "general", "description": "group" }
]
```

The bridge protocol stays shell-neutral so a future raw zsh renderer can call
the same command.

## Help Generation

Once the schema exists, help should be generated from it:

```text
src/cli/schema.ts
        |
        v
src/cli/help.ts
        |
        v
synchronize --help
```

V0 should preserve current help text shape as closely as practical. Snapshot the
current help before replacing it, then update only intentional differences.

This keeps the first completion change honest: if a command is present in help,
it should be present in completion.

## Carapace Spec Strategy

Generate a Carapace spec from the schema rather than committing hand-written
YAML.

```text
schema command
      |
      v
Carapace command object
      |
      v
YAML or JSON emitted by `synchronize completion carapace`
```

Carapace-specific details belong only in `render-carapace.ts`:

- command and subcommand nesting;
- flag descriptions;
- enum value mappings;
- file/directory macros;
- dynamic bridge commands for provider-backed values.

The renderer may output YAML if Carapace expects spec files in YAML. Tests
should compare parsed structure rather than brittle whitespace when possible.

## Install Strategy

```text
synchronize completion install --shell carapace
        |
        v
resolve Carapace spec dir
        |
        +--> exists or mkdir -p succeeds
        |       |
        |       v
        |   write synchronize.yaml
        |
        +--> cannot resolve
                |
                v
          print manual command:
          synchronize completion carapace > ".../specs/synchronize.yaml"
```

V0 only installs Carapace. Raw zsh install is intentionally not implemented yet.

The install command should be non-interactive and overwrite the generated spec
deterministically.

## Tests

### Unit tests

- schema includes every current top-level command from `src/cli/index.ts`;
- schema includes current nested subcommands for `group`, `media`, `threads`,
  `launch`, and `spawn`;
- help generation preserves the current command list;
- Carapace renderer includes command names, flag names, enum values, and
  file/directory completions;
- dynamic provider bridge returns `[]` when no daemon discovery file exists;
- dynamic provider bridge returns `[]` when `/health` fails or times out;
- dynamic providers map mocked API payloads into stable candidate values.

### Integration tests

- `bun run src/cli.ts completion carapace` exits zero and prints a parseable spec;
- `bun run src/cli.ts completion complete group-names` exits zero without
  starting a daemon when `SYNCHRONIZE_HOME` points at an empty temp directory;
- with a temp daemon already running, dynamic group/thread/peer providers return
  expected values.

### Manual verification

Use a throwaway runtime:

```bash
SYNCHRONIZE_HOME=/tmp/synchronize-completion-v0 bun run src/cli.ts status
```

Then install the generated Carapace spec and verify zsh completions for:

- `synchronize <TAB>`;
- `synchronize group <TAB>`;
- `synchronize group send <TAB>` after creating a group;
- `synchronize threads show <TAB>` after creating a thread;
- `synchronize media get <TAB>` after sharing media;
- `synchronize spawn claude --repo <TAB>`.

## Implementation Slices

### Slice 1: Schema and generated help

Introduce `src/cli/schema.ts` and migrate help rendering to use it. Keep command
dispatch behavior unchanged.

Acceptance:

- current help still renders all commands;
- typecheck passes;
- tests prove schema coverage for top-level and nested commands.

### Slice 2: Static Carapace renderer

Add `synchronize completion carapace` and generate static command, subcommand,
flag, enum, file, and directory completions.

Acceptance:

- command prints a valid Carapace spec;
- static completion covers every command currently shown in help;
- no daemon is touched.

### Slice 3: Dynamic completion bridge

Add shell-neutral dynamic providers and the internal
`synchronize completion complete PROVIDER [--context JSON]` bridge.

Acceptance:

- no discovery file returns `[]`;
- unhealthy daemon returns `[]`;
- healthy temp daemon returns group, peer, session, media, and thread candidates;
- completion never calls `ensureDaemon()`.

### Slice 4: Carapace install command

Add `synchronize completion install --shell carapace`.

Acceptance:

- writes generated spec to the Carapace spec directory when available;
- prints deterministic fallback instructions otherwise;
- uses non-interactive overwrite behavior.

### Slice 5: End-to-end verification and docs

Document the install command in `README.md` or the CLI help section and run the
manual zsh/Carapace verification checklist.

Acceptance:

- `bun test`;
- `bun run typecheck`;
- manual Carapace zsh completion works on this Mac;
- no real user daemon state is modified during tests.

## Out Of Scope

- Raw zsh renderer.
- Bash and fish renderers.
- Replacing the CLI with Commander, Yargs, Cobra, or another framework.
- Interactive completion UI beyond what Carapace/zsh already provides.
- Shell completion for arbitrary downstream `claude` or `pi` passthrough args.
- Daemon autostart from completion.

## Risks And Mitigations

### Risk: schema drift from command behavior

Mitigation: keep schema coverage tests tied to current command modules and
generate help from the schema.

### Risk: completion blocks the prompt

Mitigation: dynamic providers use short fetch timeouts, no daemon autostart, and
empty-list fallback.

### Risk: Carapace-specific model leaks into the CLI

Mitigation: keep Carapace code in one renderer module and enforce shell-neutral
provider names/types in tests.

### Risk: generated spec is hard to inspect

Mitigation: keep `synchronize completion carapace` as a plain stdout command and
make install only write that output to disk.

## Future Raw Zsh Path

Raw zsh should be added as a renderer over the same model:

```text
src/cli/schema.ts
        |
        v
src/cli/completion/render-zsh.ts
        |
        v
synchronize completion zsh
```

The raw zsh renderer should call the same `completion complete` bridge for live
values. It should not reimplement daemon discovery or REST lookup in shell.

## Beads

Implementation work is tracked by Beads:

- `sync-x7q1` - `[epic] CLI completion Carapace V0`
  - `sync-x7q1.1` - Define typed CLI command schema and generate help from it
  - `sync-x7q1.2` - Generate static Carapace completion spec from CLI schema
  - `sync-x7q1.3` - Add daemon-safe dynamic completion providers
  - `sync-x7q1.4` - Implement Carapace completion install command
  - `sync-x7q1.5` - Verify and document CLI completion V0
