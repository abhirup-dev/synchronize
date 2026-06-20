#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface DaemonStatus {
  base_url: string;
  pid: number;
  home: string;
  db_path: string;
  media_path: string;
  counts?: {
    peers?: number;
    groups?: number;
    events?: number;
  };
  provenance?: {
    source_root?: string;
    git_sha?: string;
    git_dirty?: boolean;
  };
}

interface DaemonJson {
  baseUrl?: string;
  base_url?: string;
  dbPath?: string;
  db_path?: string;
  host?: string;
  mediaPath?: string;
  media_path?: string;
  pid: number;
  port?: number;
  provenance?: DaemonStatus["provenance"];
}

interface AdapterStatus {
  ok: boolean;
  name: string;
  detail: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = join(repoRoot, "tools/ui-probe/artifacts/latest");
const snapshotHome = join(artifactDir, "snapshot-home");
const args = new Set(Bun.argv.slice(2));
const runAdapters = !args.has("--no-adapters");
const keepDaemon = args.has("--keep-daemon");

async function main(): Promise<void> {
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });

  const source = await discoverDaemon();
  await writeFile(join(artifactDir, "source-daemon.json"), JSON.stringify(source, null, 2));

  await run("bun", ["run", "tools/ui-probe/flowbook.ts", "check", "--artifact-dir", artifactDir], {
    cwd: repoRoot,
    label: "flowbook check",
  });
  await run("bun", ["run", "build"], { cwd: join(repoRoot, "web"), label: "web build" });
  await prepareSnapshot(source);

  const daemon = await startSnapshotDaemon();
  const adapterStatuses = runAdapters ? await checkAdapters() : [];
  let playwright: CommandResult | null = null;
  let state: unknown = null;

  try {
    state = await fetchProbeState(daemon.status.base_url);
    await writeFile(join(artifactDir, "web-state.json"), JSON.stringify(state, null, 2));

    playwright = await run("bunx", ["playwright", "test", "-c", "tools/ui-probe/playwright.config.ts"], {
      cwd: repoRoot,
      env: {
        UI_PROBE_BASE_URL: daemon.status.base_url,
        UI_PROBE_STATE_JSON: join(artifactDir, "web-state.json"),
        UI_PROBE_ARTIFACT_DIR: artifactDir,
      },
      label: "playwright probes",
      allowFailure: true,
    });
  } finally {
    if (!keepDaemon) await daemon.stop();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: "real-data-snapshot",
    sourceDaemon: source,
    probeDaemon: daemon.status,
    artifactDir,
    stateCounts: summarizeState(state),
    adapters: adapterStatuses,
    playwright: playwright ? { code: playwright.code } : null,
    cleanup: { snapshotDaemonStopped: !keepDaemon },
  };

  await writeFile(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(join(artifactDir, "summary.md"), renderSummary(summary));

  if (!playwright || playwright.code !== 0) {
    process.exitCode = playwright?.code ?? 1;
  }
}

