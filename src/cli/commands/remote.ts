import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  loadConfig,
  removeProfile as removeProfileFromConfig,
  resolveConnection,
  resolveProfile,
  serializeConfig,
  setActiveProfile,
  upsertProfile,
  type RemoteProfile,
  type SynchronizeConfig,
} from "../../config.ts";
import { getRuntimePaths } from "../../paths.ts";
import { ALL_HARNESS_SCENARIOS, buildHarnessPlan, buildProvisionPlan, buildSyncPlan, type RemoteStep } from "../../remote/plan.ts";
import { evaluateDoctor, renderDoctor, renderStatusReport, type DoctorInput } from "../../remote/status.ts";
import { ensureDaemon } from "../../client.ts";
import { getStatus } from "../../api/status.ts";
import { listPeers } from "../../api/peers.ts";
import { API_VERSION } from "../../constants.ts";
import type { Peer } from "../../api/types.ts";
import { resolve } from "node:path";

// `synchronize remote` — the multi-machine control plane. v0 (sync-7mcv) covers
// profile management (add/use/ls/show); provision/sync/upgrade/status land in
// later phases (sync-nxyp/sync-qqw8/sync-i01i).
const USAGE = `synchronize remote <subcommand>

  add <name> --url <url> [--token-env <ENV>] [--token <literal>]
             [--health-timeout-ms <n>] [--ssh-host <host>] [--use]
  use <name>                 set the active profile
  ls                         list profiles (active marked with *)
  show [name]                show a profile (default: active), with resolved connection
  remove <name>              delete a profile
  provision <ssh-host>       verify remote tools + non-interactive PATH [--dry-run]
  sync <ssh-host> --hub-url <url> [--path <remote-dir>] [--token <t> | --token-env <ENV>]
             [--daemon-bind <ip>] [--lease-ms <n>] [--peer-retention-ms <n>] [--sweep-interval-ms <n>]
             [--skip-install] [--dry-run]   rsync runtime + write remote config + verify
  harness <ssh-host> --hub-url <url> [--scenario <name> | --all] [--token <t>]
             [--path <remote-dir>] [--dry-run] [-- <extra scenario args>]
             run the Python AOE harness on the remote against the hub
             scenarios: cli-dm cli-group-policy pi-dm pi-group-policy pi-thread-baton pi-revival pi_mcp_archive_resume
  status                     hub health + agent roster grouped by machine
  doctor                     readiness checklist for the active connection`;

export async function run(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "add":
      await addProfile(rest);
      return;
    case "use":
      await useProfile(rest);
      return;
    case "ls":
    case "list":
      await listProfiles();
      return;
    case "show":
      await showProfile(rest);
      return;
    case "remove":
    case "rm":
      await removeProfile(rest);
      return;
    case "provision":
      await provisionRemote(rest);
      return;
    case "sync":
      await syncRemote(rest);
      return;
    case "harness":
      await harnessRemote(rest);
      return;
    case "status":
      await statusRemote();
      return;
    case "doctor":
      await doctorRemote();
      return;
    default:
      console.log(USAGE);
      if (sub && sub !== "--help" && sub !== "-h" && sub !== "help") process.exit(2);
  }
}

async function readConfig(): Promise<{ config: SynchronizeConfig; path: string }> {
  const path = getRuntimePaths().configPath;
  return { config: await loadConfig(path), path };
}

async function writeConfig(path: string, config: SynchronizeConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeConfig(config), "utf8");
}

async function addProfile(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const name = flags.positional[0];
  if (!name) fail("remote add requires a <name>");
  const url = flags.opts.url;
  if (!url) fail("remote add requires --url <url>");

  const profile: RemoteProfile = { url };
  if (flags.opts["token-env"]) profile.tokenEnv = flags.opts["token-env"];
  if (flags.opts.token) profile.token = flags.opts.token;
  if (flags.opts["health-timeout-ms"]) {
    const n = Number(flags.opts["health-timeout-ms"]);
    if (!Number.isFinite(n) || n <= 0) fail("--health-timeout-ms must be a positive number");
    profile.healthTimeoutMs = Math.trunc(n);
  }
  if (flags.opts["ssh-host"]) profile.sync = { sshHost: flags.opts["ssh-host"] };

  const { config, path } = await readConfig();
  const next = upsertProfile(config, name, profile, { makeActive: flags.bools.has("use") });
  await writeConfig(path, next);
  console.log(`profile '${name}' saved${next.active === name ? " (active)" : ""} -> ${path}`);
}

async function useProfile(argv: string[]): Promise<void> {
  const name = argv[0];
  if (!name) fail("remote use requires a <name>");
  const { config, path } = await readConfig();
  const next = setActiveProfile(config, name);
  await writeConfig(path, next);
  console.log(`active profile: ${name}`);
}

