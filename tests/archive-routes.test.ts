import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type ClientConfig } from "../src/client.ts";
import { registerPeer } from "../src/api/peers.ts";
import { createGroup, joinGroup, renameInGroup, sendGroupMessage } from "../src/api/groups.ts";
import { readInbox, sendDm } from "../src/api/inbox.ts";
import { archiveGroup, archiveSession } from "../src/api/archive.ts";

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function startDaemon(): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-archive-"));
  homes.push(home);
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    // SYNCHRONIZE_DEBUG on: integration runs emit the full decision/transition
    // trail (sweeps, reap/probe outcomes, guards) so a failing test is
    // diagnosable from the daemon log alone.
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", SYNCHRONIZE_DEBUG: "1" },
    stdout: "pipe",
    // Forward the daemon's decision/transition trail to the test runner's stderr
    // so a failing integration test is diagnosable from the log alone.
    stderr: "inherit",
  });
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          client: { baseUrl: discovery.baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
          stop: async () => {
            proc.kill();
            await proc.exited;
          },
        };
      }
    } catch {
      await Bun.sleep(50);
    }
  }
  proc.kill();
  await proc.exited;
  throw new Error("daemon did not start");
}

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
  const daemon = await startDaemon();
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

test("archive session --dry-run reports the plan without mutating", async () => {
  const daemon = await startDaemon();
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
  const daemon = await startDaemon();
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
  const daemon = await startDaemon();
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
  const daemon = await startDaemon();
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
  const daemon = await startDaemon();
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

test("mentioning an archived alias yields an alias_archived warning (web guardrail signal)", async () => {
  const daemon = await startDaemon();
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
