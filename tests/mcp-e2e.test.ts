import { afterAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

function parseToolText(result: unknown): unknown {
  const typed = result as { content?: Array<{ type: string; text?: string }> };
  const text = typed.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("tool result had no text content");
  return JSON.parse(text);
}

test("MCP stdio adapter exposes REST-backed parity tools, Codex notifications, and durable inbox fallback", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-e2e-"));
  homes.push(home);
  const client = new Client({ name: "synchronize-test-client", version: "0.1.0" });
  const notifications: unknown[] = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    notifications.push(notification);
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", "src/mcp.ts"],
    cwd: process.cwd(),
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", SYNCHRONIZE_MCP_MODE: "codex" },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    await client.setLoggingLevel("debug");
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "bridge_register",
        "bridge_whoami",
        "bridge_list_peers",
        "bridge_dm",
        "bridge_reply",
        "bridge_inbox",
        "bridge_create_group",
        "bridge_join_group",
        "bridge_leave_group",
        "bridge_send_group",
        "bridge_group_history",
        "bridge_list_groups",
        "bridge_launch",
        "bridge_stop",
        "bridge_share_media",
        "bridge_list_media",
        "bridge_get_media",
        "bridge_query_events",
        "bridge_react",
        "bridge_list_reactions",
        "bridge_list_threads",
        "bridge_get_thread_status",
        "bridge_get_thread",
      ]),
    );

    const registered = parseToolText(
      await client.callTool({ name: "bridge_register", arguments: { session_name: "codex-e2e", purpose: "test" } }),
    ) as { peer: { peer_id: string } };
    const peerId = registered.peer.peer_id;

    await client.callTool({ name: "bridge_dm", arguments: { recipient_peer_id: peerId, message: "self notify" } });
    await client.callTool({ name: "bridge_dm", arguments: { peer_id: peerId, message: "self notify via alias" } });
    const deadline = Date.now() + 5_000;
    while (notifications.length === 0 && Date.now() < deadline) await Bun.sleep(20);
    expect(notifications.length).toBeGreaterThan(0);
    const inbox = parseToolText(await client.callTool({ name: "bridge_inbox", arguments: { ack: true } })) as {
      events: Array<{ body: string | null }>;
    };
    expect(inbox.events).toEqual([
      expect.objectContaining({ body: "self notify" }),
      expect.objectContaining({ body: "self notify via alias" }),
    ]);

    await client.callTool({ name: "bridge_create_group", arguments: { name: "mcp-room" } });
    await client.callTool({ name: "bridge_join_group", arguments: { name: "mcp-room", alias: "codex" } });
    const root = parseToolText(
      await client.callTool({ name: "bridge_send_group", arguments: { name: "mcp-room", message: "hello room" } }),
    ) as { event: { event_id: number } };
    const threadReply = parseToolText(
      await client.callTool({
        name: "bridge_send_group",
        arguments: { name: "mcp-room", message: "thread reply", in_reply_to: root.event.event_id },
      }),
    ) as { event: { event_id: number } };
    const mainReply = parseToolText(
      await client.callTool({
        name: "bridge_reply",
        arguments: { in_reply_to: root.event.event_id, message: "main bridge reply" },
      }),
    ) as {
      event: { event_id: number; parent_event_id: number | null };
      posted_to: { surface: string; direct_event_id: number; direct_sender: string; direct_preview: string };
    };
    expect(mainReply.event.parent_event_id).toBeNull();
    expect(mainReply.posted_to).toMatchObject({
      surface: "group_main",
      direct_event_id: root.event.event_id,
      direct_sender: "codex",
      direct_preview: "hello room",
    });
    const threadedBridgeReply = parseToolText(
      await client.callTool({
        name: "bridge_reply",
        arguments: { in_reply_to: threadReply.event.event_id, message: "threaded bridge reply" },
      }),
    ) as {
      event: { parent_event_id: number | null };
      posted_to: {
        surface: string;
        direct_event_id: number;
        direct_sender: string;
        direct_preview: string;
        thread_root_event_id: number;
        thread_root_sender: string;
        thread_root_preview: string;
      };
    };
    expect(threadedBridgeReply.event.parent_event_id).toBe(root.event.event_id);
    expect(threadedBridgeReply.posted_to).toMatchObject({
      surface: "thread",
      direct_event_id: threadReply.event.event_id,
      direct_sender: "codex",
      direct_preview: "thread reply",
      thread_root_event_id: root.event.event_id,
      thread_root_sender: "codex",
      thread_root_preview: "hello room",
    });
    await client.callTool({
      name: "bridge_send_group",
      arguments: { name: "mcp-room", message: "second thread reply", in_reply_to: root.event.event_id },
    });
    const history = parseToolText(
      await client.callTool({ name: "bridge_group_history", arguments: { name: "mcp-room" } }),
    ) as { events: Array<{ body: string | null }> };
    expect(history.events.some((event) => event.body === "hello room")).toBe(true);
    expect(history.events.some((event) => event.body === "main bridge reply")).toBe(true);
    const reacted = parseToolText(
      await client.callTool({ name: "bridge_react", arguments: { event_id: root.event.event_id, emoji: "👍" } }),
    ) as { reactions: Array<{ emoji: string; count: number; by: Array<{ session_name: string }> }> };
    expect(reacted.reactions).toEqual([
      expect.objectContaining({ emoji: "👍", count: 1, by: [expect.objectContaining({ session_name: "codex-e2e" })] }),
    ]);
    const listedReactions = parseToolText(
      await client.callTool({ name: "bridge_list_reactions", arguments: { event_id: root.event.event_id } }),
    ) as { reactions: Array<{ emoji: string; count: number }> };
    expect(listedReactions.reactions).toEqual([expect.objectContaining({ emoji: "👍", count: 1 })]);
    const threads = parseToolText(
      await client.callTool({ name: "bridge_list_threads", arguments: { group: "mcp-room" } }),
    ) as { threads: Array<{ root_event_id: number; reply_count: number }> };
    expect(threads.threads).toEqual([expect.objectContaining({ root_event_id: root.event.event_id, reply_count: 3 })]);
    const status = parseToolText(
      await client.callTool({ name: "bridge_get_thread_status", arguments: { root_event_id: root.event.event_id } }),
    ) as { status: { root_event_id: number; event_count: number } };
    expect(status.status).toMatchObject({ root_event_id: root.event.event_id, event_count: 4 });
    const transcript = parseToolText(
      await client.callTool({ name: "bridge_get_thread", arguments: { root_event_id: root.event.event_id, format: "transcript" } }),
    ) as { transcript: string };
    expect(transcript.transcript).toContain("hello room");
    expect(transcript.transcript).toContain("thread reply");
    expect(transcript.transcript).toContain("threaded bridge reply");
    const queried = parseToolText(
      await client.callTool({
        name: "bridge_query_events",
        arguments: {
          sql: "select body from thread_events where thread_root_event_id = ? order by event_id",
          params: [root.event.event_id],
        },
      }),
    ) as { rows: Array<{ body: string }> };
    expect(queried.rows.map((row) => row.body)).toEqual([
      "hello room",
      "thread reply",
      "threaded bridge reply",
      "second thread reply",
    ]);
  } finally {
    await client.close();
  }
});

