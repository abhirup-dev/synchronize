import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { aoeProfileName } from "../src/launch/service.ts";

type Tool = "claude" | "pi";

interface Args {
  baseUrl: string;
  home: string;
  repo: string;
  group: string;
  tool: Tool;
  prefix: string;
  count: number;
  mode: "sequential" | "parallel";
  timeoutMs: number;
  pollMs: number;
}

interface LaunchResponse {
  launchId: string;
  peerId: string;
  sessionName: string;
  title: string;
  group?: string;
}

interface WebState {
  launch_lifecycle: Array<{
    launch_id: string;
    peer_id: string;
    session_name: string;
    target_group: string | null;
    backend_title: string;
    state: string;
    failure_code: string | null;
    failure_message: string | null;
  }>;
  groups: Array<{ group_id: number; name: string }>;
  memberships: Array<{ group_id: number; peer_id: string; alias: string; active: boolean }>;
  peers: Array<{ peer_id: string; session_name: string; online: boolean; presence?: string }>;
}

const args = parseArgs(process.argv.slice(2));
const dbPath = join(args.home, "synchronize.db");
const db = existsSync(dbPath) ? new Database(dbPath, { readonly: true }) : null;
const launched: LaunchResponse[] = [];

try {
  console.log(
    JSON.stringify(
      {
        event: "stress.start",
        baseUrl: args.baseUrl,
        home: args.home,
        repo: args.repo,
        group: args.group,
        tool: args.tool,
        profile: aoeProfileName(args.home),
        mode: args.mode,
        count: args.count,
      },
      null,
      2,
    ),
  );

  if (args.mode === "sequential") {
    for (let index = 1; index <= args.count; index += 1) {
      const launch = await launchOne(index);
      launched.push(launch);
      await waitForLaunch(launch);
    }
  } else {
    launched.push(...(await Promise.all(Array.from({ length: args.count }, (_, index) => launchOne(index + 1)))));
    await Promise.all(launched.map((launch) => waitForLaunch(launch)));
  }

  const finalState = await fetchState();
  const rows = launched.map((launch) => summarizeLaunch(finalState, launch));
  console.table(rows);
  const failed = rows.filter((row) => row.ok !== true);
  console.log(JSON.stringify({ event: "stress.done", ok: failed.length === 0, failed: failed.length, rows }, null, 2));
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  db?.close();
}

async function launchOne(index: number): Promise<LaunchResponse> {
  const name = `${args.prefix}${index}`;
  const startedAt = Date.now();
  const response = await fetch(`${args.baseUrl}/agent-sessions/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: args.tool,
      name,
      repo: args.repo,
      group: args.group,
    }),
  });
  const body = (await response.json().catch(() => null)) as LaunchResponse | { error?: unknown } | null;
  if (!response.ok || !body || !("launchId" in body)) {
    throw new Error(`launch ${name} failed HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  console.log(JSON.stringify({ event: "launch.accepted", name, ms: Date.now() - startedAt, ...body }));
  return body;
}

async function waitForLaunch(launch: LaunchResponse): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  let lastState = "missing";
  while (Date.now() < deadline) {
    const state = await fetchState();
    const summary = summarizeLaunch(state, launch);
    if (summary.state !== lastState) {
      lastState = summary.state;
      console.log(JSON.stringify({ event: "launch.state", launchId: launch.launchId, ...summary }));
    }
    if (summary.ok) return;
    if (["failed", "registered_unjoined", "stale", "stopped"].includes(summary.state)) return;
    await Bun.sleep(args.pollMs);
  }
  const state = await fetchState();
  console.log(JSON.stringify({ event: "launch.timeout", launchId: launch.launchId, ...summarizeLaunch(state, launch) }));
}

async function fetchState(): Promise<WebState> {
  const response = await fetch(`${args.baseUrl}/web/state`);
  if (!response.ok) throw new Error(`/web/state failed HTTP ${response.status}`);
  return response.json() as Promise<WebState>;
}

function summarizeLaunch(state: WebState, launch: LaunchResponse): Record<string, unknown> {
  const lifecycle = state.launch_lifecycle.find((row) => row.launch_id === launch.launchId);
  const groupId = state.groups.find((group) => group.name === args.group)?.group_id;
  const member = groupId
    ? state.memberships.find((row) => row.group_id === groupId && row.peer_id === launch.peerId && row.active)
    : undefined;
  const peer = state.peers.find((row) => row.peer_id === launch.peerId);
  const dbRow = readDbLaunch(launch.launchId);
  const stateName = lifecycle?.state ?? dbRow?.state ?? "missing";
  const joined = Boolean(member);
  return {
    launchId: launch.launchId,
    name: launch.sessionName,
    peerId: launch.peerId,
    title: launch.title,
    state: stateName,
    joined,
    online: peer?.online ?? false,
    presence: peer?.presence ?? null,
    failure: lifecycle?.failure_code ?? dbRow?.failure_code ?? null,
    message: lifecycle?.failure_message ?? dbRow?.failure_message ?? null,
    ok: stateName === "running" && joined,
  };
}

function readDbLaunch(launchId: string): { state: string; failure_code: string | null; failure_message: string | null } | null {
  if (!db) return null;
  return (
    db
      .query<{ state: string; failure_code: string | null; failure_message: string | null }, [string]>(
        "SELECT state, failure_code, failure_message FROM launch_intents WHERE launch_id = ?",
      )
      .get(launchId) ?? null
  );
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    values.set(key.slice(2), value);
    index += 1;
  }
  const mode = (values.get("mode") ?? "sequential") as Args["mode"];
  if (mode !== "sequential" && mode !== "parallel") throw new Error("--mode must be sequential or parallel");
  const tool = (values.get("tool") ?? "claude") as Tool;
  if (tool !== "claude" && tool !== "pi") throw new Error("--tool must be claude or pi");
  const home = values.get("home") ?? process.env.SYNCHRONIZE_HOME;
  if (!home) throw new Error("--home or SYNCHRONIZE_HOME is required");
  const baseUrl = values.get("base-url");
  if (!baseUrl) throw new Error("--base-url is required");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    home: resolve(home),
    repo: resolve(values.get("repo") ?? process.cwd()),
    group: values.get("group") ?? "release-checks",
    tool,
    prefix: values.get("prefix") ?? (mode === "parallel" ? "lp" : "ls"),
    count: positiveInt(values.get("count"), 5),
    mode,
    timeoutMs: positiveInt(values.get("timeout-ms"), 180_000),
    pollMs: positiveInt(values.get("poll-ms"), 2_000),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`expected positive integer, got ${raw}`);
  return Math.floor(parsed);
}
