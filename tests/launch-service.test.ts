import { expect, test } from "bun:test";
import {
  LaunchService,
  LaunchValidationError,
  aoeProfileName,
  aoeTitle,
  resolveLaunchSpec,
  validateLaunchRequest,
} from "../src/launch/service.ts";
import type { LaunchSpec, SessionBackend } from "../src/launch/backend.ts";
import { ENV_HOME, ENV_PEER_ID, ENV_SESSION_NAME } from "../src/constants.ts";

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

test("validateLaunchRequest accepts a minimal valid body", () => {
  const req = validateLaunchRequest({ tool: "claude", name: "alice", repo: "/r" });
  expect(req).toEqual({ tool: "claude", name: "alice", repo: "/r" });
});

test("validateLaunchRequest keeps group + args and trims", () => {
  const req = validateLaunchRequest({ tool: "pi", name: " bob ", repo: " /x ", group: " alpha ", args: ["--model", "m"] });
  expect(req).toEqual({ tool: "pi", name: "bob", repo: "/x", group: "alpha", args: ["--model", "m"] });
});

test("validateLaunchRequest rejects bad tool/name/repo/args", () => {
  expect(() => validateLaunchRequest({ tool: "codex", name: "a", repo: "/r" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "", repo: "/r" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "a" })).toThrow(LaunchValidationError);
  expect(() => validateLaunchRequest({ tool: "claude", name: "a", repo: "/r", args: [1] })).toThrow(LaunchValidationError);
});

test("aoeProfileName is deterministic per home and varies across homes", () => {
  expect(aoeProfileName("/a")).toBe(aoeProfileName("/a"));
  expect(aoeProfileName("/a")).not.toBe(aoeProfileName("/b"));
  expect(aoeProfileName("/a").startsWith("synchronize-")).toBe(true);
});

test("aoeTitle = name-peerid8", () => {
  expect(aoeTitle("alice", "35742454d0934b6a")).toBe("alice-35742454");
});

test("resolveLaunchSpec wires title, command, env, cwd, group", () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/repo", group: "alpha", args: ["--model", "opus"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.title).toBe("alice-peer-abc");
  expect(spec.tool).toBe("claude");
  expect(spec.command[0]).toBe("claude");
  expect(spec.command).toContain("opus");
  expect(spec.cwd).toBe("/repo");
  expect(spec.group).toBe("alpha");
  expect(spec.env[ENV_PEER_ID]).toBe("peer-abcdef12");
  expect(spec.env[ENV_SESSION_NAME]).toBe("alice");
  expect(spec.env[ENV_HOME]).toBe("/home");
});

test("resolveLaunchSpec defaults claude to --model haiku when no model given", async () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/r" },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  const i = spec.command.indexOf("--model");
  expect(i).toBeGreaterThan(-1);
  expect(spec.command[i + 1]).toBe("haiku");
});

test("resolveLaunchSpec keeps a caller-provided claude --model (override wins)", async () => {
  const spec = resolveLaunchSpec(
    { tool: "claude", name: "alice", repo: "/r", args: ["--model", "opus"] },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command.filter((a) => a === "--model")).toHaveLength(1);
  expect(spec.command[spec.command.indexOf("--model") + 1]).toBe("opus");
});

test("resolveLaunchSpec does not inject a model for pi", async () => {
  const spec = resolveLaunchSpec(
    { tool: "pi", name: "bob", repo: "/r" },
    { launchId: "lid", peerId: "peer-abcdef12", home: "/home" },
  );
  expect(spec.command).not.toContain("--model");
});

test("launch records pending, spawns, and returns identity + count", async () => {
  const { backend, spawned } = fakeBackend();
  let n = 0;
  const svc = new LaunchService({
    backend,
    home: "/home",
    mintLaunchId: () => `lid-${++n}`,
    mintPeerId: () => `peer-${n}aaaaaaa`,
  });
  const res = await svc.launch({ tool: "pi", name: "bob", repo: "/r", group: "g" });
  expect(res.launchId).toBe("lid-1");
  expect(res.peerId).toBe("peer-1aaaaaaa");
  expect(res.sessionName).toBe("bob");
  expect(res.title).toBe("bob-peer-1aa");
  expect(res.group).toBe("g");
  expect(res.pendingCount).toBe(1);
  expect(res.warning).toContain("not yet registered");
  expect(spawned).toHaveLength(1);
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
  const svc = new LaunchService({ backend, home: "/h", mintLaunchId: () => "L1", mintPeerId: () => "P1xxxxxx" });
  const res = await svc.launch({ tool: "pi", name: "solo", repo: "/r" });
  expect(res.group).toBeUndefined();
  svc.consume("L1", "P1xxxxxx");
  expect(svc.pending()).toHaveLength(0);
});
