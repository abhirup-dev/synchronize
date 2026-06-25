import { afterAll, expect, test } from "bun:test";
import { ApiError } from "../src/client.ts";
import { deletePeer, registerPeer } from "../src/api/peers.ts";
import { createGroup, joinGroup, renameInGroup, sendGroupMessage } from "../src/api/groups.ts";
import { readInbox, sendDm } from "../src/api/inbox.ts";
import { archiveGroup, archiveSession } from "../src/api/archive.ts";
import { cleanupDaemonHomes, startDaemon } from "./support/daemon.ts";

afterAll(cleanupDaemonHomes);

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  throw new Error("expected an ApiError but the call succeeded");
}

test("archive session: non-AOE peer archives cleanly, reserves alias, is not deleted", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "critic", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "critic" });

    const result = await archiveSession(daemon.client, { peerId: peer.peer_id, reason: "checkpoint" });
    expect(result.action).toBe("archived");
    expect(result.reaped).toBe(false); // non-AOE
    expect(result.zombie).toBe(false); // no live pid
    expect(result.aliases).toEqual([{ group: "room", alias: "critic" }]);
    expect(result.resume_hint).toContain(peer.peer_id);

    // Idempotent: re-archive reports already_archived (peer still present).
    const again = await archiveSession(daemon.client, { peerId: peer.peer_id });
    expect(again.action).toBe("already_archived");

    // Seat reserved: another peer cannot take the archived alias.
    const { peer: other } = await registerPeer(daemon.client, { sessionName: "other", tool: "claude" });
    const code = await errorCode(() => joinGroup(daemon.client, { name: "room", peerId: other.peer_id, alias: "critic" }));
    expect(code).toBe("alias_reserved_by_archived");
  } finally {
    await daemon.stop();
  }
});

test("deleting an archived peer releases its reserved alias seat", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "critic", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "critic" });
    await archiveSession(daemon.client, { peerId: peer.peer_id });

    const { peer: blocked } = await registerPeer(daemon.client, { sessionName: "blocked", tool: "claude" });
    expect(await errorCode(() => joinGroup(daemon.client, { name: "room", peerId: blocked.peer_id, alias: "critic" }))).toBe(
      "alias_reserved_by_archived",
    );

    await deletePeer(daemon.client, peer.peer_id);

    const { peer: replacement } = await registerPeer(daemon.client, { sessionName: "replacement", tool: "claude" });
    await expect(joinGroup(daemon.client, { name: "room", peerId: replacement.peer_id, alias: "critic" })).resolves.toBeDefined();
  } finally {
    await daemon.stop();
  }
});

test("archive session --dry-run reports the plan without mutating", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "critic", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "critic" });

    const dry = await archiveSession(daemon.client, { peerId: peer.peer_id, dryRun: true });
    expect(dry.action).toBe("would_archive");
    expect(dry.dry_run).toBe(true);

    // Not mutated: the peer can still send (not archived).
    await expect(
      sendGroupMessage(daemon.client, { name: "room", senderPeerId: peer.peer_id, message: "still here" }),
    ).resolves.toBeDefined();
  } finally {
    await daemon.stop();
  }
});

test("archived sender is blocked from group send and DM with must_reregister", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "a", tool: "claude" });
    const { peer: b } = await registerPeer(daemon.client, { sessionName: "b", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "a" });
    await joinGroup(daemon.client, { name: "room", peerId: b.peer_id, alias: "b" });

    await archiveSession(daemon.client, { peerId: b.peer_id });

    expect(await errorCode(() => sendGroupMessage(daemon.client, { name: "room", senderPeerId: b.peer_id, message: "hi" }))).toBe(
      "must_reregister",
    );
    expect(await errorCode(() => sendDm(daemon.client, { senderPeerId: b.peer_id, recipientPeerId: a.peer_id, message: "hi" }))).toBe(
      "must_reregister",
    );
  } finally {
    await daemon.stop();
  }
});

test("rename onto an archived alias fails with alias_reserved_by_archived", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "a", tool: "claude" });
    const { peer: b } = await registerPeer(daemon.client, { sessionName: "b", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "critic" });
    await joinGroup(daemon.client, { name: "room", peerId: b.peer_id, alias: "planner" });
    await archiveSession(daemon.client, { peerId: a.peer_id }); // reserves 'critic'

    expect(await errorCode(() => renameInGroup(daemon.client, { name: "room", peerId: b.peer_id, newAlias: "critic" }))).toBe(
      "alias_reserved_by_archived",
    );
  } finally {
    await daemon.stop();
  }
});

test("an archived member is excluded from group inbox fanout", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "a", tool: "claude" });
    const { peer: b } = await registerPeer(daemon.client, { sessionName: "b", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "a" });
    await joinGroup(daemon.client, { name: "room", peerId: b.peer_id, alias: "b" });

    await archiveSession(daemon.client, { peerId: b.peer_id });
    await sendGroupMessage(daemon.client, { name: "room", senderPeerId: a.peer_id, message: "after archive" });

    const inbox = await readInbox(daemon.client, b.peer_id);
    const bodies = inbox.events.map((e) => e.body);
    expect(bodies).not.toContain("after archive");
  } finally {
    await daemon.stop();
  }
});

