import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function startDaemon(home: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: home,
      SYNCHRONIZE_PORT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = await Bun.file(discoveryPath).json();
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          baseUrl: discovery.baseUrl,
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
  throw new Error("daemon did not write discovery file");
}

async function json<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body as T;
}

test("register, heartbeat, list, deregister, DM, events, inbox, and ack work through REST", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-messaging-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await json<{ peer: { peer_id: string; session_name: string } }>(
      daemon.baseUrl,
      "/peers/register",
      {
        method: "POST",
        body: JSON.stringify({ session_name: "alice", tool: "codex", purpose: "sender" }),
      },
    );
    const bob = await json<{ peer: { peer_id: string; session_name: string } }>(
      daemon.baseUrl,
      "/peers/register",
      {
        method: "POST",
        body: JSON.stringify({ session_name: "bob", tool: "claude", purpose: "receiver" }),
      },
    );

    const peers = await json<{ peers: Array<{ peer_id: string; online: boolean }> }>(daemon.baseUrl, "/peers");
    expect(peers.peers.map((peer) => peer.peer_id).sort()).toEqual([alice.peer.peer_id, bob.peer.peer_id].sort());
    expect(peers.peers.every((peer) => peer.online)).toBe(true);

    const heartbeat = await json<{ peer: { peer_id: string } }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(alice.peer.peer_id)}/heartbeat`,
      { method: "PATCH" },
    );
    expect(heartbeat.peer.peer_id).toBe(alice.peer.peer_id);

    const dm = await json<{ event: { event_id: number; body: string; recipient_peer_id: string } }>(
      daemon.baseUrl,
      "/dm",
      {
        method: "POST",
        body: JSON.stringify({
          sender_peer_id: alice.peer.peer_id,
          recipient_peer_id: bob.peer.peer_id,
          message: "hello bob",
        }),
      },
    );
    expect(dm.event).toMatchObject({ body: "hello bob", recipient_peer_id: bob.peer.peer_id });

    const events = await json<{ events: Array<{ event_id: number; body: string }>; next_cursor: number }>(
      daemon.baseUrl,
      `/events/${encodeURIComponent(bob.peer.peer_id)}?cursor=0&limit=10`,
    );
    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.event_id).toBe(dm.event.event_id);

    const inbox = await json<{ events: Array<{ event_id: number; body: string | null }> }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(bob.peer.peer_id)}/inbox`,
    );
    expect(inbox.events).toEqual([expect.objectContaining({ event_id: dm.event.event_id, body: "hello bob" })]);

    const ack = await json<{ acked: number }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(bob.peer.peer_id)}/inbox/ack`,
      { method: "POST", body: JSON.stringify({ event_ids: [dm.event.event_id] }) },
    );
    expect(ack.acked).toBe(1);

    const empty = await json<{ events: unknown[] }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(bob.peer.peer_id)}/inbox`,
    );
    expect(empty.events).toHaveLength(0);

    const removed = await json<{ ok: boolean }>(daemon.baseUrl, `/peers/${encodeURIComponent(alice.peer.peer_id)}`, {
      method: "DELETE",
    });
    expect(removed.ok).toBe(true);
  } finally {
    await daemon.stop();
  }
});

test("CLI register, dm, and inbox use the REST daemon state", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-cli-"));
  homes.push(home);

  const bobRegister = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "register", "--name", "bob", "--purpose", "receiver"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(bobRegister.exitCode).toBe(0);
  expect(bobRegister.stderr.toString()).toContain("Claude channel real-time notifications do not work through CLI peers");
  const bob = JSON.parse(bobRegister.stdout.toString()) as { peer_id: string; session_name: string };

  const aliceRegister = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "register", "--name", "alice", "--purpose", "sender"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(aliceRegister.exitCode).toBe(0);
  const whoami = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "whoami"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(whoami.exitCode).toBe(0);
  expect(JSON.parse(whoami.stdout.toString())).toMatchObject({ session_name: "alice" });

  const dm = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "dm", bob.peer_id, "hello from cli"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(dm.exitCode).toBe(0);
  expect(dm.stderr.toString()).toContain("with CLI, use inbox polling/checking");
  expect(JSON.parse(dm.stdout.toString())).toMatchObject({ body: "hello from cli" });

  await writeFile(join(home, "cli-peer.json"), JSON.stringify({ peer_id: bob.peer_id, session_name: "bob" }), "utf8");

  const inbox = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "inbox", "--ack"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(inbox.exitCode).toBe(0);
  const inboxBody = JSON.parse(inbox.stdout.toString()) as { events: Array<{ body: string }> };
  expect(inboxBody.events).toEqual([expect.objectContaining({ body: "hello from cli" })]);

  const staleIdentityGuard = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "group", "create", "cli-room", "--as", "alice"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(staleIdentityGuard.exitCode).toBe(1);
  expect(staleIdentityGuard.stderr.toString()).toContain("CLI peer mismatch");

  const cliGroupCreate = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "group", "create", "cli-room", "--as", "bob"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(cliGroupCreate.exitCode).toBe(0);

  const cliGroupJoin = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "group", "join", "cli-room", "--as", "bob"],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(cliGroupJoin.exitCode).toBe(0);
  expect(JSON.parse(cliGroupJoin.stdout.toString())).toMatchObject({ member: { alias: "bob" } });

  const discovery = await Bun.file(join(home, "daemon.json")).json();
  process.kill(discovery.pid);
});