async function discoverDaemon(): Promise<DaemonStatus> {
  const result = await run("bun", ["run", "src/cli.ts", "status"], { cwd: repoRoot, label: "daemon status" });
  const start = result.stdout.indexOf("{");
  if (start < 0) throw new Error(`Could not parse daemon status JSON:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.slice(start)) as DaemonStatus;
}

async function prepareSnapshot(source: DaemonStatus): Promise<void> {
  await mkdir(snapshotHome, { recursive: true });
  const snapshotDb = join(snapshotHome, "synchronize.db");
  await run("sqlite3", [source.db_path, `.backup '${snapshotDb}'`], { cwd: repoRoot, label: "sqlite backup" });
  if (existsSync(source.media_path)) {
    await cp(source.media_path, join(snapshotHome, "media"), { recursive: true });
  }
}

async function startSnapshotDaemon(): Promise<{ status: DaemonStatus; stop: () => Promise<void> }> {
  const child = spawn("bun", ["run", "src/daemon.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: snapshotHome,
      SYNCHRONIZE_BIND: "127.0.0.1",
      SYNCHRONIZE_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const daemonJson = join(snapshotHome, "daemon.json");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (existsSync(daemonJson)) {
      const status = normalizeDaemonJson(JSON.parse(await readFile(daemonJson, "utf8")) as DaemonJson);
      await waitForHttp(`${status.base_url}/web`);
      await writeFile(join(artifactDir, "snapshot-daemon.log"), stdout + stderr);
      return {
        status: {
          ...status,
          home: snapshotHome,
          db_path: join(snapshotHome, "synchronize.db"),
          media_path: join(snapshotHome, "media"),
        },
        stop: async () => {
          if (child.exitCode !== null) return;
          child.kill("SIGINT");
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              if (child.exitCode === null) child.kill("SIGKILL");
              resolve();
            }, 3_000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        },
      };
    }
    await sleep(250);
  }
  throw new Error(`Snapshot daemon did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function normalizeDaemonJson(value: DaemonJson): DaemonStatus {
  const baseUrl = value.base_url ?? value.baseUrl ?? (value.host && value.port ? `http://${value.host}:${value.port}` : undefined);
  if (!baseUrl) throw new Error(`daemon.json did not include baseUrl/base_url: ${JSON.stringify(value)}`);
  return {
    base_url: baseUrl,
    pid: value.pid,
    home: snapshotHome,
    db_path: value.db_path ?? value.dbPath ?? join(snapshotHome, "synchronize.db"),
    media_path: value.media_path ?? value.mediaPath ?? join(snapshotHome, "media"),
    provenance: value.provenance,
  };
}

async function checkAdapters(): Promise<AdapterStatus[]> {
  const statuses: AdapterStatus[] = [];
  statuses.push(await checkVibeProxy());
  statuses.push(await checkStagehand());
  statuses.push(await checkHelp("libretto", "bunx", ["libretto", "help"], { LIBRETTO_DISABLE_DOTENV: "1" }));
  statuses.push(await checkHelp("chrome-devtools-mcp", "bunx", ["chrome-devtools-mcp", "--help"]));
  statuses.push(await checkHelp("playwright-mcp", "bunx", ["playwright-mcp", "--help"]));
  return statuses;
}

async function checkVibeProxy(): Promise<AdapterStatus> {
  try {
    const models = await fetchJson("http://127.0.0.1:8318/v1/models") as { data?: Array<{ id: string }> };
    const ids = models.data?.map((model) => model.id) ?? [];
    if (!ids.includes("gpt-5.5")) return { name: "vibeproxy", ok: false, detail: "server reachable but gpt-5.5 not listed" };
    const response = await fetch("http://127.0.0.1:8318/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer dummy" },
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "Reply with exactly OK." }],
        max_completion_tokens: 32,
        stream: false,
      }),
    });
    const text = await response.text();
    if (!response.ok) return { name: "vibeproxy", ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 180)}` };
    const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    return { name: "vibeproxy", ok: content.trim() === "OK", detail: `gpt-5.5 completion returned ${JSON.stringify(content.trim())}` };
  } catch (error) {
    return { name: "vibeproxy", ok: false, detail: errorMessage(error) };
  }
}

async function checkStagehand(): Promise<AdapterStatus> {
  try {
    const mod = await import("@browserbasehq/stagehand");
    const available = typeof mod.Stagehand === "function";
    return {
      name: "stagehand",
      ok: available,
      detail: available
        ? "package imports; configure model with baseURL=http://127.0.0.1:8318/v1 and modelName=openai/gpt-5.5"
        : "Stagehand export not found",
    };
  } catch (error) {
    return { name: "stagehand", ok: false, detail: errorMessage(error) };
  }
}

async function checkHelp(name: string, command: string, commandArgs: string[], extraEnv: Record<string, string> = {}): Promise<AdapterStatus> {
  const result = await run(command, commandArgs, {
    cwd: repoRoot,
    env: extraEnv,
    label: `${name} help`,
    allowFailure: true,
  });
  return {
    name,
    ok: result.code === 0,
    detail: result.code === 0 ? "help command succeeded" : `${result.stderr || result.stdout}`.slice(0, 200),
  };
}

async function run(
  command: string,
  commandArgs: string[],
  opts: { cwd: string; env?: Record<string, string>; label: string; allowFailure?: boolean },
): Promise<CommandResult> {
  const child = spawn(command, commandArgs, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number>((resolve) => {
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
  const result = { code, stdout, stderr };
  await writeFile(join(artifactDir, `${slug(opts.label)}.log`), renderCommandLog(command, commandArgs, result));
  if (code !== 0 && !opts.allowFailure) {
    throw new Error(`${opts.label} failed with ${code}\n${stdout}\n${stderr}`);
  }
  return result;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function fetchProbeState(baseUrl: string): Promise<unknown> {
  const summary = await fetchJson(`${baseUrl}/web/state?limit=250`) as {
    groups?: Array<{ group_id: number }>;
  };
  const firstGroupId = summary.groups?.[0]?.group_id;
  if (!firstGroupId) return summary;
  return fetchJson(`${baseUrl}/web/state?room=${encodeURIComponent(`group:${firstGroupId}`)}&since=0&limit=250`);
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry until the daemon is ready.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function summarizeState(state: unknown): Record<string, number> {
  const value = state as { peers?: unknown[]; groups?: unknown[]; events?: unknown[]; media?: unknown[] };
  return {
    peers: value.peers?.length ?? 0,
    groups: value.groups?.length ?? 0,
    events: value.events?.length ?? 0,
    media: value.media?.length ?? 0,
  };
}

function renderSummary(summary: {
  generatedAt: string;
  mode: string;
  sourceDaemon: DaemonStatus;
  probeDaemon: DaemonStatus;
  artifactDir: string;
  stateCounts: Record<string, number>;
  adapters: AdapterStatus[];
  playwright: { code: number } | null;
  cleanup: { snapshotDaemonStopped: boolean };
}): string {
  const adapters = summary.adapters.length
    ? summary.adapters.map((adapter) => `- ${adapter.ok ? "ok" : "warn"} ${adapter.name}: ${adapter.detail}`).join("\n")
    : "- skipped";
  return `# UI Probe Summary

Generated: ${summary.generatedAt}
Mode: ${summary.mode}

## Target

- Source daemon: ${summary.sourceDaemon.base_url}
- Source home: ${summary.sourceDaemon.home}
- Probe daemon: ${summary.probeDaemon.base_url}
- Probe home: ${summary.probeDaemon.home}
- Artifact dir: ${summary.artifactDir}

## Real Data Snapshot

- Peers: ${summary.stateCounts.peers}
- Groups: ${summary.stateCounts.groups}
- Events: ${summary.stateCounts.events}
- Media: ${summary.stateCounts.media}

## Probe Result

- Playwright exit code: ${summary.playwright?.code ?? "not-run"}
- Snapshot daemon stopped: ${summary.cleanup.snapshotDaemonStopped}

## Adapter Readiness

${adapters}
`;
}

function renderCommandLog(command: string, commandArgs: string[], result: CommandResult): string {
  return `$ ${command} ${commandArgs.join(" ")}
exit=${result.code}

--- stdout ---
${result.stdout}

--- stderr ---
${result.stderr}
`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch(async (error) => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "fatal-error.txt"), errorMessage(error));
  console.error(error);
  process.exit(1);
});
