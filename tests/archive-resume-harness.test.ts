// AOE e2e harness for archive/resume — the real-agent proof that cannot be
// unit-tested (sync-cmw2.2). GATED OFF by default (SYNCHRONIZE_AOE_HARNESS=1) so
// the normal `bun test` stays fast and never spawns agents or burns API quota.
//
//   SYNCHRONIZE_AOE_HARNESS=1 bun test tests/archive-resume-harness.test.ts
//
// Scenario (Pi-first; Claude added once the dev-channel auto-confirm is hardened):
//   1. Stand up two real Pi agents via the daemon's launch lifecycle.
//   2. Exercise DM functionality between them (both directions).
//   3. Archive both (backend reaped, identity reserved).
//   4. Resume both (the archived identities resurrect via ENV_PEER_ID).
//   5. Exercise DM functionality again — proving the resumed identities can
//      still send and receive end to end.
//
// The DMs are driven through the daemon API on the agents' behalf (deterministic)
// — headless agents don't reliably *initiate* a turn, so we assert the messaging
// plumbing + the archive/resume effect on it, not the agents' cognition. Launch
// and resume both go through the real ctx.launchService lifecycle (not a test-only
// path). Tool-level session-id durability across resume is verified separately
// (manual probe: pi --session keeps the id and recalls context for ≥1-msg sessions).
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type ClientConfig } from "../src/client.ts";
import { launchAgent, listAgentSessions } from "../src/api/agent-sessions.ts";
import { archiveSession } from "../src/api/archive.ts";
import { resumeSession } from "../src/api/resume.ts";
import { readInbox, sendDm } from "../src/api/inbox.ts";

const HARNESS = process.env.SYNCHRONIZE_AOE_HARNESS === "1";
const harnessTest = HARNESS ? test : test.skip;

const homes: string[] = [];
const spawnedTitles = new Set<string>();

afterAll(async () => {
  for (const title of spawnedTitles) await killAoeByTitle(title);
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

// Best-effort: kill the tmux session(s) AOE created for a backend title.
async function killAoeByTitle(title: string): Promise<void> {
  const list = Bun.spawn({ cmd: ["tmux", "list-sessions", "-F", "#{session_name}"], stdout: "pipe", stderr: "ignore" });
  const names = (await new Response(list.stdout).text()).split("\n").map((s) => s.trim()).filter(Boolean);
  await list.exited;
  for (const name of names) {
    if (name.startsWith(`aoe_${title}_`)) {
      const kill = Bun.spawn({ cmd: ["tmux", "kill-session", "-t", name], stdout: "ignore", stderr: "ignore" });
      await kill.exited;
    }
  }
}

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

async function launch(client: ClientConfig, opts: { tool: "claude" | "pi"; name: string; repo: string }) {
  const result = await launchAgent(client, opts);
  spawnedTitles.add(result.title);
  return result;
}

// Wait until a launched agent has registered its host session (the Pi extension
// fires a few seconds after spawn).
async function waitForBinding(client: ClientConfig, peerId: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { bindings } = await listAgentSessions(client, { peerId });
    if (bindings.some((b) => b.host_session_id)) return;
    await Bun.sleep(1500);
  }
  throw new Error(`agent ${peerId} did not register a host session in time`);
}

// Poll a peer's inbox until a message body containing `marker` arrives.
async function waitForInbox(client: ClientConfig, peerId: string, marker: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { events } = await readInbox(client, peerId);
    if (events.some((e) => (e.body ?? "").includes(marker))) return;
    await Bun.sleep(1000);
  }
  throw new Error(`peer ${peerId} did not receive a DM containing "${marker}" in time`);
}

async function dmErrorCode(client: ClientConfig, senderPeerId: string, recipientPeerId: string, message: string): Promise<string> {
  try {
    await sendDm(client, { senderPeerId, recipientPeerId, message });
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return "ok";
}

// Send a DM, retrying through `must_reregister` until the resumed sender has
// re-registered (resurrected archived->active) and can send again.
async function dmWhenActive(client: ClientConfig, senderPeerId: string, recipientPeerId: string, message: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await sendDm(client, { senderPeerId, recipientPeerId, message });
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === "must_reregister") {
        await Bun.sleep(1500);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`sender ${senderPeerId} did not resurrect (still must_reregister) in time`);
}

harnessTest("two pi agents: DM works -> archive both -> resume both -> DM works again", async () => {
  const daemon = await startDaemon();
  const repoA = await mkdtemp(join(tmpdir(), "harness-alice-"));
  const repoB = await mkdtemp(join(tmpdir(), "harness-bob-"));
  homes.push(repoA, repoB);
  let alice: string | undefined;
  let bob: string | undefined;
  try {
    // 1. Two real Pi agents.
    alice = (await launch(daemon.client, { tool: "pi", name: "alice", repo: repoA })).peerId;
    bob = (await launch(daemon.client, { tool: "pi", name: "bob", repo: repoB })).peerId;
    await waitForBinding(daemon.client, alice);
    await waitForBinding(daemon.client, bob);

    // 2. DM functionality works (both directions).
    await sendDm(daemon.client, { senderPeerId: alice, recipientPeerId: bob, message: "hi bob (pre-archive)" });
    await waitForInbox(daemon.client, bob, "hi bob (pre-archive)");
    await sendDm(daemon.client, { senderPeerId: bob, recipientPeerId: alice, message: "hi alice (pre-archive)" });
    await waitForInbox(daemon.client, alice, "hi alice (pre-archive)");

    // 3. Archive both — backend reaped, identity reserved (not deleted).
    const arA = await archiveSession(daemon.client, { peerId: alice, reason: "harness" });
    const arB = await archiveSession(daemon.client, { peerId: bob, reason: "harness" });
    expect(arA.action).toBe("archived");
    expect(arB.action).toBe("archived");
    expect(arA.reaped).toBe(true);
    expect(arB.reaped).toBe(true);
    // While archived, the identity cannot send.
    expect(await dmErrorCode(daemon.client, alice, bob, "should be blocked")).toBe("must_reregister");

    // 4. Resume both — the archived identities resurrect on re-registration.
    expect((await resumeSession(daemon.client, { peerId: alice })).mode).toBe("launch");
    expect((await resumeSession(daemon.client, { peerId: bob })).mode).toBe("launch");

    // 5. DM functionality works again (proves both resurrected and can send/receive).
    await dmWhenActive(daemon.client, alice, bob, "hi bob (post-resume)");
    await waitForInbox(daemon.client, bob, "hi bob (post-resume)");
    await dmWhenActive(daemon.client, bob, alice, "hi alice (post-resume)");
    await waitForInbox(daemon.client, alice, "hi alice (post-resume)");
  } finally {
    // Reap the live (resumed) agents via the real archive path so nothing is
    // orphaned (resume mints new backend titles that title-tracking can miss).
    if (alice) await archiveSession(daemon.client, { peerId: alice }).catch(() => {});
    if (bob) await archiveSession(daemon.client, { peerId: bob }).catch(() => {});
    await daemon.stop();
  }
}, 300_000);