test("Claude hook is env gated and registers native session binding when enabled", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-hook-"));
  homes.push(home);
  const input = JSON.stringify({
    session_id: "claude-hook-session",
    transcript_path: "/tmp/claude-hook-session.jsonl",
    cwd: "/tmp/project",
    source: "startup",
    model: "sonnet",
  });

  const disabled = Bun.spawnSync({
    cmd: ["bash", "-lc", `printf '%s' '${input}' | bun run src/cli.ts hook claude-session`],
    env: { ...process.env, SYNCHRONIZE_HOME: home },
  });
  expect(disabled.exitCode).toBe(0);
  await expect(stat(join(home, "daemon.json"))).rejects.toThrow();

  const enabled = Bun.spawnSync({
    cmd: ["bash", "-lc", `printf '%s' '${input}' | bun run src/cli.ts hook claude-session`],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: home,
      SYNCHRONIZE_HOOK_ENABLE: "1",
      SYNCHRONIZE_SESSION_NAME: "hooked-claude",
    },
  });
  expect(enabled.exitCode).toBe(0);
  const parsed = JSON.parse(enabled.stdout.toString()) as { binding: { host_session_id: string; peer: { session_name: string } } };
  expect(parsed.binding.host_session_id).toBe("claude-hook-session");
  expect(parsed.binding.peer.session_name).toBe("hooked-claude");

  const discovery = await Bun.file(join(home, "daemon.json")).json();
  const sessions = await fetch(`${discovery.baseUrl}/agent-sessions?tool=claude`).then((response) => response.json());
  expect(sessions.bindings).toHaveLength(1);
  process.kill(discovery.pid);
});