test("MCP stdio adapter emits Claude channel notifications", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-claude-"));
  homes.push(home);
  const client = new Client({ name: "synchronize-claude-test-client", version: "0.1.0" });
  const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];
  const ClaudeChannelNotificationSchema = z.object({
    method: z.literal("notifications/claude/channel"),
    params: z.object({
      content: z.string(),
      meta: z.record(z.string(), z.string()),
    }),
  });
  client.setNotificationHandler(ClaudeChannelNotificationSchema, (notification) => {
    notifications.push(notification);
  });
  const transport = new StdioClientTransport({
    command: join(process.cwd(), "bin/synchronize-mcp"),
    args: [],
    cwd: process.cwd(),
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", SYNCHRONIZE_MCP_MODE: "claude" },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    expect(client.getServerCapabilities()?.experimental).toMatchObject({ "claude/channel": {} });
    expect(client.getInstructions()).toContain('<channel source="synchronize"');
    const registered = parseToolText(
      await client.callTool({ name: "bridge_register", arguments: { session_name: "claude-e2e" } }),
    ) as { peer: { peer_id: string } };
    await client.callTool({
      name: "bridge_dm",
      arguments: { recipient_peer_id: registered.peer.peer_id, message: "claude notify" },
    });
    const deadline = Date.now() + 5_000;
    while (!notifications.some((item) => item.method === "notifications/claude/channel") && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(notifications).toEqual([
      expect.objectContaining({
        method: "notifications/claude/channel",
        params: expect.objectContaining({
          content: "claude notify",
          meta: expect.objectContaining({ type: "dm", event_id: "1", sent_at: expect.any(String) }),
        }),
      }),
    ]);
    expect(notifications[0]?.params.meta).not.toHaveProperty("source");
    expect(Object.values(notifications[0]?.params.meta ?? {}).every((value) => typeof value === "string")).toBe(true);
  } finally {
    await client.close();
  }
});