test("archive group reports per-member status and reserves every alias", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "a", tool: "claude" });
    const { peer: b } = await registerPeer(daemon.client, { sessionName: "b", tool: "pi" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "critic" });
    await joinGroup(daemon.client, { name: "room", peerId: b.peer_id, alias: "planner" });

    const result = await archiveGroup(daemon.client, { group: "room", reason: "overnight" });
    expect(result.members).toHaveLength(2);
    const byAlias = Object.fromEntries(result.members.map((m) => [m.alias, m]));
    expect(byAlias.critic?.action).toBe("archived");
    expect(byAlias.planner?.action).toBe("archived");
    expect(byAlias.planner?.tool).toBe("pi");

    // Every alias reserved: a new peer cannot reuse either.
    const { peer: c } = await registerPeer(daemon.client, { sessionName: "c", tool: "claude" });
    expect(await errorCode(() => joinGroup(daemon.client, { name: "room", peerId: c.peer_id, alias: "critic" }))).toBe(
      "alias_reserved_by_archived",
    );
  } finally {
    await daemon.stop();
  }
});

test("archive group skips the local web viewer membership", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "a", tool: "claude" });
    const { peer: web } = await registerPeer(daemon.client, { peerId: "web:local-human", sessionName: "web-ui", tool: "web" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "critic" });
    await joinGroup(daemon.client, { name: "room", peerId: web.peer_id, alias: "you" });

    const result = await archiveGroup(daemon.client, { group: "room", reason: "overnight" });
    const byAlias = Object.fromEntries(result.members.map((m) => [m.alias, m]));
    expect(byAlias.critic?.action).toBe("archived");
    expect(byAlias.you).toMatchObject({
      action: "skipped",
      peer_id: "web:local-human",
      tool: "web",
    });

    await sendGroupMessage(daemon.client, { name: "room", senderPeerId: web.peer_id, message: "still browsing" });
  } finally {
    await daemon.stop();
  }
});

test("a live archived (zombie) peer cannot send, re-subscribe, or be pushed until it re-registers", async () => {
  const daemon = await startDaemon({ debug: true });
  // A local callback server stands in for the agent's live push channel; it
  // records every notification the daemon delivers.
  const received: Array<{ event?: { body?: string } }> = [];
  const cb = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      received.push((await req.json()) as { event?: { body?: string } });
      return new Response("ok");
    },
  });
  const callbackUrl = `http://127.0.0.1:${cb.port}/events`;
  const subscribe = (peerId: string) =>
    fetch(`${daemon.client.baseUrl}/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer_id: peerId, callback_url: callbackUrl, token: "tok" }),
    });
  const waitFor = async (predicate: () => boolean, ms = 4000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await Bun.sleep(100);
    }
    return predicate();
  };

  try {
    const { peer: zombie } = await registerPeer(daemon.client, { sessionName: "zombie", tool: "claude" });
    const { peer: sender } = await registerPeer(daemon.client, { sessionName: "sender", tool: "claude" });

    // Live channel works before archive: a DM is pushed to the callback.
    expect((await subscribe(zombie.peer_id)).status).toBe(201);
    await sendDm(daemon.client, { senderPeerId: sender.peer_id, recipientPeerId: zombie.peer_id, message: "pre-archive ping" });
    expect(await waitFor(() => received.some((r) => r.event?.body === "pre-archive ping"))).toBe(true);

    // Archive the (still-alive) zombie.
    await archiveSession(daemon.client, { peerId: zombie.peer_id });
    const before = received.length;

    // (a) cannot send while archived.
    expect(await errorCode(() => sendDm(daemon.client, { senderPeerId: zombie.peer_id, recipientPeerId: sender.peer_id, message: "x" }))).toBe(
      "must_reregister",
    );
    // (b) cannot re-open a live channel while archived.
    expect((await subscribe(zombie.peer_id)).status).toBe(409);

    // (c) no live push while archived — but the DM is durably queued for resume.
    await sendDm(daemon.client, { senderPeerId: sender.peer_id, recipientPeerId: zombie.peer_id, message: "while-archived ping" });
    await Bun.sleep(500);
    expect(received.length).toBe(before); // nothing pushed
    const inbox = await readInbox(daemon.client, zombie.peer_id);
    expect(inbox.events.some((e) => e.body === "while-archived ping")).toBe(true); // durable fallback held it

    // After re-registering, the identity resurrects: it can subscribe + be pushed again.
    await registerPeer(daemon.client, { peerId: zombie.peer_id, sessionName: "zombie", tool: "claude" });
    expect((await subscribe(zombie.peer_id)).status).toBe(201);
    await sendDm(daemon.client, { senderPeerId: sender.peer_id, recipientPeerId: zombie.peer_id, message: "post-resume ping" });
    expect(await waitFor(() => received.some((r) => r.event?.body === "post-resume ping"))).toBe(true);
  } finally {
    cb.stop(true);
    await daemon.stop();
  }
});

test("mentioning an archived alias yields an alias_archived warning (web guardrail signal)", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "a", tool: "claude" });
    const { peer: b } = await registerPeer(daemon.client, { sessionName: "b", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: "room", peerId: b.peer_id, alias: "bob" });
    await archiveSession(daemon.client, { peerId: b.peer_id });

    // a mentions the archived bob and a truly-unknown alias.
    const res = await sendGroupMessage(daemon.client, { name: "room", senderPeerId: a.peer_id, message: "ping @bob and @ghost" });
    const byToken = Object.fromEntries(res.warnings.map((w) => [w.token, w.reason]));
    expect(byToken["@bob"]).toBe("alias_archived"); // distinct, actionable signal
    expect(byToken["@ghost"]).toBe("alias_not_in_group"); // truly unknown
  } finally {
    await daemon.stop();
  }
});
