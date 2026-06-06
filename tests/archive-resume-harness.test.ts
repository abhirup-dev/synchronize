// AOE e2e harness for archive/resume — the real-agent proof that cannot be
// unit-tested (epic sync-ocdt, Pi-first). GATED OFF by default
// (SYNCHRONIZE_AOE_HARNESS=1) so the normal `bun test` stays fast and never
// spawns agents or burns API quota.
//
//   SYNCHRONIZE_AOE_HARNESS=1 bun test tests/archive-resume-harness.test.ts
//
// Why a live harness, and why Pi-first:
//   The unit suite proves each lifecycle piece deterministically in isolation,
//   but only a real-agent harness proves they hold together — pi launch → reap →
//   resume-spawn → re-register → archived⇄active resurrection → group rejoin —
//   across many agents and cycles with real push delivery. Pi has no interactive
//   dev-channel confirm prompt, so it is deterministic under tmux/AOE; Claude
//   parity is deferred (sync-ocdt.4).
//
// These are SEVEN focused scenarios rather than one monolith so a failure points
// at exactly one facet. All comms are driven through the daemon API on the
// agents' behalf (deterministic) — headless agents don't reliably *initiate* a
// turn, so we assert the messaging plumbing + the archive/resume effect on it,
// not the agents' cognition. Launch and resume both go through the real
// ctx.launchService lifecycle (not a test-only path). Tool-level session-id
// durability across resume is verified separately (manual probe: pi --session
// keeps the id and recalls context for ≥1-msg sessions).
//
//   1. DM survives archive → resume (2 agents)
//   2. group fanout EXCLUDES an archived member, restored on resume (3 agents)
//   3. group archive → per-member all archived + reaped + aliases reserved
//   4. group resume → per-member launching + group comms restored
//   5. archived alias is RESERVED — 4th agent blocked + @mention warns
//   6. idempotency & guards — already_archived / peer_not_archived / dry-run
//   7. two full archive/resume cycles — identity + alias stable, no orphans
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type ClientConfig } from "../src/client.ts";
import { launchAgent, listAgentSessions } from "../src/api/agent-sessions.ts";
import { archiveSession, archiveGroup, listArchived } from "../src/api/archive.ts";
import { resumeSession, resumeGroup } from "../src/api/resume.ts";
import { readInbox, sendDm } from "../src/api/inbox.ts";
import { createGroup, joinGroup, listMyGroups, sendGroupMessage } from "../src/api/groups.ts";

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

interface Daemon {
  client: ClientConfig;
  stop: () => Promise<void>;
}

