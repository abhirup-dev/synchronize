import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LaunchService,
  LaunchValidationError,
  aoeAttachCommand,
  aoeProfileName,
  aoeTitle,
  normalizeLaunchAlias,
  provisionPiLaunchRuntime,
  resolveLaunchSpec,
  validateLaunchRequest,
} from "../src/launch/service.ts";
import type { LaunchSpec, SessionBackend } from "../src/launch/backend.ts";
import { ENV_HOME, ENV_PEER_ID, ENV_SESSION_NAME } from "../src/constants.ts";
import { openDatabase } from "../src/db.ts";
import { getLaunchIntent, listLaunchEvents, listLaunchWork } from "../src/launch/store.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("provisionPiLaunchRuntime clears a stale pi mcp-cache.json so MCP reconnects on relaunch", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-pi-cache-"));
  dirs.push(home);
  const piHome = join(home, "pi-agent");
  await mkdir(piHome, { recursive: true });
  const cachePath = join(piHome, "mcp-cache.json");
  await writeFile(
    cachePath,
    JSON.stringify({ version: 1, servers: { synchronize: { configHash: "stale", tools: [], resources: [], cachedAt: 1 } } }),
  );
  expect(existsSync(cachePath)).toBe(true);

  // Regression (sync-wgtp): on a cache HIT Pi serves cached tool schemas but does not
  // eagerly establish the live MCP connection (boots "MCP: 0/1"). Provisioning must
  // delete the cache so each (re)launch reconnects. The clear runs before auth setup,
  // so catch the possible auth-unavailable throw in CI — the cache removal is the assertion.
  await provisionPiLaunchRuntime({ home, repoRoot: process.cwd() }).catch(() => {});

  expect(existsSync(cachePath)).toBe(false);
});

function fakeBackend(opts: { failSpawn?: boolean } = {}): { backend: SessionBackend; spawned: LaunchSpec[]; stopped: string[] } {
  const spawned: LaunchSpec[] = [];
  const stopped: string[] = [];
  const backend: SessionBackend = {
    ensureReady: async () => {},
    spawn: async (spec) => {
      if (opts.failSpawn) throw new Error("spawn boom");
      spawned.push(spec);
    },
    stop: async (title) => {
      stopped.push(title);
    },
    list: async () => [],
  };
  return { backend, spawned, stopped };
}

function promptBackend(opts: { failSpawn?: boolean; failPrompt?: boolean; promptAccepted?: boolean; existingTitles?: string[] } = {}): {
  backend: SessionBackend;
  spawned: LaunchSpec[];
  confirmed: string[];
} {
  const spawned: LaunchSpec[] = [];
  const confirmed: string[] = [];
  return {
    spawned,
    confirmed,
    backend: {
      ensureReady: async () => {},
      spawn: async (spec) => {
        if (opts.failSpawn) throw new Error("spawn boom");
        spawned.push(spec);
      },
      confirmPrompt: async (title) => {
        if (opts.failPrompt) throw new Error("prompt boom");
        confirmed.push(title);
        if (opts.promptAccepted === false) return false;
        return true;
      },
      stop: async () => {},
      list: async () => [
        ...(opts.existingTitles ?? []).map((title) => ({ title })),
        ...spawned.map((spec) => ({ title: spec.title })),
      ],
    },
  };
}

const fakePiRuntime = async () => ({
  PI_CODING_AGENT_DIR: "/tmp/pi-agent",
  PI_CODING_AGENT_SESSION_DIR: "/tmp/pi-sessions",
});

test("validateLaunchRequest accepts a minimal valid body", () => {
  const req = validateLaunchRequest({ tool: "claude", name: "Alice", repo: "/r" });
  expect(req).toEqual({ tool: "claude", name: "alice", repo: "/r" });
});

test("validateLaunchRequest keeps group + args and trims", () => {
  const req = validateLaunchRequest({
    tool: "pi",
    name: " Bob ",
    repo: " /x ",
    group: " alpha ",
    model: "gpt-5.5",
    thinking: "medium",
    args: ["--foo"],
  });
  expect(req).toEqual({
    tool: "pi",
    name: "bob",
    repo: "/x",
    group: "alpha",
    model: "gpt-5.5",
    thinking: "medium",
    args: ["--foo"],
  });
});

