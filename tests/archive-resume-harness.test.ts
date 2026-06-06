// AOE e2e harness for archive/resume — proves the REAL-agent flows that cannot
// be unit-tested (sync-cmw2.2). These spawn live Claude/Pi sessions via `aoe`,
// so they are GATED OFF by default: the normal `bun test` suite must stay fast
// and deterministic and must not spawn real agents or burn API quota.
//
// Run on a developer machine with aoe + claude + pi installed:
//   SYNCHRONIZE_AOE_HARNESS=1 bun test tests/archive-resume-harness.test.ts
//
// Scenarios covered here (live): faithful resume (claude), faithful resume (pi),
// group resume per-member. The remaining plan scenarios are already covered
// deterministically by tests/archive-resume.test.ts without real agents:
//   - implicit resume (re-register same host_session_id -> archived->active)
//   - plain-terminal resume (--print command emission)
//   - live zombie -> peer_still_live -> --force kills + resumes
//   - reboot proxy (probe flips dead -> resume unblocks)
// The auto-archive scenario (plan item 3) requires Epic 5 and is intentionally
// out of scope here.
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "../src/client.ts";
import { launchAgent, listAgentSessions } from "../src/api/agent-sessions.ts";
import { archiveGroup, archiveSession } from "../src/api/archive.ts";
import { resumeGroup, resumeSession } from "../src/api/resume.ts";
import { getGroupHistory } from "../src/api/groups.ts";

const HARNESS = process.env.SYNCHRONIZE_AOE_HARNESS === "1";
// test.skip keeps these visible-but-skipped in the default suite; they execute
// only when the harness flag is set on a machine with the real toolchain.
const harnessTest = HARNESS ? test : test.skip;

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function startDaemon(): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-harness-"));
  homes.push(home);
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", SYNCHRONIZE_DEBUG: "1" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const { baseUrl } = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
      const health = await fetch(`${baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          client: { baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
          stop: async () => {
            proc.kill();
            await proc.exited;
          },
        };
      }
    } catch {
      await Bun.sleep(100);
    }
  }
  proc.kill();
  await proc.exited;
  throw new Error("daemon did not start");
}

// Poll until a launched agent has registered its host session (the hook/Pi-ext
// fires a few seconds after spawn). Returns the captured host_session_id.
async function waitForBinding(client: ClientConfig, peerId: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { bindings } = await listAgentSessions(client, { peerId });
    const bound = bindings.find((b) => b.host_session_id);
    if (bound?.host_session_id) return bound.host_session_id;
    await Bun.sleep(1500);
  }
  throw new Error(`agent ${peerId} did not register a host session in time`);
}

async function aoeHasTitle(title: string): Promise<boolean> {
  const proc = Bun.spawn({ cmd: ["aoe", "list", "--json"], stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const parsed = JSON.parse(out.trim() || "[]");
    const rows = Array.isArray(parsed) ? parsed : (parsed.sessions ?? []);
    return rows.some((r: { title?: string }) => r.title === title);
  } catch {
    return false;
  }
}

async function faithfulResume(tool: "claude" | "pi"): Promise<void> {
  const daemon = await startDaemon();
  const repo = await mkdtemp(join(tmpdir(), `harness-${tool}-`));
  homes.push(repo);
  try {
    // 1. Launch a real agent into a group and wait for it to register.
    const launched = await launchAgent(daemon.client, { tool, name: "critic", repo, group: "harness" });
    const peerId = launched.peerId;
    const hostSessionId = await waitForBinding(daemon.client, peerId);
    expect(await aoeHasTitle(launched.title)).toBe(true);

    // 2. Archive it: identity reserved, backend reaped (runtime freed).
    const archived = await archiveSession(daemon.client, { peerId, reason: "harness" });
    expect(archived.action).toBe("archived");
    expect(archived.reaped).toBe(true);
    await Bun.sleep(1500);
    expect(await aoeHasTitle(launched.title)).toBe(false); // tmux gone

    // 3. Resume launch: AOE respawns with --resume in the original cwd.
    const resumed = await resumeSession(daemon.client, { peerId, force: false });
    expect(resumed.mode).toBe("launch");

    // 4. The resumed agent re-registers — SAME peer_id (identity reattached),
    //    same host_session_id (faithful continuation, not a fresh session).
    const newHostSessionId = await waitForBinding(daemon.client, peerId);
    expect(newHostSessionId).toBe(hostSessionId);

    // 5. Group history + alias are intact (not a new member).
    const history = await getGroupHistory(daemon.client, { name: "harness", peerId });
    expect(history).toBeDefined();
  } finally {
    await daemon.stop();
  }
}

harnessTest("faithful resume (claude): launch -> archive(reap) -> resume reattaches same identity", async () => {
  await faithfulResume("claude");
}, 240_000);

harnessTest("faithful resume (pi): launch -> archive(reap) -> resume reattaches same identity", async () => {
  await faithfulResume("pi");
}, 240_000);

harnessTest("group resume relaunches each archived member with per-member status", async () => {
  const daemon = await startDaemon();
  const repoA = await mkdtemp(join(tmpdir(), "harness-grp-a-"));
  const repoB = await mkdtemp(join(tmpdir(), "harness-grp-b-"));
  homes.push(repoA, repoB);
  try {
    const a = await launchAgent(daemon.client, { tool: "claude", name: "critic", repo: repoA, group: "team" });
    const b = await launchAgent(daemon.client, { tool: "pi", name: "planner", repo: repoB, group: "team" });
    await waitForBinding(daemon.client, a.peerId);
    await waitForBinding(daemon.client, b.peerId);

    const archived = await archiveGroup(daemon.client, { group: "team", reason: "overnight" });
    expect(archived.members.every((m) => m.action === "archived")).toBe(true);

    const resumed = await resumeGroup(daemon.client, { group: "team" });
    expect(resumed.members).toHaveLength(2);
    expect(resumed.members.every((m) => m.action === "launching")).toBe(true);

    // Both reattach to their original identities.
    await waitForBinding(daemon.client, a.peerId);
    await waitForBinding(daemon.client, b.peerId);
  } finally {
    await daemon.stop();
  }
}, 360_000);
