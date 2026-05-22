import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentSessions, registerAgentSession, renameAgentSession } from "../src/api/agent-sessions.ts";
import { ackInbox, readInbox, sendDm } from "../src/api/inbox.ts";
import { registerPeer } from "../src/api/peers.ts";
import { findReusablePeer } from "../src/api/status.ts";
import type { ClientConfig } from "../src/client.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

test("agent session bindings upsert by native session and rename by peer id", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-agent-session-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const registered = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-native-1",
      hostSessionFile: "/tmp/claude-native-1.jsonl",
      cwd: "/tmp/project",
      sessionName: "backend-review",
      tool: "claude",
      purpose: "claude session",
      metadata: { source: "startup" },
      launchId: "launch-abc",
    });

    expect(registered.binding.host_session_id).toBe("claude-native-1");
    expect(registered.binding.peer.session_name).toBe("backend-review");
    expect(registered.binding.peer.tool).toBe("claude");

    const renamed = await renameAgentSession(daemon.client, {
      peerId: registered.binding.peer_id,
      sessionName: "backend-renamed",
    });
    expect(renamed.binding.peer_id).toBe(registered.binding.peer_id);
    expect(renamed.binding.peer.session_name).toBe("backend-renamed");

    const byPeer = await listAgentSessions(daemon.client, { peerId: registered.binding.peer_id });
    expect(byPeer.bindings).toHaveLength(1);
    expect(byPeer.bindings[0]).toMatchObject({
      host_tool: "claude",
      host_session_id: "claude-native-1",
      peer_id: registered.binding.peer_id,
    });

    const byLaunch = await listAgentSessions(daemon.client, { launchId: "launch-abc" });
    expect(byLaunch.bindings).toHaveLength(1);
    expect(byLaunch.bindings[0]?.peer_id).toBe(registered.binding.peer_id);

    const upserted = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-native-1",
      sessionName: "backend-renamed",
      tool: "claude",
      cwd: "/tmp/project-2",
    });
    expect(upserted.binding.peer_id).toBe(registered.binding.peer_id);
    expect(upserted.binding.cwd).toBe("/tmp/project-2");

    const allClaude = await listAgentSessions(daemon.client, { hostTool: "claude" });
    expect(allClaude.bindings).toHaveLength(1);
  } finally {
    await daemon.stop();
  }
});

test("duplicate session names remain distinct when host session ids differ", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-duplicate-session-name-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const first = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-duplicate-a",
      sessionName: "same-alias",
      tool: "claude",
    });
    const second = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-duplicate-b",
      sessionName: "same-alias",
      tool: "claude",
    });

    expect(first.binding.peer_id).not.toBe(second.binding.peer_id);
    expect(first.binding.peer.session_name).toBe("same-alias");
    expect(second.binding.peer.session_name).toBe("same-alias");

    const bindings = await listAgentSessions(daemon.client, { hostTool: "claude" });
    expect(bindings.bindings.map((binding) => binding.host_session_id).sort()).toEqual([
      "claude-duplicate-a",
      "claude-duplicate-b",
    ]);
  } finally {
    await daemon.stop();
  }
});

async function startDaemon(home: string): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
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

test("shared API client registers reusable peers and drives DM inbox flow", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-api-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, {
      sessionName: "alice",
      tool: "cli",
      purpose: "sender",
    });
    const bob = await registerPeer(daemon.client, {
      sessionName: "bob",
      tool: "codex",
      purpose: "receiver",
    });
    const reusedBob = await findReusablePeer(daemon.client, { sessionName: "bob", tool: "codex" });

    expect(reusedBob).toBe(bob.peer.peer_id);

    const dm = await sendDm(daemon.client, {
      senderPeerId: alice.peer.peer_id,
      recipientPeerId: bob.peer.peer_id,
      message: "through shared api",
    });
    expect(dm.event).toMatchObject({ body: "through shared api", recipient_peer_id: bob.peer.peer_id });

    const inbox = await readInbox(daemon.client, bob.peer.peer_id);
    expect(inbox.events).toEqual([expect.objectContaining({ event_id: dm.event.event_id })]);

    const ack = await ackInbox(
      daemon.client,
      bob.peer.peer_id,
      inbox.events.map((event) => event.event_id),
    );
    expect(ack.acked).toBe(1);

    const empty = await readInbox(daemon.client, bob.peer.peer_id);
    expect(empty.events).toHaveLength(0);
  } finally {
    await daemon.stop();
  }
});
