# Code Style & Conventions

## Language / runtime
- TypeScript, ESM modules, Bun runtime.
- `tsconfig.json` is strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `allowImportingTsExtensions`, `noEmit`. There is **no build step** — `bun` executes `.ts` directly.

## Import conventions
- **Always use the `.ts` extension on relative imports**: `import { foo } from "./foo.ts"`, never `"./foo"`. This is a Bun convention enforced by `allowImportingTsExtensions`.
- **Separate type-only imports** with `import type`: `import { Foo } from "./foo.ts"` for values, `import type { Bar } from "./bar.ts"` for types. The MCP `state.ts ↔ codex-notifier.ts ↔ claude-subscription.ts` triangle uses this to avoid runtime cycles (TS erases type-only edges).

## Module-layout patterns

### 1. Compatibility-shim pattern (established for all three adapters)
Top-level `src/foo.ts` is a 1–10-line file that re-exports the public surface from `src/foo/`. Optional `import.meta.main` guard for files that double as scripts (see `src/cli.ts`, `src/mcp.ts`). Phase-2 daemon split should follow the same shape: `src/daemon.ts` shim → `src/daemon/`.

### 2. Factory-closure for stateful subsystems (preferred over classes)
`createMcpServer()` builds a private `AdapterState`, builds `lifecycleHooks` via a factory that captures `state`, then threads `{ mcp, state, emit, lifecycle }` as a `ToolContext` into each tool registrar. The locked-in pattern for the daemon split is the same: `createDaemonServer({ paths })` returning `{ start, stop, handle }`, route registrars receive a `RouteContext`.

This pattern was chosen explicitly over a `class McpAdapter` — see Phase 1 handoff: "smallest behavioral surface change. Class refactor is a separate concern, not a code-move."

### 3. Side-effect-free imports
Top-level adapter files (`src/cli.ts`, `src/mcp.ts`) must NOT run anything on import. They expose `main()` and gate execution behind `if (import.meta.main)`. Tests import `main` and exercise it directly; `bin/synchronize` calls `main(process.argv.slice(2))` explicitly.

### 4. No `requestJson` outside `src/client.ts` and `src/api/`
After phase-1, `rg "requestJson" src/cli src/mcp src/daemon` returns nothing. CLI and MCP go through the typed `src/api/` facade. The daemon owns route handlers. Phase-2 must preserve this invariant.

### 5. CLI identity stays CLI-local
`requireIdentity`, `resolveCliRegisterPeerId`, `--as SESSION_NAME` enforcement live in `src/cli/identity.ts`. They are NOT in `src/api/` and NOT in the daemon. The daemon trusts its REST callers; identity is an adapter concern.

## Naming
- `camelCase` for functions and variables, `PascalCase` for types and classes, `SCREAMING_SNAKE_CASE` for constants in `src/constants.ts`.
- Test files are `tests/<feature>.test.ts`. Test bodies set up real daemons under `SYNCHRONIZE_HOME=<tmp>` — these are integration-style, not mocked.

## Comments / docs
- No JSDoc by default. Add comments only when the *why* is non-obvious (hidden invariant, subtle workaround). Don't comment what the code already says.
- No emoji in code unless the user asks.

## Git
- Squash-merge feature branches into `master`. No merge commits for feature integration.
- Never `--no-verify`, never `--amend` published commits, never force-push to master.

## bd / beads issues
- Issues live in `.beads/issues.jsonl` (canonical). `issues.jsonl` at repo root is a gitignored bd auto-export artifact — don't hand-edit.
- Run `bd prime` for the full command reference. Use `bd remember` for cross-session knowledge instead of MEMORY.md files.