async function listProfiles(): Promise<void> {
  const { config } = await readConfig();
  const names = Object.keys(config.remotes).sort();
  if (names.length === 0) {
    console.log("(no profiles) — add one with: synchronize remote add <name> --url <url>");
    return;
  }
  for (const name of names) {
    const marker = name === config.active ? "*" : " ";
    console.log(`${marker} ${name}\t${config.remotes[name]?.url ?? ""}`);
  }
}

async function showProfile(argv: string[]): Promise<void> {
  const { config } = await readConfig();
  const name = argv[0] ?? config.active;
  if (!name) fail("no active profile; pass a name or run: synchronize remote use <name>");
  const profile = resolveProfile(config, name);
  if (!profile) fail(`no such profile: ${name}`);
  // resolveConnection shows what ensureDaemon would actually use (env overrides included).
  const resolved = name === config.active ? resolveConnection(config) : null;
  console.log(
    JSON.stringify(
      { name, active: name === config.active, profile, resolved_connection: resolved },
      null,
      2,
    ),
  );
}

async function removeProfile(argv: string[]): Promise<void> {
  const name = argv[0];
  if (!name) fail("remote remove requires a <name>");
  const { config, path } = await readConfig();
  if (!config.remotes[name]) fail(`no such profile: ${name}`);
  await writeConfig(path, removeProfileFromConfig(config, name));
  console.log(`profile '${name}' removed`);
}

async function provisionRemote(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const sshHost = flags.positional[0];
  if (!sshHost) fail("remote provision requires an <ssh-host>");
  const plan = buildProvisionPlan({ sshHost });
  await runPlan(plan, { dryRun: flags.bools.has("dry-run") });
}

async function syncRemote(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const sshHost = flags.positional[0];
  if (!sshHost) fail("remote sync requires an <ssh-host>");
  const hubUrl = flags.opts["hub-url"];
  if (!hubUrl) fail("remote sync requires --hub-url <url>");
  const remotePath = flags.opts.path ?? "~/synchronize-runtime";
  // Sync from the repo root (two levels up from src/cli/commands), not cwd.
  const localRoot = flags.opts["local-root"] ?? resolve(import.meta.dir, "../../..");
  const plan = buildSyncPlan({
    sshHost,
    remotePath,
    localRoot,
    hubUrl,
    ...(flags.opts.token ? { token: flags.opts.token } : {}),
    ...(flags.opts["token-env"] ? { tokenEnv: flags.opts["token-env"] } : {}),
    ...(flags.opts["daemon-bind"] ? { daemonBind: flags.opts["daemon-bind"] } : {}),
    ...(positiveFlag(flags, "lease-ms")),
    ...(positiveFlag(flags, "peer-retention-ms")),
    ...(positiveFlag(flags, "sweep-interval-ms")),
    skipInstall: flags.bools.has("skip-install"),
  });
  await runPlan(plan, { dryRun: flags.bools.has("dry-run") });
}

async function harnessRemote(argv: string[]): Promise<void> {
  // Split off pass-through scenario args after `--`.
  const dashdash = argv.indexOf("--");
  const head = dashdash >= 0 ? argv.slice(0, dashdash) : argv;
  const extraArgs = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
  const flags = parseFlags(head);
  const sshHost = flags.positional[0];
  if (!sshHost) fail("remote harness requires an <ssh-host>");
  const hubUrl = flags.opts["hub-url"];
  if (!hubUrl) fail("remote harness requires --hub-url <url>");
  const remotePath = flags.opts.path ?? "~/synchronize-runtime";
  const scenarios = flags.bools.has("all")
    ? ALL_HARNESS_SCENARIOS
    : flags.opts.scenario
      ? [flags.opts.scenario]
      : fail("remote harness requires --scenario <name> or --all");
  const plan = buildHarnessPlan({
    sshHost,
    remotePath,
    hubUrl,
    ...(flags.opts.token ? { token: flags.opts.token } : {}),
    scenarios,
    extraArgs,
  });
  await runPlan(plan, { dryRun: flags.bools.has("dry-run"), continueOnError: true });
}

async function statusRemote(): Promise<void> {
  const client = await ensureDaemon();
  const [status, peersResponse, config] = await Promise.all([
    getStatus(client),
    listPeers(client),
    loadConfig(getRuntimePaths().configPath),
  ]);
  const peers = ("peers" in peersResponse ? peersResponse.peers : []) as Peer[];
  const lines = renderStatusReport({
    source: {
      remoteUrl: client.remote ? client.baseUrl : null,
      profileName: client.remote ? config.active ?? null : null,
    },
    status,
    peers,
    localApiVersion: API_VERSION,
  });
  console.log(lines.join("\n"));
}

