import { expect, test } from "bun:test";
import type { BackendSession, SessionBackend } from "../src/launch/backend.ts";
import { LocalLivenessProbe, defaultPidChecker } from "../src/lifecycle/probe.ts";

function fakeBackend(titles: string[]): SessionBackend {
  return {
    ensureReady: async () => {},
    spawn: async () => {},
    stop: async () => {},
    list: async (): Promise<BackendSession[]> => titles.map((title) => ({ title })),
  };
}

test("AOE-managed target is alive when the backend still lists its title", async () => {
  const probe = new LocalLivenessProbe({ backend: fakeBackend(["aoe_critic_1", "aoe_planner_2"]) });
  expect(await probe.probe({ backendTitle: "aoe_critic_1" })).toBe("alive");
});

test("AOE-managed target is dead when the backend no longer lists its title", async () => {
  const probe = new LocalLivenessProbe({ backend: fakeBackend(["aoe_planner_2"]) });
  expect(await probe.probe({ backendTitle: "aoe_critic_1" })).toBe("dead");
});

test("backend failure is treated as dead (never block resume on a flaky backend)", async () => {
  const flaky: SessionBackend = {
    ensureReady: async () => {},
    spawn: async () => {},
    stop: async () => {},
    list: async () => {
      throw new Error("aoe unreachable");
    },
  };
  const probe = new LocalLivenessProbe({ backend: flaky });
  expect(await probe.probe({ backendTitle: "aoe_critic_1" })).toBe("dead");
});

test("non-AOE target uses the injectable pid checker", async () => {
  const liveProbe = new LocalLivenessProbe({ checkPid: (pid) => pid === 4321 });
  expect(await liveProbe.probe({ pid: 4321 })).toBe("alive");
  expect(await liveProbe.probe({ pid: 9999 })).toBe("dead");
});

test("missing both backendTitle and pid resolves to dead", async () => {
  const probe = new LocalLivenessProbe({ backend: fakeBackend(["x"]) });
  expect(await probe.probe({})).toBe("dead");
});

test("a target with no backend falls back to the pid arm", async () => {
  const probe = new LocalLivenessProbe({ checkPid: () => true });
  // backendTitle present but no backend wired → must fall through to pid.
  expect(await probe.probe({ backendTitle: "aoe_x", pid: 123 })).toBe("alive");
});

test("defaultPidChecker reports this process alive and an impossible pid dead", () => {
  expect(defaultPidChecker(process.pid)).toBe(true);
  expect(defaultPidChecker(0)).toBe(false);
  expect(defaultPidChecker(-1)).toBe(false);
});

test("defaultPidChecker reports a never-spawned high pid as dead", () => {
  // 2^31-ish pid that cannot exist on this host.
  expect(defaultPidChecker(2147480000)).toBe(false);
});
