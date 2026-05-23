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
        "bridge_inbox",
        "bridge_create_group",
        "bridge_join_group",
        "bridge_leave_group",
        "bridge_send_group",
        "bridge_group_history",
        "bridge_list_groups",
        "bridge_share_media",
        "bridge_list_media",
        "bridge_get_media",
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
    await client.callTool({ name: "bridge_send_group", arguments: { name: "mcp-room", message: "hello room" } });
    const history = parseToolText(
      await client.callTool({ name: "bridge_group_history", arguments: { name: "mcp-room" } }),
    ) as { events: Array<{ body: string | null }> };
    expect(history.events.some((event) => event.body === "hello room")).toBe(true);
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