test("groups support durable restart, ephemeral cleanup, aliases, fanout, and history modes", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-groups-"));
  homes.push(home);
  let daemon = await startDaemon(home);

  try {
    const alice = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "alice", tool: "codex" }),
    });
    const bob = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "bob", tool: "claude" }),
    });
    const carol = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "carol", tool: "cli" }),
    });
    const dave = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "lead", tool: "cli" }),
    });

    await json(daemon.baseUrl, "/groups", {
      method: "POST",
      body: JSON.stringify({ name: "durable-room", creator_peer_id: alice.peer.peer_id }),
    });
    await json(daemon.baseUrl, "/groups", {
      method: "POST",
      body: JSON.stringify({ name: "scratch-room", creator_peer_id: alice.peer.peer_id, ephemeral: true }),
    });

    await daemon.stop();
    daemon = await startDaemon(home);

    const groups = await json<{ groups: Array<{ name: string }> }>(daemon.baseUrl, "/groups");
    expect(groups.groups.map((group) => group.name)).toContain("durable-room");
    expect(groups.groups.map((group) => group.name)).not.toContain("scratch-room");

    await json(daemon.baseUrl, "/groups/durable-room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: alice.peer.peer_id, alias: "lead" }),
    });
    const prior = await json<{ event: { event_id: number } }>(daemon.baseUrl, "/groups/durable-room/messages", {
      method: "POST",
      body: JSON.stringify({ sender_peer_id: alice.peer.peer_id, message: "before joins" }),
    });

    await json(daemon.baseUrl, "/groups/durable-room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: bob.peer.peer_id, alias: "reviewer" }),
    });

    const aliasDefaults = await json<{ member: { alias: string } }>(daemon.baseUrl, "/groups/durable-room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: carol.peer.peer_id }),
    });
    expect(aliasDefaults.member.alias).toBe("carol");

    const duplicateAlias = await fetch(`${daemon.baseUrl}/groups/durable-room/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer_id: carol.peer.peer_id, alias: "reviewer" }),
    });
    expect(duplicateAlias.status).toBe(409);
    const duplicateAliasBody = (await duplicateAlias.json()) as { error: { message: string } };
    expect(duplicateAliasBody.error.message).toContain("Provide a unique alias");

    const carolLeave = await json<{ ok: boolean }>(daemon.baseUrl, "/groups/durable-room/leave", {
      method: "POST",
      body: JSON.stringify({ peer_id: carol.peer.peer_id }),
    });
    expect(carolLeave.ok).toBe(true);

    const carolNameCollision = await fetch(`${daemon.baseUrl}/groups/durable-room/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer_id: dave.peer.peer_id }),
    });
    expect(carolNameCollision.status).toBe(409);
    expect(((await carolNameCollision.json()) as { error: { message: string } }).error.message).toContain(
      "Provide a unique alias",
    );

    await json(daemon.baseUrl, "/groups/durable-room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: carol.peer.peer_id, alias: "fresh", fresh: true }),
    });

    const bobHistory = await json<{ events: Array<{ event_id: number; body: string | null }> }>(
      daemon.baseUrl,
      `/groups/durable-room/history?peer_id=${encodeURIComponent(bob.peer.peer_id)}`,
    );
    expect(bobHistory.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ event_id: prior.event.event_id, body: "before joins" })]),
    );

    const carolHistory = await json<{ events: Array<{ body: string | null }> }>(
      daemon.baseUrl,
      `/groups/durable-room/history?peer_id=${encodeURIComponent(carol.peer.peer_id)}`,
    );
    expect(carolHistory.events.some((event) => event.body === "before joins")).toBe(false);

    const after = await json<{ event: { event_id: number } }>(daemon.baseUrl, "/groups/durable-room/messages", {
      method: "POST",
      body: JSON.stringify({ sender_peer_id: bob.peer.peer_id, message: "after joins" }),
    });
    expect(after.event.event_id).toBeGreaterThan(prior.event.event_id);

    const aliceInbox = await json<{ events: Array<{ body: string | null }> }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(alice.peer.peer_id)}/inbox`,
    );
    const carolInbox = await json<{ events: Array<{ body: string | null }> }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(carol.peer.peer_id)}/inbox`,
    );
    const bobInbox = await json<{ events: Array<{ body: string | null }> }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(bob.peer.peer_id)}/inbox`,
    );
    expect(aliceInbox.events).toEqual([expect.objectContaining({ body: "after joins" })]);
    expect(carolInbox.events).toEqual([expect.objectContaining({ body: "after joins" })]);
    expect(bobInbox.events.some((event) => event.body === "after joins")).toBe(false);
  } finally {
    await daemon.stop();
  }
});

test("media share copies files, indexes metadata, and emits group inbox events", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-media-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "alice", tool: "codex" }),
    });
    const bob = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "bob", tool: "claude" }),
    });
    await json(daemon.baseUrl, "/groups", {
      method: "POST",
      body: JSON.stringify({ name: "media-room", creator_peer_id: alice.peer.peer_id }),
    });
    for (const peer of [alice.peer.peer_id, bob.peer.peer_id]) {
      await json(daemon.baseUrl, "/groups/media-room/join", {
        method: "POST",
        body: JSON.stringify({ peer_id: peer }),
      });
    }

    const source = join(home, "trace.json");
    await writeFile(source, JSON.stringify({ ok: true }), "utf8");
    const shared = await json<{ media: { media_id: string; copied_path: string; sha256: string }; event: { media_id: string } }>(
      daemon.baseUrl,
      "/groups/media-room/media",
      {
        method: "POST",
        body: JSON.stringify({
          shared_by_peer_id: alice.peer.peer_id,
          path: source,
          description: "api trace",
        }),
      },
    );
    expect(shared.event.media_id).toBe(shared.media.media_id);
    expect((await stat(shared.media.copied_path)).isFile()).toBe(true);

    const indexText = await Bun.file(join(home, "media", "media-room", "index.jsonl")).text();
    expect(indexText).toContain("api trace");
    expect(indexText).toContain(shared.media.media_id);

    const listed = await json<{ media: Array<{ media_id: string }> }>(daemon.baseUrl, "/groups/media-room/media?query=trace");
    expect(listed.media).toEqual([expect.objectContaining({ media_id: shared.media.media_id })]);

    const fetched = await json<{ media: { media_id: string; copied_path: string } }>(
      daemon.baseUrl,
      `/media/${shared.media.media_id}`,
    );
    expect(fetched.media.copied_path).toBe(shared.media.copied_path);

    const bobInbox = await json<{ events: Array<{ type: string; media_id: string | null }> }>(
      daemon.baseUrl,
      `/peers/${encodeURIComponent(bob.peer.peer_id)}/inbox`,
    );
    expect(bobInbox.events).toEqual([expect.objectContaining({ type: "media_shared", media_id: shared.media.media_id })]);

    const summary = await json<{
      totals: { peers: { total: number; online: number }; groups: { durable: number }; media: { files: number } };
      peers: Array<{ peer_id: string; pending_inbox: number }>;
      groups: Array<{ name: string; media: number }>;
    }>(daemon.baseUrl, "/summary");
    expect(summary.totals.peers).toMatchObject({ total: 2, online: 2 });
    expect(summary.totals.groups.durable).toBe(1);
    expect(summary.totals.media.files).toBe(1);
    expect(summary.peers).toEqual(expect.arrayContaining([expect.objectContaining({ peer_id: bob.peer.peer_id, pending_inbox: 1 })]));
    expect(summary.groups).toEqual(expect.arrayContaining([expect.objectContaining({ name: "media-room", media: 1 })]));
  } finally {
    await daemon.stop();
  }
});