test("validateLaunchRequest rejects bad tool/name/repo/args", () => {
  expect(() => validateLaunchRequest({ tool: "codex", name: "a", repo: "/r" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "", repo: "/r" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "this-name-is-too-long", repo: "/r" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "a" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "a", repo: "/r", args: [1] })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "a", repo: "/r", model: "haiku" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "pi", name: "a", repo: "/r", model: "gpt-4o" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "pi", name: "a", repo: "/r", thinking: "xhigh" })).toThrow(LaunchValidationError);
});

test("aoeProfileName is deterministic per home and varies across homes", () => {
  expect(aoeProfileName("/a")).toBe(aoeProfileName("/a"));
  expect(aoeProfileName("/a")).not.toBe(aoeProfileName("/b"));
  expect(aoeProfileName("/a").startsWith("synchronize-")).toBe(true);
});

test("normalizeLaunchAlias lowercases, slugifies, and enforces the 11-char budget", () => {
  expect(normalizeLaunchAlias(" Alice Bob ")).toBe("alice-bob");
  expect(() => normalizeLaunchAlias("this-name-is-too-long")).toThrow(LaunchValidationError);
});

test("aoeTitle is deterministic, hash-prefixed, human-readable, and <= 20 chars", () => {
  const input = {
    launchId: "launch-123",
    peerId: "35742454d0934b6a",
    group: "alpha",
    sessionName: "alice",
    tool: "claude" as const,
  };
  const title = aoeTitle(input);
  expect(title).toMatch(/^[a-z2-7]{8}-alice$/);
  expect(title.length).toBeLessThanOrEqual(20);
  expect(aoeTitle(input)).toBe(title);
  expect(aoeTitle({ ...input, peerId: "other-peer" })).not.toBe(title);
});

test("aoeAttachCommand returns a pasteable AOE attach command", () => {
  expect(aoeAttachCommand("synchronize-test", "abc12345-alice")).toBe(
    "aoe -p synchronize-test session attach abc12345-alice",
  );
  expect(aoeAttachCommand("sync profile", "agent's session")).toBe(
    "aoe -p 'sync profile' session attach 'agent'\\''s session'",
  );
});

test("resolveLaunchSpec wires title, command, env, cwd, group", () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/repo", group: "alpha", model: "claude-opus-4-8", thinking: "medium", args: ["--model", "claude-haiku-4-5-20251001"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.title).toMatch(/^[a-z2-7]{8}-alice$/);
  expect(spec.title.length).toBeLessThanOrEqual(20);
  expect(spec.tool).toBe("claude");
  expect(spec.command[0]).toBe("claude");
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("claude-opus-4-8");
  expect(spec.command[spec.command.indexOf("--effort") + 1]).toBe("medium");
  expect(spec.command).not.toContain("claude-haiku-4-5-20251001");
  expect(spec.cwd).toBe("/repo");
  expect(spec.group).toBe("alpha");
  expect(spec.env[ENV_PEER_ID]).toBe("peer-abcdef12");
  expect(spec.env[ENV_SESSION_NAME]).toBe("alice");
  expect(spec.env[ENV_HOME]).toBe("/home");
});

test("resolveLaunchSpec defaults claude to Haiku high when no model given", async () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/r" },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  const i = spec.command.indexOf("--model");
  expect(i).toBeGreaterThan(-1);
  expect(spec.command[i + 1]).toBe("claude-haiku-4-5-20251001");
  expect(spec.command[spec.command.indexOf("--effort") + 1]).toBe("high");
});

test("resolveLaunchSpec strips caller-provided claude --model before applying selected model", async () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/r", model: "claude-sonnet-4-6", args: ["--model", "claude-opus-4-8"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command.filter((a) => a === "--model")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("claude-sonnet-4-6");
  expect(spec.command[spec.command.indexOf("--effort") + 1]).toBe("medium");
  expect(spec.command).not.toContain("claude-opus-4-8");
});

