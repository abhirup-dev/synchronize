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
// Reusable plumbing (daemon spawn, agent launch, lifecycle waits, fanout/DM
// helpers) lives in tests/support/aoe-harness.ts so sync-ocdt.2/.3/.4 share it.
//
//   1. DM survives archive → resume (2 agents)
//   2. group fanout EXCLUDES an archived member, restored on resume (3 agents)
//   3. group archive → per-member all archived + reaped + aliases reserved
//   4. group resume → per-member launching + group comms restored
//   5. archived alias is RESERVED — 4th agent blocked + @mention warns
//   6. idempotency & guards — already_archived / peer_not_archived / dry-run
//   7. two full archive/resume cycles — identity + alias stable, no orphans
import { afterAll, expect, test } from "bun:test";
import { ApiError } from "../src/client.ts";
import { archiveGroup, archiveSession, listArchived } from "../src/api/archive.ts";
import { resumeGroup, resumeSession } from "../src/api/resume.ts";
import { sendDm } from "../src/api/inbox.ts";
import { createGroup, joinGroup, listMyGroups, sendGroupMessage } from "../src/api/groups.ts";
import { cleanupDaemonHomes } from "./support/daemon.ts";
import {
  createHarness,
  dmErrorCode,
  dmWhenActive,
  groupSendWhenActive,
  harnessTest,
  reached,
  reap,
  waitForInbox,
  waitForResumed,
} from "./support/aoe-harness.ts";

// These resume scenarios launch real agents but drive them only through REST.
// A zero-turn Pi process writes only the synchronize extension stub, not a real
// resumable transcript, so faithful transcript-resurrection is intentionally
// proven by scripts/integration_archive_resume_pi.py instead.
const transcriptResumeHarnessTest = test.skip;

const h = createHarness();
afterAll(async () => {
  await h.cleanup();
  await cleanupDaemonHomes();
});

// ── 1. DM survives archive → resume ──────────────────────────────────────────
transcriptResumeHarnessTest("DM works -> archive both -> resume both -> DM works again (2 agents)", async () => {
  const daemon = await h.startHarnessDaemon();
  let alice: string | undefined;
  let bob: string | undefined;
  try {
    alice = (await h.launchPi(daemon.client, "alice")).peerId;
    bob = (await h.launchPi(daemon.client, "bob")).peerId;

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
transcriptResumeHarnessTest("group fanout EXCLUDES an archived member and includes it again after resume (3 agents)", async () => {
  const daemon = await h.startHarnessDaemon();
  const peers: string[] = [];
  try {
    const alice = (await h.launchPi(daemon.client, "alice")).peerId;
    const bob = (await h.launchPi(daemon.client, "bob")).peerId;
    const carol = (await h.launchPi(daemon.client, "carol")).peerId;
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
  const daemon = await h.startHarnessDaemon();
  const peers: string[] = [];
  try {
    const alice = (await h.launchPi(daemon.client, "alice")).peerId;
    const bob = (await h.launchPi(daemon.client, "bob")).peerId;
    const carol = (await h.launchPi(daemon.client, "carol")).peerId;
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
transcriptResumeHarnessTest("resume group -> every member launching + group comms restored (3 agents)", async () => {
  const daemon = await h.startHarnessDaemon();
  const peers: string[] = [];
  try {
    const alice = (await h.launchPi(daemon.client, "alice")).peerId;
    const bob = (await h.launchPi(daemon.client, "bob")).peerId;
    const carol = (await h.launchPi(daemon.client, "carol")).peerId;
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
  const daemon = await h.startHarnessDaemon();
  const peers: string[] = [];
  try {
    const alice = (await h.launchPi(daemon.client, "alice")).peerId;
    const bob = (await h.launchPi(daemon.client, "bob")).peerId;
    const carol = (await h.launchPi(daemon.client, "carol")).peerId;
    peers.push(alice, bob, carol);

    const group = "reserved-team";
    await createGroup(daemon.client, { name: group, creatorPeerId: alice });
    for (const [peerId, alias] of [[alice, "alice"], [bob, "bob"], [carol, "carol"]] as const) {
      await joinGroup(daemon.client, { name: group, peerId, alias });
    }

    // Archive carol — her alias seat is reserved (member_state='archived').
    expect((await archiveSession(daemon.client, { peerId: carol, reason: "harness" })).action).toBe("archived");

    // A fresh 4th agent cannot claim carol's reserved alias.
    const dave = (await h.launchPi(daemon.client, "dave")).peerId;
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
transcriptResumeHarnessTest("idempotency & guards — already_archived / peer_not_archived / dry-run (1 agent)", async () => {
  const daemon = await h.startHarnessDaemon();
  let alice: string | undefined;
  try {
    alice = (await h.launchPi(daemon.client, "alice")).peerId;

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
transcriptResumeHarnessTest("two full archive/resume cycles keep identity + alias stable (2 agents)", async () => {
  const daemon = await h.startHarnessDaemon();
  const peers: string[] = [];
  try {
    const alice = (await h.launchPi(daemon.client, "alice")).peerId;
    const bob = (await h.launchPi(daemon.client, "bob")).peerId;
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