async function doctorRemote(): Promise<void> {
  const config = await loadConfig(getRuntimePaths().configPath);
  const conn = resolveConnection(config);
  const input: DoctorInput = {
    profileName: config.active ?? null,
    remoteUrl: conn.remoteUrl,
    reachable: null,
    authOk: null,
    hubApiVersion: null,
    localApiVersion: API_VERSION,
  };
  if (conn.remoteUrl) {
    const health = await probe(`${conn.remoteUrl}/health`, null);
    input.reachable = health.ok;
    input.hubApiVersion = health.apiVersion;
    if (health.ok) {
      const statusProbe = await probe(`${conn.remoteUrl}/status`, conn.token);
      input.authOk = statusProbe.status === 401 ? false : statusProbe.ok ? true : null;
      if (statusProbe.apiVersion !== null) input.hubApiVersion = statusProbe.apiVersion;
    }
  }
  console.log(renderDoctor(evaluateDoctor(input)).join("\n"));
  if (evaluateDoctor(input).some((c) => c.status === "fail")) process.exit(1);
}

// Gentle HTTP probe for doctor — never throws; returns reachability + api_version.
async function probe(url: string, token: string | null): Promise<{ ok: boolean; status: number; apiVersion: number | null }> {
  try {
    const headers = new Headers({ accept: "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    const body = (await response.json().catch(() => null)) as { api_version?: number; provenance?: { api_version?: number } } | null;
    const apiVersion = body?.api_version ?? body?.provenance?.api_version ?? null;
    return { ok: response.ok, status: response.status, apiVersion };
  } catch {
    return { ok: false, status: 0, apiVersion: null };
  }
}

// Execute a remote plan step-by-step, streaming output. --dry-run prints the
// exact argv (and a note for any piped stdin) without touching the remote.
// continueOnError keeps going after a failed step and prints a pass/fail summary
// (used for the harness suite — one failing scenario shouldn't hide the rest).
async function runPlan(plan: RemoteStep[], opts: { dryRun: boolean; continueOnError?: boolean }): Promise<void> {
  const results: Array<{ name: string; code: number }> = [];
  for (const step of plan) {
    const rendered = step.argv.map(shellPreview).join(" ");
    if (opts.dryRun) {
      console.log(`[dry-run] ${step.name}${step.optional ? " (optional)" : ""}`);
      console.log(`          ${rendered}${step.stdin ? "   # + piped stdin" : ""}`);
      continue;
    }
    console.log(`\n▶ ${step.name}${step.optional ? " (optional)" : ""}`);
    console.log(`  ${rendered}`);
    const proc = Bun.spawn({
      cmd: step.argv,
      stdin: step.stdin ? new TextEncoder().encode(step.stdin) : "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    results.push({ name: step.name, code });
    if (code !== 0) {
      if (step.optional) {
        console.error(`  ⚠ ${step.name} failed (exit ${code}); continuing (optional)`);
        continue;
      }
      if (opts.continueOnError) {
        console.error(`  ✗ ${step.name} failed (exit ${code}); continuing`);
        continue;
      }
      fail(`✗ ${step.name} failed (exit ${code})`);
    }
  }
  if (opts.dryRun) return;
  const failed = results.filter((r) => r.code !== 0);
  if (opts.continueOnError && results.length > 1) {
    console.log(`\n=== summary: ${results.length - failed.length}/${results.length} passed ===`);
    for (const r of results) console.log(`  ${r.code === 0 ? "✓" : "✗"} ${r.name}`);
  }
  if (failed.length > 0) fail(`\n✗ ${failed.length} step(s) failed`);
  console.log("\n✓ remote plan complete");
}

function shellPreview(arg: string): string {
  return /[\s'"$]/.test(arg) ? JSON.stringify(arg) : arg;
}

interface Flags {
  positional: string[];
  opts: Record<string, string>;
  bools: Set<string>;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { positional: [], opts: {}, bools: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags.bools.add(key); // boolean flag (e.g. --use)
      } else {
        flags.opts[key] = next;
        i++;
      }
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function positiveFlag(flags: Flags, key: "lease-ms" | "peer-retention-ms" | "sweep-interval-ms"): Partial<Record<"leaseMs" | "peerRetentionMs" | "sweepIntervalMs", number>> {
  const raw = flags.opts[key];
  if (raw === undefined) return {};
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) fail(`--${key} must be a positive number`);
  const prop = key === "lease-ms" ? "leaseMs" : key === "peer-retention-ms" ? "peerRetentionMs" : "sweepIntervalMs";
  return { [prop]: Math.trunc(n) };
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