async function startDaemon(): Promise<Daemon> {
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

async function freshRepo(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  homes.push(dir);
  return dir;
}

// Launch one real Pi agent through the daemon's launch lifecycle and wait until
// it has registered its host session (so it has a resumable transcript).
async function launchPi(client: ClientConfig, name: string): Promise<{ peerId: string; title: string; name: string }> {
  const repo = await freshRepo(name);
  const result = await launchAgent(client, { tool: "pi", name, repo });
  spawnedTitles.add(result.title);
  await waitForBinding(client, result.peerId);
  return { peerId: result.peerId, title: result.title, name };
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

// Poll until a resumed peer has resurrected (archived → active) — i.e. it is no
// longer listed among the archived sessions, which happens once its respawned
// process re-registers via the pinned ENV_PEER_ID.
async function waitForResumed(client: ClientConfig, peerId: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { sessions } = await listArchived(client);
    if (!sessions.some((s) => s.peer_id === peerId)) return;
    await Bun.sleep(1500);
  }
  throw new Error(`peer ${peerId} did not resurrect (still archived) in time`);
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

// Send a group message, retrying through `must_reregister` until the resumed
// sender can post again. Returns the delivery summary (peer-id fanout sets).
async function groupSendWhenActive(
  client: ClientConfig,
  name: string,
  senderPeerId: string,
  message: string,
  timeoutMs = 120_000,
): Promise<{ pushed_to: string[]; inbox_only: string[] }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { delivery } = await sendGroupMessage(client, { name, senderPeerId, message });
      return delivery;
    } catch (error) {
      if (error instanceof ApiError && error.code === "must_reregister") {
        await Bun.sleep(1500);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`group sender ${senderPeerId} did not resurrect in time`);
}

// The full set of active members reached by a group send (sender excluded).
function reached(delivery: { pushed_to: string[]; inbox_only: string[] }): Set<string> {
  return new Set([...delivery.pushed_to, ...delivery.inbox_only]);
}

// Reap any live agents via the real archive path so nothing is orphaned (resume
// mints new backend titles that title-tracking can miss).
async function reap(client: ClientConfig, peerIds: string[]): Promise<void> {
  for (const peerId of peerIds) await archiveSession(client, { peerId }).catch(() => {});
}

// ── 1. DM survives archive → resume ──────────────────────────────────────────
harnessTest("DM works -> archive both -> resume both -> DM works again (2 agents)", async () => {
  const daemon = await startDaemon();
  let alice: string | undefined;
  let bob: string | undefined;
  try {
    alice = (await launchPi(daemon.client, "alice")).peerId;
    bob = (await launchPi(daemon.client, "bob")).peerId;

    await sendDm(daemon.client, { senderPeerId: alice, recipientPeerId: bob, message: "hi bob (pre-archive)" });
    await waitForInbox(daemon.client, bob, "hi bob (pre-archive)");
    await sendDm(daemon.client, { senderPeerId: bob, recipientPeerId: alice, message: "hi alice (pre-archive)" });
    await waitForInbox(daemon.client, alice, "hi alice (pre-archive)");

    const arA = await archiveSession(daemon.client, { peerId: alice, reason: "harness" });
    const arB = await archiveSession(daemon.client, { peerId: bob, reason: "harness" });
    expect(arA.action).toBe("archived");
    expect(arB.action).toBe("archived");
    expect(arA.reaped).toBe(true);
    expect(arB.reaped).toBe(true);
    // While archived, the identity cannot send.
    expect(await dmErrorCode(daemon.client, alice, bob, "should be blocked")).toBe("must_reregister");

    expect((await resumeSession(daemon.client, { peerId: alice })).mode).toBe("launch");
    expect((await resumeSession(daemon.client, { peerId: bob })).mode).toBe("launch");

    await dmWhenActive(daemon.client, alice, bob, "hi bob (post-resume)");
    await waitForInbox(daemon.client, bob, "hi bob (post-resume)");
    await dmWhenActive(daemon.client, bob, alice, "hi alice (post-resume)");
    await waitForInbox(daemon.client, alice, "hi alice (post-resume)");
  } finally {
    await reap(daemon.client, [alice, bob].filter(Boolean) as string[]);
    await daemon.stop();
  }
}, 300_000);

// ── 2. group fanout excludes an archived member, restored on resume ───────────
harnessTest("group fanout EXCLUDES an archived member and includes it again after resume (3 agents)", async () => {
  const daemon = await startDaemon();
  const peers: string[] = [];
  try {
    const alice = (await launchPi(daemon.client, "alice")).peerId;
    const bob = (await launchPi(daemon.client, "bob")).peerId;
    const carol = (await launchPi(daemon.client, "carol")).peerId;
    peers.push(alice, bob, carol);

    const group = "fanout-team";
    await createGroup(daemon.client, { name: group, creatorPeerId: alice });
    await joinGroup(daemon.client, { name: group, peerId: alice, alias: "alice" });
    await joinGroup(daemon.client, { name: group, peerId: bob, alias: "bob" });
    await joinGroup(daemon.client, { name: group, peerId: carol, alias: "carol" });

    // Baseline: a send from alice reaches BOTH bob and carol.
    const before = reached(await groupSendWhenActive(daemon.client, group, alice, "roll call (baseline)"));
    expect(before.has(bob)).toBe(true);
    expect(before.has(carol)).toBe(true);

    // Archive carol — her seat is reserved but she is no longer an active member.
    expect((await archiveSession(daemon.client, { peerId: carol, reason: "harness" })).action).toBe("archived");

    // Now a send from alice reaches bob but NOT the archived carol.
    const during = reached(await groupSendWhenActive(daemon.client, group, alice, "roll call (carol archived)"));
    expect(during.has(bob)).toBe(true);
    expect(during.has(carol)).toBe(false);

    // Resume carol; once she resurrects she is back in the fanout.
    expect((await resumeSession(daemon.client, { peerId: carol })).mode).toBe("launch");
    await waitForResumed(daemon.client, carol);
    const after = reached(await groupSendWhenActive(daemon.client, group, alice, "roll call (carol resumed)"));
    expect(after.has(bob)).toBe(true);
    expect(after.has(carol)).toBe(true);
  } finally {
    await reap(daemon.client, peers);
    await daemon.stop();
  }
}, 300_000);

// ── 3. group archive: every member archived + reaped + alias reserved ─────────
harnessTest("archive group -> every member archived + reaped + alias reserved (3 agents)", async () => {
  const daemon = await startDaemon();
  const peers: string[] = [];
  try {
    const alice = (await launchPi(daemon.client, "alice")).peerId;
    const bob = (await launchPi(daemon.client, "bob")).peerId;
    const carol = (await launchPi(daemon.client, "carol")).peerId;
    peers.push(alice, bob, carol);

    const group = "archive-team";
    await createGroup(daemon.client, { name: group, creatorPeerId: alice });
    for (const [peerId, alias] of [[alice, "alice"], [bob, "bob"], [carol, "carol"]] as const) {
      await joinGroup(daemon.client, { name: group, peerId, alias });
    }

    const result = await archiveGroup(daemon.client, { group, reason: "harness" });
    expect(result.group).toBe(group);
    expect(result.members.length).toBe(3);
    for (const m of result.members) {
      expect(m.action).toBe("archived");
      expect(m.reaped).toBe(true);
    }

    // Every member now appears among archived sessions with the group seat reserved.
    const { sessions } = await listArchived(daemon.client);
    for (const peerId of peers) {
      const summary = sessions.find((s) => s.peer_id === peerId);
      expect(summary).toBeDefined();
      expect(summary!.aliases.some((a) => a.group === group)).toBe(true);
    }
  } finally {
    await reap(daemon.client, peers);
    await daemon.stop();
  }
}, 300_000);

// ── 4. group resume: every member launching + comms restored ──────────────────
harnessTest("resume group -> every member launching + group comms restored (3 agents)", async () => {
  const daemon = await startDaemon();
  const peers: string[] = [];
  try {
    const alice = (await launchPi(daemon.client, "alice")).peerId;
    const bob = (await launchPi(daemon.client, "bob")).peerId;
    const carol = (await launchPi(daemon.client, "carol")).peerId;
    peers.push(alice, bob, carol);

    const group = "resume-team";
    await createGroup(daemon.client, { name: group, creatorPeerId: alice });
    for (const [peerId, alias] of [[alice, "alice"], [bob, "bob"], [carol, "carol"]] as const) {
      await joinGroup(daemon.client, { name: group, peerId, alias });
    }

    await archiveGroup(daemon.client, { group, reason: "harness" });
    const result = await resumeGroup(daemon.client, { group });
    expect(result.members.length).toBe(3);
    for (const m of result.members) expect(m.action).toBe("launching");

    // Wait for all three to resurrect, then a group send reaches the other two.
    for (const peerId of peers) await waitForResumed(daemon.client, peerId);
    const got = reached(await groupSendWhenActive(daemon.client, group, alice, "back online"));
    expect(got.has(bob)).toBe(true);
    expect(got.has(carol)).toBe(true);
  } finally {
    await reap(daemon.client, peers);
    await daemon.stop();
  }
}, 300_000);

// ── 5. archived alias is reserved: 4th agent blocked + @mention warns ─────────
harnessTest("archived alias is RESERVED — joining peer blocked + @mention warns alias_archived (4 agents)", async () => {
  const daemon = await startDaemon();
  const peers: string[] = [];
  try {
    const alice = (await launchPi(daemon.client, "alice")).peerId;
    const bob = (await launchPi(daemon.client, "bob")).peerId;
    const carol = (await launchPi(daemon.client, "carol")).peerId;
    peers.push(alice, bob, carol);

    const group = "reserved-team";
    await createGroup(daemon.client, { name: group, creatorPeerId: alice });
    for (const [peerId, alias] of [[alice, "alice"], [bob, "bob"], [carol, "carol"]] as const) {
      await joinGroup(daemon.client, { name: group, peerId, alias });
    }

    // Archive carol — her alias seat is reserved (member_state='archived').
    expect((await archiveSession(daemon.client, { peerId: carol, reason: "harness" })).action).toBe("archived");

    // A fresh 4th agent cannot claim carol's reserved alias.
    const dave = (await launchPi(daemon.client, "dave")).peerId;
    peers.push(dave);
    let joinCode = "ok";
    try {
      await joinGroup(daemon.client, { name: group, peerId: dave, alias: "carol" });
    } catch (error) {
      if (error instanceof ApiError) joinCode = error.code;
      else throw error;
    }
    expect(joinCode).toBe("alias_reserved_by_archived");

    // dave can still join under his own alias.
    await joinGroup(daemon.client, { name: group, peerId: dave, alias: "dave" });

    // Mentioning the archived alias surfaces an alias_archived warning.
    const { warnings } = await sendGroupMessage(daemon.client, { name: group, senderPeerId: alice, message: "ping @carol are you there?" });
    expect(warnings.some((w) => w.reason === "alias_archived")).toBe(true);
  } finally {
    await reap(daemon.client, peers);
    await daemon.stop();
  }
}, 300_000);

// ── 6. idempotency & guards ───────────────────────────────────────────────────
harnessTest("idempotency & guards — already_archived / peer_not_archived / dry-run (1 agent)", async () => {
  const daemon = await startDaemon();
  let alice: string | undefined;
  try {
    alice = (await launchPi(daemon.client, "alice")).peerId;

    // First archive succeeds and reaps; re-archiving is an idempotent no-op.
    expect((await archiveSession(daemon.client, { peerId: alice })).action).toBe("archived");
    const again = await archiveSession(daemon.client, { peerId: alice });
    expect(again.action).toBe("already_archived");
    expect(again.reaped).toBe(false);

    // Resume brings it back; resuming an ACTIVE peer is rejected.
    expect((await resumeSession(daemon.client, { peerId: alice })).mode).toBe("launch");
    await waitForResumed(daemon.client, alice);
    let resumeCode = "ok";
    try {
      await resumeSession(daemon.client, { peerId: alice });
    } catch (error) {
      if (error instanceof ApiError) resumeCode = error.code;
      else throw error;
    }
    expect(resumeCode).toBe("peer_not_archived");

    // dry-run archive previews without reaping the live agent.
    const dry = await archiveSession(daemon.client, { peerId: alice, dryRun: true });
    expect(dry.action).toBe("would_archive");
    expect(dry.reaped).toBe(false);
  } finally {
    await reap(daemon.client, [alice].filter(Boolean) as string[]);
    await daemon.stop();
  }
}, 300_000);

// ── 7. two full archive/resume cycles — identity + alias stable, no orphans ───
harnessTest("two full archive/resume cycles keep identity + alias stable (2 agents)", async () => {
  const daemon = await startDaemon();
  const peers: string[] = [];
  try {
    const alice = (await launchPi(daemon.client, "alice")).peerId;
    const bob = (await launchPi(daemon.client, "bob")).peerId;
    peers.push(alice, bob);

    const group = "cycle-team";
    await createGroup(daemon.client, { name: group, creatorPeerId: alice });
    await joinGroup(daemon.client, { name: group, peerId: alice, alias: "alice" });
    await joinGroup(daemon.client, { name: group, peerId: bob, alias: "bob" });

    for (let cycle = 1; cycle <= 2; cycle++) {
      await archiveGroup(daemon.client, { group, reason: `harness-cycle-${cycle}` });
      const resumed = await resumeGroup(daemon.client, { group });
      for (const m of resumed.members) expect(m.action).toBe("launching");
      for (const peerId of peers) await waitForResumed(daemon.client, peerId);

      // Same peer ids and aliases persist across the cycle (resume reuses the
      // pinned identity; it never mints a new peer).
      const mine = await listMyGroups(daemon.client, alice);
      const teamAlias = mine.groups.find((g) => g.name === group)?.alias;
      expect(teamAlias).toBe("alice");

      const got = reached(await groupSendWhenActive(daemon.client, group, alice, `cycle ${cycle} message`));
      expect(got.has(bob)).toBe(true);
    }
  } finally {
    await reap(daemon.client, peers);
    await daemon.stop();
  }
}, 360_000);
