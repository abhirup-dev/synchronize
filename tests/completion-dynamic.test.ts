import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeDynamicProvider } from "../src/cli/completion/dynamic.ts";
import { API_VERSION } from "../src/constants.ts";
import { writeJson } from "../src/fs.ts";
import { run as runCompletion } from "../src/cli/commands/completion.ts";

const tempHomes: string[] = [];
const servers: Bun.Server<unknown>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(tempHomes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("dynamic completion providers", () => {
  test("returns an empty list without daemon discovery", async () => {
    const home = await tempHome();
    await expect(completeDynamicProvider("group-names", { env: { SYNCHRONIZE_HOME: home } })).resolves.toEqual([]);
  });

  test("returns an empty list when discovery points at an unhealthy daemon", async () => {
    const home = await tempHome();
    await writeJson(join(home, "daemon.json"), { baseUrl: "http://127.0.0.1:9" });
    await expect(completeDynamicProvider("peer-ids", { env: { SYNCHRONIZE_HOME: home } })).resolves.toEqual([]);
  });

  test("maps healthy daemon responses into stable candidates", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
          return Response.json({ service: "synchronize", api_version: API_VERSION });
        }
        if (url.pathname === "/groups") {
          return Response.json({ groups: [{ name: "general", description: "main room" }] });
        }
        if (url.pathname === "/peers" && url.searchParams.get("group") === "general") {
          return Response.json({
            peers: [
              {
                peer_id: "peer-1",
                session_name: "alice",
                tool: "claude",
                alias: "ali",
                active: true,
                purpose: "planner",
                joined_at: "2026-06-22T09:00:00.000Z",
                left_at: null,
                online: true,
                presence: "working",
              },
              {
                peer_id: "peer-3",
                session_name: "bob",
                tool: "pi",
                alias: "builder",
                active: true,
                purpose: "builder",
                joined_at: "2026-06-22T09:05:00.000Z",
                left_at: null,
                online: false,
                presence: "offline",
              },
            ],
          });
        }
        if (url.pathname === "/peers") {
          return Response.json({
            peers: [
              { peer_id: "peer-1", session_name: "alice", tool: "claude", purpose: "planner", online: true, presence: "working", machine_id: "MTPL-1" },
              { peer_id: "peer-2", session_name: "alice", tool: "claude", purpose: "reviewer", online: true, presence: "online", machine_id: "MTPL-1" },
              { peer_id: "peer-3", session_name: "bob", tool: "pi", purpose: "builder", online: false, presence: "offline", machine_id: "MTPL-2" },
            ],
          });
        }
        if (url.pathname === "/agent-sessions") {
          return Response.json({
            bindings: [
              agentSessionBinding("session-1", "peer-1", "claude", "alice", "working", "claude-sonnet"),
              agentSessionBinding("session-2", "peer-3", "pi", "bob", "offline", "gpt-5.5"),
            ],
          });
        }
        if (url.pathname === "/threads") {
          return Response.json({
            threads: [{
              root_event_id: 42,
              group_name: "general",
              root_sender_peer_id: "peer-1",
              root_sender_session_name: "alice",
              root_sender_alias: "ali",
              created_at: "2026-06-22T09:10:00.000Z",
              last_activity_at: "2026-06-22T09:15:00.000Z",
              reply_count: 3,
              participant_count: 2,
              preview: "hello",
            }],
          });
        }
        if (url.pathname === "/query/events") {
          return Response.json({ columns: ["media_id", "original_path", "description"], rows: [{ media_id: "media-1", original_path: "/tmp/a.png", description: "screenshot" }] });
        }
        if (url.pathname === "/groups/general/media") {
          return Response.json({ media: [{ media_id: "media-1", original_path: "/tmp/a.png", description: "screenshot" }] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const home = await tempHome();
    await writeJson(join(home, "daemon.json"), { baseUrl: `http://127.0.0.1:${server.port}` });

    const env = { SYNCHRONIZE_HOME: home };
    await expect(completeDynamicProvider("group-names", { env })).resolves.toEqual([{ value: "general", description: "main room" }]);
    await expect(completeDynamicProvider("peer-ids", { env })).resolves.toEqual([
      { value: "peer-1", description: "claude | alice | ali@general | working | planner | machine MTPL-1" },
      { value: "peer-2", description: "claude | alice | online | reviewer | machine MTPL-1" },
      { value: "peer-3", description: "pi | bob | builder@general | offline | builder | machine MTPL-2" },
    ]);
    await expect(completeDynamicProvider("session-ids", { env })).resolves.toEqual([
      { value: "session-1", description: "claude | alice | ali@general | working | claude-sonnet | seen 2026-06-22 10:20:30Z" },
      { value: "session-2", description: "pi | bob | builder@general | offline | gpt-5.5 | seen 2026-06-22 10:20:30Z" },
    ]);
    await expect(completeDynamicProvider("session-names", { env })).resolves.toEqual([
      { value: "alice", description: "claude | ali@general | working | planner | machine MTPL-1" },
      { value: "bob", description: "pi | builder@general | offline | builder | machine MTPL-2" },
    ]);
    await expect(completeDynamicProvider("thread-root-event-ids", { env })).resolves.toEqual([
      { value: "42", description: "general | ali | 3 replies | active 2026-06-22 09:15:00Z" },
    ]);
    await expect(completeDynamicProvider("media-ids", { env })).resolves.toEqual([
      { value: "media-1", description: "screenshot" },
    ]);
    await expect(completeDynamicProvider("media-ids", { env, context: { group: "general" } })).resolves.toEqual([
      { value: "media-1", description: "screenshot" },
    ]);
  });

  test("completion bridge can render Tab candidate lines", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/health") return Response.json({ service: "synchronize", api_version: API_VERSION });
        if (url.pathname === "/groups") return Response.json({ groups: [{ name: "general", description: "main room" }] });
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const home = await tempHome();
    await writeJson(join(home, "daemon.json"), { baseUrl: `http://127.0.0.1:${server.port}` });
    const originalEnv = process.env.SYNCHRONIZE_HOME;
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.env.SYNCHRONIZE_HOME = home;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runCompletion(["complete", "group-names", "--format", "tab"]);
    } finally {
      process.stdout.write = originalWrite;
      if (originalEnv === undefined) delete process.env.SYNCHRONIZE_HOME;
      else process.env.SYNCHRONIZE_HOME = originalEnv;
    }
    expect(writes.join("")).toBe("general\tmain room\n:4\n");
  });
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-completion-"));
  tempHomes.push(home);
  return home;
}

function agentSessionBinding(
  hostSessionId: string,
  peerId: string,
  hostTool: string,
  sessionName: string,
  presence: "offline" | "online" | "working" | "idle" | "initializing",
  model: string,
) {
  return {
    binding_id: `binding-${hostSessionId}`,
    peer_id: peerId,
    host_tool: hostTool,
    host_session_id: hostSessionId,
    host_session_file: null,
    cwd: "/repo",
    git_branch: null,
    git_dirty: null,
    pid: 123,
    source: "session_start",
    model,
    agent_type: `${hostTool}-session`,
    metadata_json: null,
    launch_id: null,
    created_at: "2026-06-22T10:00:00.000Z",
    updated_at: "2026-06-22T10:20:30.000Z",
    last_seen_at: "2026-06-22T10:20:30.000Z",
    peer: {
      peer_id: peerId,
      tool: hostTool,
      session_name: sessionName,
      purpose: null,
      machine_id: "MTPL-1",
      lease_expires_at: "2026-06-22T10:21:30.000Z",
      online: presence !== "offline",
      presence,
    },
  };
}
