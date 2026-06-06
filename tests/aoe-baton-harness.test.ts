// AOE e2e harness: three-agent THREAD-BATON relay (Pi-first, gated).
//
//   SYNCHRONIZE_AOE_HARNESS=1 bun test tests/aoe-baton-harness.test.ts
//
// This is the TypeScript counterpart to the Python AOE baton smoke
// (scripts/integration-aoe/.../pi_mcp_thread_baton.py). The Python test drives
// real Pi *cognition* (it prompts each agent to call MCP tools and reply with
// BATON markers); this one launches the same three real Pi agents through the
// real ctx.launchService lifecycle but drives the baton over the daemon API
// (deterministic) — so it asserts the messaging/threading/mention-routing
// plumbing and the archive/resume effect on it, not the agents' reasoning.
//
// Its real purpose: prove the EXTRACTED shared helpers in tests/support/* work
// end to end from a *second* harness file — launchPi, group join, threaded
// sends with mention-driven push targeting, delivery summaries, archive/resume,
// resurrection waits, and reaping — all reused, none duplicated.
//
// The relay (a baton passed through one thread):
//   alpha posts a ROOT mentioning @beta @gamma   → pushes to beta, gamma
//   beta  replies in-thread mentioning @gamma     → pushes to gamma (+thread: alpha)
//   gamma replies in-thread mentioning @alpha     → pushes to alpha (+thread: beta)
//   alpha posts an in-thread VALIDATION           → pushes to thread: beta, gamma
// Then an archive/resume lap: archive beta (it drops out of the baton fanout),
// resume beta (it rejoins), and prove the relay reaches it again.
import { afterAll, expect } from "bun:test";
import { archiveSession } from "../src/api/archive.ts";
import { resumeSession } from "../src/api/resume.ts";
import { createGroup, joinGroup } from "../src/api/groups.ts";
import { getThread } from "../src/api/threads.ts";
import { cleanupDaemonHomes } from "./support/daemon.ts";
import {
  createHarness,
  groupPostWhenActive,
  harnessTest,
  reached,
  reap,
  waitForInbox,
  waitForResumed,
} from "./support/aoe-harness.ts";

const h = createHarness();
afterAll(async () => {
  await h.cleanup();
  await cleanupDaemonHomes();
});

harnessTest("three-agent thread-baton relay survives an archive/resume lap (3 agents)", async () => {
  const daemon = await h.startHarnessDaemon();
  const peers: string[] = [];
  try {
    // 1. Three real Pi agents through the real launch lifecycle.
    const alpha = (await h.launchPi(daemon.client, "alpha")).peerId;
    const beta = (await h.launchPi(daemon.client, "beta")).peerId;
    const gamma = (await h.launchPi(daemon.client, "gamma")).peerId;
    peers.push(alpha, beta, gamma);

    const group = "baton-relay";
    await createGroup(daemon.client, { name: group, creatorPeerId: alpha });
    await joinGroup(daemon.client, { name: group, peerId: alpha, alias: "alpha" });
    await joinGroup(daemon.client, { name: group, peerId: beta, alias: "beta" });
    await joinGroup(daemon.client, { name: group, peerId: gamma, alias: "gamma" });

    // 2. alpha lays down the baton root, mentioning the next two carriers.
    const root = await groupPostWhenActive(daemon.client, group, alpha, "BATON v1 steps=[alpha] @beta @gamma");
    expect(root.delivery.pushed_to).toContain(beta);
    expect(root.delivery.pushed_to).toContain(gamma);

    // 3. beta carries it forward in-thread, handing to @gamma. The push set is
    //    {thread participants so far} ∪ {mentioned} = {alpha} ∪ {gamma}.
    const betaHop = await groupPostWhenActive(daemon.client, group, beta, "BATON v2 steps=[alpha,beta] @gamma", root.eventId);
    expect(betaHop.delivery.pushed_to).toContain(gamma);
    expect(betaHop.delivery.pushed_to).toContain(alpha);

    // 4. gamma hands back to @alpha; push set = {alpha, beta} ∪ {alpha}.
    const gammaHop = await groupPostWhenActive(daemon.client, group, gamma, "BATON v3 steps=[alpha,beta,gamma] @alpha", root.eventId);
    expect(gammaHop.delivery.pushed_to).toContain(alpha);
    expect(gammaHop.delivery.pushed_to).toContain(beta);

    // 5. alpha validates in-thread; thread participants (beta, gamma) get it.
    const validation = await groupPostWhenActive(daemon.client, group, alpha, "BATON VALIDATED v3 by=alpha", root.eventId);
    expect(validation.delivery.pushed_to).toContain(beta);
    expect(validation.delivery.pushed_to).toContain(gamma);

    // 6. The whole baton lives in ONE thread: root + 3 replies under it.
    //    (group "flat" view is the main channel only; the thread fetch returns
    //    the root plus its in-thread replies.)
    const thread = await getThread(daemon.client, { rootEventId: root.eventId, format: "events" });
    const batonEvents = (thread.events ?? []).filter((e) => (e.body ?? "").startsWith("BATON"));
    expect(batonEvents.length).toBe(4);
    for (const e of batonEvents.filter((e) => e.event_id !== root.eventId)) {
      expect(e.parent_event_id).toBe(root.eventId);
    }
    // Each downstream carrier actually received the hop addressed to it.
    await waitForInbox(daemon.client, beta, "BATON v1");
    await waitForInbox(daemon.client, gamma, "BATON v2");
    await waitForInbox(daemon.client, alpha, "BATON v3");

    // ── archive/resume lap ───────────────────────────────────────────────────
    // 7. Archive beta: it drops out of the baton fanout while reserved.
    expect((await archiveSession(daemon.client, { peerId: beta, reason: "baton-harness" })).action).toBe("archived");
    const whileArchived = await groupPostWhenActive(daemon.client, group, alpha, "BATON v1 (beta archived) @beta @gamma");
    expect(reached(whileArchived.delivery).has(beta)).toBe(false);
    expect(reached(whileArchived.delivery).has(gamma)).toBe(true);

    // 8. Resume beta: once it resurrects it is back in the baton.
    expect((await resumeSession(daemon.client, { peerId: beta })).mode).toBe("launch");
    await waitForResumed(daemon.client, beta);
    const afterResume = await groupPostWhenActive(daemon.client, group, alpha, "BATON v1 (beta resumed) @beta @gamma");
    expect(afterResume.delivery.pushed_to).toContain(beta);
    expect(afterResume.delivery.pushed_to).toContain(gamma);
    await waitForInbox(daemon.client, beta, "(beta resumed)");
  } finally {
    await reap(daemon.client, peers);
    await daemon.stop();
  }
}, 360_000);