test("Claude MCP adapter recovers from a soft-delete: next heartbeat re-registers AND re-subscribes (DM still pushed)", async () => {
  // The untested twin of the Pi peer-revival fix (sync-3nu). The Pi runtime is
  // proven by the AoE smoke + peer-revival.test.ts; this proves the MCP/Claude
  // adapter does the same recovery (maintainPeer 404 → re-register + re-subscribe)
  // deterministically, in-process, via a short heartbeat. A DM that lands AFTER
  // recovery and arrives on the Claude channel is the re-subscribe proof — the
  // subscription was rebuilt, not just the peer row resurrected.
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-revival-"));
  homes.push(home);
  const client = new Client({ name: "synchronize-revival-test", version: "0.1.0" });
  const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];
  const ClaudeChannelNotificationSchema = z.object({
    method: z.literal("notifications/claude/channel"),
    params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }),
  });
  client.setNotificationHandler(ClaudeChannelNotificationSchema, (notification) => {
    notifications.push(notification);
  });
  const transport = new StdioClientTransport({
    command: join(process.cwd(), "bin/synchronize-mcp"),
    args: [],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: home,
      SYNCHRONIZE_PORT: "0",
      SYNCHRONIZE_MCP_MODE: "claude",
      SYNCHRONIZE_MCP_HEARTBEAT_MS: "250", // recover fast instead of the 15s default
    },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const registered = parseToolText(
      await client.callTool({ name: "bridge_register", arguments: { session_name: "claude-revival" } }),
    ) as { peer: { peer_id: string } };
    const peerId = registered.peer.peer_id;

    // The adapter autostarts a daemon in SYNCHRONIZE_HOME; discover its REST URL
    // so the test can drive the daemon directly (evict + send the recovery DM).
    const { baseUrl } = (await Bun.file(join(home, "daemon.json")).json()) as { baseUrl: string };
    const peerOnline = async (): Promise<boolean> => {
      const body = (await (await fetch(`${baseUrl}/peers`)).json()) as { peers: Array<{ peer_id: string; online?: boolean }> };
      return body.peers.some((p) => p.peer_id === peerId && p.online);
    };

    // Soft-delete (operator evict == retention-sweep DB effect): peer hidden,
    // its event subscriber dropped on the daemon side.
    const del = await fetch(`${baseUrl}/peers/${peerId}`, { method: "DELETE" });
    expect(del.ok).toBe(true);

    // Recovery: within a couple of heartbeats maintainPeer 404s and re-registers
    // the same peer_id, bringing it back online.
    const recoveryDeadline = Date.now() + 10_000;
    let recovered = false;
    while (Date.now() < recoveryDeadline) {
      if (await peerOnline()) {
        recovered = true;
        break;
      }
      await Bun.sleep(100);
    }
    expect(recovered).toBe(true);

    // Re-subscribe proof: a DM sent AFTER recovery must push to the rebuilt
    // Claude-channel subscription. Send from a separate REST-registered peer.
    const sender = (
      (await (
        await fetch(`${baseUrl}/peers/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_name: "revival-sender", tool: "cli" }),
        })
      ).json()) as { peer: { peer_id: string } }
    ).peer.peer_id;
    const marker = "MCP_REVIVAL_DM";
    await fetch(`${baseUrl}/dm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_peer_id: sender, recipient_peer_id: peerId, message: marker }),
    });

    const pushDeadline = Date.now() + 10_000;
    while (!notifications.some((n) => n.params.content === marker) && Date.now() < pushDeadline) {
      await Bun.sleep(50);
    }
    expect(notifications.some((n) => n.method === "notifications/claude/channel" && n.params.content === marker)).toBe(true);

    // markWorking: channel delivery in claude mode pushes the peer to "working".
    const finalPeers = (await (await fetch(`${baseUrl}/peers`)).json()) as {
      peers: Array<{ peer_id: string; activity_state?: string | null }>;
    };
    expect(finalPeers.peers.find((p) => p.peer_id === peerId)?.activity_state).toBe("working");
  } finally {
    await client.close();
  }
});

