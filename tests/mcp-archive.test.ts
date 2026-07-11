import { afterAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "../src/client.ts";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { createGroup, joinGroup } from "../src/api/groups.ts";

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

function parseToolText(result: unknown): any {
  const typed = result as { content?: Array<{ type: string; text?: string }> };
  const text = typed.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("tool result had no text content");
  return JSON.parse(text);
}

async function restClientFor(home: string): Promise<ClientConfig> {
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const { baseUrl } = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
      const health = await fetch(`${baseUrl}/health`).catch(() => null);
      if (health?.ok) return { baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false };
    } catch {
      // not written yet
    }
    await Bun.sleep(50);
  }
  throw new Error("daemon discovery not available");
}

test("a non-member managing agent archives + resumes a group via MCP admin tools", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-archive-"));
  homes.push(home);
  const cwd = await mkdtemp(join(tmpdir(), "mcp-archive-cwd-"));
  homes.push(cwd);

  const client = new Client({ name: "managing-agent", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", "src/mcp.ts"],
    cwd: process.cwd(),
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", SYNCHRONIZE_MCP_MODE: "codex", SYNCHRONIZE_DEBUG: "1" },
    stderr: "inherit",
  });

  try {
    await client.connect(transport);

    // The admin tools are registered and discoverable.
    const toolNames = (await client.listTools()).tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "bridge_archive_session",
        "bridge_archive_group",
        "bridge_resume_session",
        "bridge_resume_group",
        "bridge_list_archived",
      ]),
    );

    // First tool call forces the daemon up; then reach it over REST to seed a
    // target group the managing agent is NOT a member of.
    const empty = parseToolText(await client.callTool({ name: "bridge_list_archived", arguments: {} }));
    expect(empty.sessions).toEqual([]);

    const rest = await restClientFor(home);
    const { binding } = await registerAgentSession(rest, {
      hostTool: "claude", tool: "claude", sessionName: "critic", hostSessionId: "mcp-hs-1", cwd,
    });
    await createGroup(rest, { name: "managed", creatorPeerId: binding.peer_id });
    await joinGroup(rest, { name: "managed", peerId: binding.peer_id, alias: "critic" });

    // Managing agent (not a member) archives the whole group.
    const archived = parseToolText(await client.callTool({ name: "bridge_archive_group", arguments: { group: "managed", reason: "checkpoint" } }));
    expect(archived.members).toHaveLength(1);
    expect(archived.members[0].action).toBe("archived");

    // It now appears in the archived list with its reserved seat.
    const list = parseToolText(await client.callTool({ name: "bridge_list_archived", arguments: {} }));
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0].aliases).toEqual([{ group: "managed", alias: "critic" }]);

    // Managing agent resumes the group (print mode → no real spawn needed).
    const resumed = parseToolText(await client.callTool({ name: "bridge_resume_group", arguments: { group: "managed", mode: "print" } }));
    expect(resumed.members).toHaveLength(1);
    expect(resumed.members[0].action).toBe("printed");
  } finally {
    await client.close();
  }
});
