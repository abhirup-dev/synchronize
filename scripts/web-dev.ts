#!/usr/bin/env bun
// Worktree UI launcher: resolve a runtime, then start Portless + Vite.
//
//   bun run scripts/web-dev.ts
//
// Owns exactly two things — one Vite child and one Portless route. It holds no
// authority over any daemon: it will not start, stop, restart, or wipe one, and
// it will not install or reconfigure the shared Portless service. A daemon is a
// shared runtime with CLI and MCP consumers attached, so a UI launcher that
// recovered it would be reaching outside its own blast radius.
//
// Runtime selection: SYNCHRONIZE_DAEMON_URL wins outright; otherwise the daemon
// is read from SYNCHRONIZE_HOME's discovery file. Either way it must already be
// healthy, and a failure exits non-zero with a stable code rather than repairing
// anything.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ENV_DAEMON_URL, ENV_TOKEN } from "../src/constants.ts";
import { DAEMON_ERROR_CODES, describeProbe, probeDaemon, type DaemonProbe } from "../src/daemon-probe.ts";
import { readJson } from "../src/fs.ts";
import { getRuntimePaths } from "../src/paths.ts";
import type { Discovery } from "../src/client.ts";

const APP_NAME = "synchronize-dev";
const REPO_ROOT = join(import.meta.dir, "..");
const WEB_DIR = join(REPO_ROOT, "web");

function fail(code: string, message: string, hint?: string): never {
  console.error(`\n${code}: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

// ── 1. Resolve the runtime ──────────────────────────────────────────────────
const paths = getRuntimePaths();
const explicit = process.env[ENV_DAEMON_URL]?.trim();
let daemonUrl: string;
let source: string;

if (explicit) {
  daemonUrl = explicit.replace(/\/$/, "");
  source = `${ENV_DAEMON_URL} (explicit)`;
} else {
  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery?.baseUrl) {
    fail(
      DAEMON_ERROR_CODES.discovery_missing,
      `no daemon.json under ${paths.home}`,
      "Start the runtime you want to develop against first, then re-run.\n" +
        "  production: make daemon-relaunch\n" +
        "  isolated:   make dev-daemon-relaunch\n" +
        `Or point at one directly: ${ENV_DAEMON_URL}=http://127.0.0.1:PORT make web-dev`,
    );
  }
  daemonUrl = discovery.baseUrl.replace(/\/$/, "");
  source = `${paths.home}/daemon.json (pid ${discovery.pid})`;
}

const probe: DaemonProbe = await probeDaemon(daemonUrl, { token: process.env[ENV_TOKEN] ?? null, attempts: 2 });
if (probe.kind !== "healthy") {
  fail(
    DAEMON_ERROR_CODES[probe.kind],
    describeProbe(probe),
    "The UI launcher does not recover daemons. Use 'make daemon-relaunch' (state-preserving) and re-run.",
  );
}

// ── 2. Require Portless, without touching the user's install ────────────────
const portless = Bun.which("portless");
if (!portless) {
  fail(
    "PORTLESS_MISSING",
    "the 'portless' command is not on PATH",
    "Install it yourself (this launcher will not):\n" +
      "  npm install -g portless\n" +
      `Or skip Portless entirely: cd web && PORT=5173 ${ENV_DAEMON_URL}=${daemonUrl} bun run dev:raw`,
  );
}

// ── 3. Report provenance before handing off ─────────────────────────────────
console.log(`runtime     ${daemonUrl}`);
console.log(`  source    ${source}`);
console.log(`  health    pid=${probe.health.pid} api_version=${probe.health.api_version}`);
if (probe.health.provenance) {
  const p = probe.health.provenance;
  console.log(`  daemon at ${p.source_root} @ ${p.git_sha?.slice(0, 8) ?? "unknown"}${p.git_dirty ? " (dirty)" : ""}`);
}
console.log(`ui source   ${WEB_DIR}`);
// The prefix is the LAST segment of the branch name, so feat/foo and fix/foo
// both reduce to "foo" and would contend for one route. main/master get no
// prefix at all.
console.log(`portless    ${portless} (app "${APP_NAME}"; a linked worktree prefixes the branch's last segment)\n`);

// ── 4. Start Portless + Vite ────────────────────────────────────────────────
// Portless assigns the port and passes it as PORT/HOST, which vite.dev.config.ts
// reads. --force is never used: it would kill whatever already holds the route,
// which in this project is most likely another worktree's UI.
const child = spawn(portless, ["run", "--name", APP_NAME, "--", "bun", "run", "dev:raw"], {
  cwd: WEB_DIR,
  stdio: "inherit",
  env: { ...process.env, [ENV_DAEMON_URL]: daemonUrl },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (code === 0 || signal) process.exit(0);
  console.error(
    `\nportless exited with code ${code}.\n` +
      "If the route is already taken, another worktree's UI is running under the same branch name.\n" +
      "Stop that one, or run this worktree's UI on a different branch. This launcher will not use --force.",
  );
  process.exit(code ?? 1);
});