test("MCP startup does NOT auto-start a daemon for a non-launch session (bootstrap gate)", async () => {
  // The proactive startup activation (sync-amq) must be gated on the launch env
  // (SYNCHRONIZE_PEER_ID / SYNCHRONIZE_LAUNCH_ID). An ordinary session that sets
  // neither must never call getClient() on connect — otherwise every `claude`
  // start would auto-start a synchronize daemon as a side effect.
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-nogate-"));
  homes.push(home);
  const client = new Client({ name: "synchronize-nolaunch-client", version: "0.1.0" });
  const env: Record<string, string | undefined> = {
    ...process.env,
    SYNCHRONIZE_HOME: home,
    SYNCHRONIZE_PORT: "0",
    SYNCHRONIZE_MCP_MODE: "claude",
  };
  delete env.SYNCHRONIZE_PEER_ID;
  delete env.SYNCHRONIZE_LAUNCH_ID;
  const transport = new StdioClientTransport({
    command: join(process.cwd(), "bin/synchronize-mcp"),
    args: [],
    cwd: process.cwd(),
    env: env as Record<string, string>,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    await Bun.sleep(1000); // let oninitialized -> bootstrap run (and no-op via the gate)
    expect(await Bun.file(join(home, "daemon.json")).exists()).toBe(false);
  } finally {
    await client.close();
  }
});

test("MCP errors surface as structured {error:{code,message,status?}} JSON with isError; events expose parsed mentions; bridge_group_history accepts event_ids", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-structured-"));
  homes.push(home);
  const client = new Client({ name: "synchronize-structured-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", "src/mcp.ts"],
    cwd: process.cwd(),
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", SYNCHRONIZE_MCP_MODE: "codex" },
    stderr: "pipe",
  });

  function parseError(result: unknown): { code: string; message: string; status?: number } {
    const typed = result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    expect(typed.isError).toBe(true);
    const text = typed.content?.find((item) => item.type === "text")?.text;
    expect(typeof text).toBe("string");
    const parsed = JSON.parse(text!);
    return parsed.error;
  }

  try {
    await client.connect(transport);

    // Pre-register so the error comes from server-side, not from missing-peer guard.
    const registered = parseToolText(
      await client.callTool({ name: "bridge_register", arguments: { session_name: "structured-canary" } }),
    ) as { peer: { peer_id: string } };

    // 1. Server-side error preserves daemon `code`.
    const joinErr = parseError(
      await client.callTool({ name: "bridge_join_group", arguments: { name: "no-such-group" } }),
    );
    expect(joinErr.code).toBe("group_not_found");
    expect(joinErr.status).toBe(404);
    expect(joinErr.message).toMatch(/no-such-group/);

    // 2. Client-side validation error uses invalid_argument code.
    const dmErr = parseError(
      await client.callTool({ name: "bridge_dm", arguments: { message: "no recipient" } }),
    );
    expect(dmErr.code).toBe("invalid_argument");
    expect(dmErr.message).toMatch(/recipient_peer_id/);

    // 3. Mentions parsing + event_ids filter.
    await client.callTool({ name: "bridge_create_group", arguments: { name: "structured-room" } });
    await client.callTool({ name: "bridge_join_group", arguments: { name: "structured-room", alias: "canary" } });
    const sent = parseToolText(
      await client.callTool({ name: "bridge_send_group", arguments: { name: "structured-room", message: "ping @canary nobody" } }),
    ) as { event: { event_id: number; mentions: string[]; mentions_json?: unknown } };
    // Sender is excluded from mentions even though @canary matched the sender — verified server-side.
    expect(Array.isArray(sent.event.mentions)).toBe(true);
    expect(sent.event.mentions).toEqual([]);
    expect(sent.event).not.toHaveProperty("mentions_json");
    expect(sent.event.event_id).toBeGreaterThan(0);

    const fetched = parseToolText(
      await client.callTool({
        name: "bridge_group_history",
        arguments: { name: "structured-room", event_ids: [sent.event.event_id] },
      }),
    ) as { events: Array<{ event_id: number; mentions: string[] }> };
    expect(fetched.events.map((event) => event.event_id)).toEqual([sent.event.event_id]);
    expect(Array.isArray(fetched.events[0]?.mentions)).toBe(true);

    // 3b. Inline events on join/leave/rename/share also carry parsed mentions
    //     (caught in 2026-05-23 customer round — bob noticed bridge_join_group's
    //     inline event still had mentions_json, not mentions).
    const joined = parseToolText(
      await client.callTool({ name: "bridge_join_group", arguments: { name: "structured-room", alias: "canary" } }),
    ) as { event: { mentions?: string[]; mentions_json?: unknown } | null };
    // Idempotent re-join returns event=null, which is fine.
    if (joined.event) {
      expect(joined.event).not.toHaveProperty("mentions_json");
      expect(Array.isArray(joined.event.mentions)).toBe(true);
    }
    const left = parseToolText(
      await client.callTool({ name: "bridge_leave_group", arguments: { name: "structured-room" } }),
    ) as { event: { mentions?: string[]; mentions_json?: unknown } | null };
    if (left.event) {
      expect(left.event).not.toHaveProperty("mentions_json");
      expect(Array.isArray(left.event.mentions)).toBe(true);
    }

    // 4. event_ids + thread_of together → invalid_argument from the adapter.
    const conflictErr = parseError(
      await client.callTool({
        name: "bridge_group_history",
        arguments: { name: "structured-room", event_ids: [sent.event.event_id], thread_of: sent.event.event_id },
      }),
    );
    expect(conflictErr.code).toBe("invalid_argument");

    // Use `registered.peer.peer_id` to silence the unused-var lint.
    expect(registered.peer.peer_id).toMatch(/^[0-9a-f-]+$/);
  } finally {
    await client.close();
  }
});
