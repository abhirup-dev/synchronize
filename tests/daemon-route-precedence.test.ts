import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/daemon.ts";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function daemon(): Promise<TestDaemon> {
  const started = await startTestDaemon();
  homes.push(started.home);
  return started;
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function post(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, json(body));
}

test("current overlapping daemon routes keep exact routes ahead of parameterized fallbacks", async () => {
  const d = await daemon();
  const mediaSourceDir = await mkdtemp(join(tmpdir(), "synchronize-phase0-media-"));
  homes.push(mediaSourceDir);
  const mediaSource = join(mediaSourceDir, "note.txt");
  await writeFile(mediaSource, "phase0 media", "utf8");

  try {
    const alice = await post(d.baseUrl, "/peers/register", { peer_id: "peer:alice", session_name: "alice", tool: "codex" });
    const bob = await post(d.baseUrl, "/peers/register", { peer_id: "peer:bob", session_name: "bob", tool: "codex" });
    expect(alice.status).toBe(201);
    expect(await bob.json()).toMatchObject({ peer: { peer_id: "peer:bob" } });

    const binding = await post(d.baseUrl, "/agent-sessions/register", {
      peer_id: "peer:agent",
      host_tool: "codex",
      host_session_id: "native-1",
      session_name: "agent",
    });
    expect(binding.status).toBe(201);
    expect(await fetch(`${d.baseUrl}/agent-sessions/codex/native-1`).then((res) => res.json())).toMatchObject({
      binding: { host_tool: "codex", host_session_id: "native-1", peer_id: "peer:agent" },
    });
    expect((await post(d.baseUrl, "/agent-sessions/rename", { peer_id: "peer:agent", session_name: "renamed" })).status).toBe(200);
    await expectError(await post(d.baseUrl, "/agent-sessions/launch", {}), 400, "invalid_launch");
    await expectError(await post(d.baseUrl, "/agent-sessions/stop", {}), 400, "invalid_stop");

    expect((await fetch(`${d.baseUrl}/peers/peer%3Abob/heartbeat`, { method: "PATCH" })).status).toBe(200);
    await expectError(await fetch(`${d.baseUrl}/peers/peer%3Abob/heartbeat`), 404, "not_found");

    expect((await post(d.baseUrl, "/groups", { name: "phase0.routes", creator_peer_id: "peer:alice" })).status).toBe(201);
    expect((await fetch(`${d.baseUrl}/groups`)).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/groups/phase0.routes`)).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/groups/phase0.routes`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "patched" }) })).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/groups/phase0.routes/paths`)).status).toBe(200);
    expect((await post(d.baseUrl, "/groups/phase0.routes/paths", { path: "/" })).status).toBe(201);
    expect((await post(d.baseUrl, "/groups/phase0.routes/join", { peer_id: "peer:alice", alias: "alice" })).status).toBe(200);
    expect((await post(d.baseUrl, "/groups/phase0.routes/join", { peer_id: "peer:bob", alias: "bob" })).status).toBe(200);
    expect((await post(d.baseUrl, "/groups/phase0.routes/rename", { peer_id: "peer:bob", new_alias: "robert" })).status).toBe(200);

    const rootResponse = await post(d.baseUrl, "/groups/phase0.routes/messages", { sender_peer_id: "peer:alice", message: "root" });
    expect(rootResponse.status).toBe(201);
    const root = await rootResponse.json() as { event: { event_id: number } };
    expect((await post(d.baseUrl, "/groups/phase0.routes/messages", { sender_peer_id: "peer:bob", message: "reply", in_reply_to: root.event.event_id })).status).toBe(201);
    expect((await fetch(`${d.baseUrl}/groups/phase0.routes/history?peer_id=peer%3Aalice`)).status).toBe(200);

    const mediaResponse = await post(d.baseUrl, "/groups/phase0.routes/media", { shared_by_peer_id: "peer:alice", path: mediaSource });
    expect(mediaResponse.status).toBe(201);
    const media = await mediaResponse.json() as { media: { media_id: string } };
    expect((await fetch(`${d.baseUrl}/groups/phase0.routes/media`)).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/media/${media.media.media_id}`)).status).toBe(200);

    expect((await fetch(`${d.baseUrl}/events/${root.event.event_id}?peer_id=peer%3Aalice`)).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/events/${root.event.event_id}/reactions?peer_id=peer%3Aalice`)).status).toBe(200);
    expect((await post(d.baseUrl, `/events/${root.event.event_id}/reactions`, { peer_id: "peer:alice", emoji: "👍" })).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/events/peer%3Abob?cursor=0`)).status).toBe(200);

    expect((await fetch(`${d.baseUrl}/threads/${root.event.event_id}/status`)).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/threads/${root.event.event_id}/summary`)).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/threads/${root.event.event_id}?format=events&selector_strategy=all`)).status).toBe(200);

    expect((await fetch(`${d.baseUrl}/peers/peer%3Abob/inbox`)).status).toBe(200);
    await expectError(await fetch(`${d.baseUrl}/peers/peer%3Abob/inbox/ack`), 404, "not_found");
    expect((await post(d.baseUrl, "/peers/peer%3Abob/inbox/ack", {})).status).toBe(200);

    expect((await fetch(`${d.baseUrl}/web/state`)).headers.get("content-type")).toContain("application/json");
    const events = await fetch(`${d.baseUrl}/web/events`);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    await events.body?.cancel();
    expect((await post(d.baseUrl, "/web/session", {})).status).toBe(200);
    const form = new FormData();
    form.set("id", "route-precedence");
    form.set("file", new File(["x"], "route.txt", { type: "text/plain" }));
    const attachment = await fetch(`${d.baseUrl}/web/attachments`, { method: "POST", body: form });
    expect(attachment.status).toBe(201);
    const staged = await attachment.json() as { attachment: { path: string } };
    expect((await fetch(`${d.baseUrl}/web/attachments`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: staged.attachment.path }) })).status).toBe(200);

    expect((await post(d.baseUrl, "/groups/phase0.routes/leave", { peer_id: "peer:bob" })).status).toBe(200);
    expect((await fetch(`${d.baseUrl}/peers/peer%3Abob`, { method: "DELETE" })).status).toBe(200);
  } finally {
    await d.stop();
  }
});

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
