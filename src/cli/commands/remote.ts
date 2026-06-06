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

// `synchronize remote` — the multi-machine control plane. v0 (sync-7mcv) covers
// profile management (add/use/ls/show); provision/sync/upgrade/status land in
// later phases (sync-nxyp/sync-qqw8/sync-i01i).
const USAGE = `synchronize remote <subcommand>

  add <name> --url <url> [--token-env <ENV>] [--token <literal>]
             [--health-timeout-ms <n>] [--ssh-host <host>] [--use]
  use <name>                 set the active profile
  ls                         list profiles (active marked with *)
  show [name]                show a profile (default: active), with resolved connection
  remove <name>              delete a profile`;

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

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