test("resolveLaunchSpec strips caller-provided claude --model=value and --effort before applying selected defaults", async () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/r", args: ["--model=claude-opus-4-8", "--effort=medium"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command.filter((a) => a === "--model")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("claude-haiku-4-5-20251001");
  expect(spec.command[spec.command.indexOf("--effort") + 1]).toBe("high");
  expect(spec.command).not.toContain("--model=claude-opus-4-8");
  expect(spec.command).not.toContain("--effort=medium");
});

test("resolveLaunchSpec defaults pi to OpenAI Codex GPT 5.4 mini high in daemon launches", async () => {
  const spec = resolveLaunchSpec(
    { tool: "pi", name: "bob", repo: "/r" },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command.filter((a) => a === "--provider")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--provider") + 1]).toBe("openai-codex");
  expect(spec.command.filter((a) => a === "--model")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("gpt-5.4-mini");
  expect(spec.command[spec.command.indexOf("--thinking") + 1]).toBe("high");
});

test("resolveLaunchSpec applies selected pi model and thinking", async () => {
  const spec = resolveLaunchSpec(
    { tool: "pi", name: "bob", repo: "/r", model: "gpt-5.5", thinking: "medium", args: ["--model", "expensive-model"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command.filter((a) => a === "--provider")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--provider") + 1]).toBe("openai-codex");
  expect(spec.command.filter((a) => a === "--model")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("gpt-5.5");
  expect(spec.command[spec.command.indexOf("--thinking") + 1]).toBe("medium");
  expect(spec.command).not.toContain("expensive-model");
});

test("resolveLaunchSpec strips caller-provided pi --provider and --thinking before applying launch defaults", async () => {
  const spec = resolveLaunchSpec(
    { tool: "pi", name: "bob", repo: "/r", args: ["--provider=azure-openai-responses", "--model=gpt-5.4", "--thinking=low"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command.filter((a) => a === "--provider")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--provider") + 1]).toBe("openai-codex");
  expect(spec.command.filter((a) => a === "--model")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("gpt-5.4-mini");
  expect(spec.command[spec.command.indexOf("--thinking") + 1]).toBe("high");
  expect(spec.command).not.toContain("--provider=azure-openai-responses");
  expect(spec.command).not.toContain("--model=gpt-5.4");
  expect(spec.command).not.toContain("--thinking=low");
});

test("launch records pending, spawns, and returns identity + count", async () => {
  const { backend, spawned } = fakeBackend();
  let n = 0;
  const svc = new LaunchService({
    backend,
    home: "/home",
    provisionPiRuntime: fakePiRuntime,
    mintLaunchId: () => `lid-${++n}`,
    mintPeerId: () => `peer-${n}aaaaaaa`,
  });
  const res = await svc.launch({ tool: "pi", name: "bob", repo: "/r", group: "g" });
  expect(res.launchId).toBe("lid-1");
  expect(res.peerId).toBe("peer-1aaaaaaa");
  expect(res.sessionName).toBe("bob");
  expect(res.title).toMatch(/^[a-z2-7]{8}-bob$/);
  expect(res.title.length).toBeLessThanOrEqual(20);
  expect(res.group).toBe("g");
  expect(res.pendingCount).toBe(1);
  expect(res.warning).toContain("not yet registered");
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.env.PI_CODING_AGENT_DIR).toBe("/tmp/pi-agent");
  expect(spawned[0]?.env.PI_CODING_AGENT_SESSION_DIR).toBe("/tmp/pi-sessions");
  expect(svc.pending()).toHaveLength(1);
});

test("consume returns and removes the pending launch exactly once (matching peer)", async () => {
  const { backend } = fakeBackend();
  const svc = new LaunchService({ backend, home: "/h", mintLaunchId: () => "L", mintPeerId: () => "Pxxxxxxx" });
  await svc.launch({ tool: "claude", name: "c", repo: "/r", group: "team" });
  const consumed = svc.consume("L", "Pxxxxxxx");
  expect(consumed?.group).toBe("team");
  expect(consumed?.alias).toBe("c");
  expect(consumed?.peerId).toBe("Pxxxxxxx");
  expect(svc.consume("L", "Pxxxxxxx")).toBeUndefined();
  expect(svc.pending()).toHaveLength(0);
});

test("consume with a mismatched peer_id is ignored and leaves the intent intact", async () => {
  const { backend } = fakeBackend();
  const svc = new LaunchService({ backend, home: "/h", mintLaunchId: () => "L", mintPeerId: () => "Pxxxxxxx" });
  await svc.launch({ tool: "claude", name: "c", repo: "/r", group: "team" });
  expect(svc.consume("L", "imposter-peer")).toBeUndefined();
  // intent preserved so the genuinely-launched agent can still reconcile
  expect(svc.pending()).toHaveLength(1);
  expect(svc.consume("L", "Pxxxxxxx")?.group).toBe("team");
});

test("forgetByTitle drops a pending launch stopped before it registered", async () => {
  const { backend } = fakeBackend();
  const svc = new LaunchService({ backend, home: "/h", mintLaunchId: () => "L", mintPeerId: () => "Pabcd123" });
  const res = await svc.launch({ tool: "claude", name: "c", repo: "/r" });
  expect(svc.pending()).toHaveLength(1);
  svc.forgetByTitle(res.title);
  expect(svc.pending()).toHaveLength(0);
});

test("a failed spawn does not leave a pending launch", async () => {
  const { backend } = fakeBackend({ failSpawn: true });
  const svc = new LaunchService({ backend, home: "/h" });
  await expect(svc.launch({ tool: "claude", name: "c", repo: "/r" })).rejects.toThrow(/spawn boom/);
  expect(svc.pending()).toHaveLength(0);
});

test("stop delegates to the backend with the given title", async () => {
  const { backend, stopped } = fakeBackend();
  const svc = new LaunchService({ backend, home: "/h" });
  await svc.stop("alice-12345678");
  expect(stopped).toEqual(["alice-12345678"]);
});

test("no warning when nothing is pending after consume", async () => {
  const { backend } = fakeBackend();
  const svc = new LaunchService({
    backend,
    home: "/h",
    provisionPiRuntime: fakePiRuntime,
    mintLaunchId: () => "L1",
    mintPeerId: () => "P1xxxxxx",
  });
  const res = await svc.launch({ tool: "pi", name: "solo", repo: "/r" });
  expect(res.group).toBeUndefined();
  svc.consume("L1", "P1xxxxxx");
  expect(svc.pending()).toHaveLength(0);
});

test("durable launch persists intent and queues spawn without calling backend inline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-launch-service-durable-"));
  dirs.push(dir);
  const { db } = await openDatabase(join(dir, "synchronize.db"));
  const { backend, spawned } = promptBackend();
  const svc = new LaunchService({
    backend,
    db,
    home: dir,
    backendProfile: "synchronize-test",
    mintLaunchId: () => "launch-1",
    mintPeerId: () => "peer-1",
    now: () => Date.parse("2026-05-31T00:00:00.000Z"),
  });

  const res = await svc.launch({
    tool: "claude",
    name: "alice",
    repo: "/repo",
    group: "release",
    model: "claude-haiku-4-5-20251001",
    thinking: "high",
  });

  expect(res).toMatchObject({
    launchId: "launch-1",
    peerId: "peer-1",
    sessionName: "alice",
    group: "release",
    pendingCount: 1,
  });
  expect(spawned).toHaveLength(0);
  expect(getLaunchIntent(db, "launch-1")).toMatchObject({
    state: "accepted",
    backend_profile: "synchronize-test",
    target_group: "release",
    model: "claude-haiku-4-5-20251001",
  });
  expect(listLaunchWork(db, "launch-1").map((work) => work.kind)).toEqual(["spawn"]);
  expect(listLaunchEvents(db, "launch-1").map((event) => event.kind)).toEqual(["launch.accepted"]);
});

test("durable spawn and prompt work advance lifecycle and preserve backend title", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-launch-service-work-"));
  dirs.push(dir);
  const { db } = await openDatabase(join(dir, "synchronize.db"));
  const { backend, spawned, confirmed } = promptBackend();
  const svc = new LaunchService({
    backend,
    db,
    home: dir,
    provisionPiRuntime: fakePiRuntime,
    backendProfile: "synchronize-test",
    mintLaunchId: () => "launch-2",
    mintPeerId: () => "peer-2",
    now: () => Date.parse("2026-05-31T00:00:00.000Z"),
  });
  const res = await svc.launch({ tool: "claude", name: "alice", repo: "/repo", group: "release" });

  await svc.runWork("spawn", "launch-2");
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.title).toBe(res.title);
  expect(getLaunchIntent(db, "launch-2")).toMatchObject({
    state: "prompt_waiting",
    backend_title: res.title,
    spawned_at: "2026-05-31T00:00:00.000Z",
    prompt_seen_at: "2026-05-31T00:00:00.000Z",
  });
  expect(listLaunchWork(db, "launch-2").map((work) => work.kind)).toEqual(["spawn", "prompt_confirm"]);

  await svc.runWork("prompt_confirm", "launch-2");
  expect(confirmed).toEqual([res.title]);
  expect(getLaunchIntent(db, "launch-2")).toMatchObject({
    state: "prompt_accepted",
    prompt_accepted_at: "2026-05-31T00:00:00.000Z",
  });
  expect(listLaunchEvents(db, "launch-2").map((event) => event.kind)).toEqual([
    "launch.accepted",
    "spawn_started",
    "spawn_succeeded",
    "prompt_accepted",
  ]);
});

test("durable spawn failure leaves launch retryable for the work queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-launch-service-fail-"));
  dirs.push(dir);
  const { db } = await openDatabase(join(dir, "synchronize.db"));
  const { backend } = promptBackend({ failSpawn: true });
  const svc = new LaunchService({
    backend,
    db,
    home: dir,
    mintLaunchId: () => "launch-fail",
    mintPeerId: () => "peer-fail",
    now: () => Date.parse("2026-05-31T00:00:00.000Z"),
  });
  await svc.launch({ tool: "pi", name: "fail", repo: "/repo" });

  await expect(svc.runWork("spawn", "launch-fail")).rejects.toThrow(/spawn boom/);
  expect(getLaunchIntent(db, "launch-fail")).toMatchObject({
    state: "spawning",
    failure_code: null,
    failure_message: null,
  });
});

test("durable prompt exhaustion leaves launch retryable instead of false acceptance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-launch-service-prompt-fail-"));
  dirs.push(dir);
  const { db } = await openDatabase(join(dir, "synchronize.db"));
  const { backend } = promptBackend({ promptAccepted: false });
  const svc = new LaunchService({
    backend,
    db,
    home: dir,
    mintLaunchId: () => "launch-prompt-fail",
    mintPeerId: () => "peer-prompt-fail",
    now: () => Date.parse("2026-05-31T00:00:00.000Z"),
  });
  await svc.launch({ tool: "claude", name: "pfail", repo: "/repo" });
  await svc.runWork("spawn", "launch-prompt-fail");

  await expect(svc.runWork("prompt_confirm", "launch-prompt-fail")).rejects.toThrow(/prompt confirmation attempts exhausted/);
  expect(getLaunchIntent(db, "launch-prompt-fail")).toMatchObject({
    state: "prompt_waiting",
    failure_code: null,
    failure_message: null,
  });
});

test("durable spawn retry treats existing backend title as success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-launch-service-existing-"));
  dirs.push(dir);
  const { db } = await openDatabase(join(dir, "synchronize.db"));
  let expectedTitle = "";
  const { backend, spawned } = promptBackend({
    get existingTitles() {
      return expectedTitle ? [expectedTitle] : [];
    },
  } as { existingTitles: string[] });
  const svc = new LaunchService({
    backend,
    db,
    home: dir,
    mintLaunchId: () => "launch-existing",
    mintPeerId: () => "peer-existing",
    now: () => Date.parse("2026-05-31T00:00:00.000Z"),
  });
  const res = await svc.launch({ tool: "claude", name: "exist", repo: "/repo", group: "release" });
  expectedTitle = res.title;

  await svc.runWork("spawn", "launch-existing");

  expect(spawned).toHaveLength(0);
  expect(getLaunchIntent(db, "launch-existing")?.state).toBe("prompt_waiting");
  expect(listLaunchWork(db, "launch-existing").map((work) => work.kind)).toEqual(["spawn", "prompt_confirm"]);
});
