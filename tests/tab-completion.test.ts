import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { API_VERSION } from "../src/constants.ts";
import { writeJson } from "../src/fs.ts";
import { renderTabCompletions, renderTabSetupScript } from "../src/cli/completion/render-tab.ts";

const tempHomes: string[] = [];
const servers: Bun.Server<unknown>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(tempHomes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Tab completion renderer", () => {
  test("renders a zsh setup script that calls the synchronize completion protocol", () => {
    const script = renderTabSetupScript("zsh");
    expect(script).toContain("#compdef synchronize");
    expect(script).toContain("synchronize completion tab complete --");
  });

  test("completes commands, subcommands, flags, and enum values from the CLI schema", async () => {
    await expect(renderTabCompletions(["res"])).resolves.toContain("resume\tResume archived sessions or groups\n");
    await expect(renderTabCompletions(["resume", "l"])).resolves.toContain("launch\tResume one archived session in this terminal\n");
    await expect(renderTabCompletions(["resume", "s"])).resolves.toContain("spawn\tResume one archived session inside AOE\n");
    await expect(renderTabCompletions(["resume", "launch", "--peer"])).resolves.toContain("--peer-id\tPeer id to resume\n");
    await expect(renderTabCompletions(["threads", "summary", "--format", ""])).resolves.toContain("json\n");
  });

  test("completes an exact non-boolean flag as a value request", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/health") return Response.json({ service: "synchronize", api_version: API_VERSION });
        if (url.pathname === "/agent-sessions") {
          return Response.json({ bindings: [{ ...agentSessionBinding(), host_session_id: "session-1" }] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const home = await tempHome();
    await writeJson(join(home, "daemon.json"), { baseUrl: `http://127.0.0.1:${server.port}` });
    const originalHome = process.env.SYNCHRONIZE_HOME;
    process.env.SYNCHRONIZE_HOME = home;
    const output = await renderTabCompletions(["resume", "launch", "--session-id"]);
    if (originalHome === undefined) delete process.env.SYNCHRONIZE_HOME;
    else process.env.SYNCHRONIZE_HOME = originalHome;
    expect(output).not.toContain("--session-id\tHost session id to resume");
    expect(output).toContain("--session-id=session-1\tclaude | atlas | working | claude-sonnet | main | seen 2026-06-22 10:20:30Z");
    expect(output.endsWith(":4\n")).toBe(true);
  });

  test("completes a value after Tab zsh passes duplicate trailing empty args", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/health") return Response.json({ service: "synchronize", api_version: API_VERSION });
        if (url.pathname === "/agent-sessions") {
          return Response.json({ bindings: [{ ...agentSessionBinding(), host_session_id: "session-1" }] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const home = await tempHome();
    await writeJson(join(home, "daemon.json"), { baseUrl: `http://127.0.0.1:${server.port}` });
    const originalHome = process.env.SYNCHRONIZE_HOME;
    process.env.SYNCHRONIZE_HOME = home;
    const output = await renderTabCompletions(["resume", "launch", "--session-id", "", ""]);
    if (originalHome === undefined) delete process.env.SYNCHRONIZE_HOME;
    else process.env.SYNCHRONIZE_HOME = originalHome;
    expect(output).toContain("session-1\tclaude | atlas | working | claude-sonnet | main | seen 2026-06-22 10:20:30Z");
    expect(output.endsWith(":4\n")).toBe(true);
  });

  test("returns shell directives for file and directory completion", async () => {
    await expect(renderTabCompletions(["media", "share", "general", ""])).resolves.toBe(":0\n");
    await expect(renderTabCompletions(["spawn", "--repo", ""])).resolves.toBe(":16\n");
  });

  test("does not complete files for pure schema completions", async () => {
    const output = await renderTabCompletions(["resume", "launch", "--"]);
    expect(output.endsWith(":4\n")).toBe(true);
  });
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-tab-completion-"));
  tempHomes.push(home);
  return home;
}

function agentSessionBinding() {
  return {
    binding_id: "binding-1",
    peer_id: "peer-1",
    host_tool: "claude",
    host_session_id: "session-1",
    host_session_file: null,
    cwd: "/repo",
    git_branch: "main",
    git_dirty: false,
    pid: 123,
    source: "session_start",
    model: "claude-sonnet",
    agent_type: "claude-session",
    metadata_json: null,
    launch_id: null,
    created_at: "2026-06-22T10:00:00.000Z",
    updated_at: "2026-06-22T10:20:30.000Z",
    last_seen_at: "2026-06-22T10:20:30.000Z",
    peer: {
      peer_id: "peer-1",
      tool: "claude",
      session_name: "atlas",
      purpose: "Testing/observer",
      machine_id: "MTPL-7638",
      lease_expires_at: "2026-06-22T10:21:30.000Z",
      online: true,
      presence: "working",
    },
  };
}
