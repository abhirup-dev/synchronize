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
        if (url.pathname === "/peers") {
          return Response.json({
            peers: [
              { peer_id: "peer-1", session_name: "alice" },
              { peer_id: "peer-2", session_name: "alice" },
              { peer_id: "peer-3", session_name: "bob" },
            ],
          });
        }
        if (url.pathname === "/threads") {
          return Response.json({ threads: [{ root_event_id: 42, group_name: "general" }] });
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
      { value: "peer-1", description: "alice" },
      { value: "peer-2", description: "alice" },
      { value: "peer-3", description: "bob" },
    ]);
    await expect(completeDynamicProvider("session-names", { env })).resolves.toEqual([
      { value: "alice", description: "peer-1" },
      { value: "bob", description: "peer-3" },
    ]);
    await expect(completeDynamicProvider("thread-root-event-ids", { env })).resolves.toEqual([{ value: "42", description: "general" }]);
    await expect(completeDynamicProvider("media-ids", { env })).resolves.toEqual([
      { value: "media-1", description: "screenshot" },
    ]);
    await expect(completeDynamicProvider("media-ids", { env, context: { group: "general" } })).resolves.toEqual([
      { value: "media-1", description: "screenshot" },
    ]);
  });

  test("completion bridge can render Carapace candidate lines", async () => {
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
      await runCompletion(["complete", "group-names", "--format", "carapace"]);
    } finally {
      process.stdout.write = originalWrite;
      if (originalEnv === undefined) delete process.env.SYNCHRONIZE_HOME;
      else process.env.SYNCHRONIZE_HOME = originalEnv;
    }
    expect(writes.join("")).toBe("general\tmain room\n");
  });
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-completion-"));
  tempHomes.push(home);
  return home;
}
