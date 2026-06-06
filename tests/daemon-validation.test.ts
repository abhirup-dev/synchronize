import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/daemon.ts";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

interface ErrorBody {
  error: { code: string; message: string };
}

async function daemon(): Promise<TestDaemon> {
  const started = await startTestDaemon();
  homes.push(started.home);
  return started;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function post(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, json(body));
}

async function expectError(
  response: Response,
  status: number,
  code: string,
  message: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.json() as ErrorBody).toEqual({ error: { code, message } });
}

test("body and scalar validation helpers preserve current HTTP behavior", async () => {
  const d = await daemon();
  try {
    await expectError(
      await fetch(`${d.baseUrl}/peers/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      400,
      "invalid_json",
      "Request body must be valid JSON",
    );
    for (const body of ["[]", "\"text\"", "null"]) {
      await expectError(
        await fetch(`${d.baseUrl}/peers/register`, { method: "POST", headers: { "content-type": "application/json" }, body }),
        400,
        "invalid_json",
        "Request body must be a JSON object",
      );
    }

    await expectError(await post(d.baseUrl, "/peers/register", { tool: "cli" }), 400, "invalid_request", "session_name is required");
    await expectError(await post(d.baseUrl, "/peers/register", { session_name: "   " }), 400, "invalid_request", "session_name is required");
    await expectError(await post(d.baseUrl, "/peers/register", { session_name: 7 }), 400, "invalid_request", "session_name is required");
    await expectError(await post(d.baseUrl, "/peers/register", { session_name: "alice", purpose: 1 }), 400, "invalid_request", "purpose must be a string");

    const trimmed = await post(d.baseUrl, "/peers/register", {
      peer_id: "peer:trimmed",
      session_name: "  Alice  ",
      tool: "  codex  ",
      purpose: "   ",
    });
    expect(trimmed.status).toBe(201);
    expect(await trimmed.json()).toMatchObject({
      peer: { peer_id: "peer:trimmed", session_name: "Alice", tool: "codex", purpose: null },
    });

    await expectError(
      await post(d.baseUrl, "/agent-sessions/register", { host_tool: "codex", host_session_id: "s1", pid: 1.5 }),
      400,
      "invalid_request",
      "pid must be an integer",
    );
    await expectError(
      await post(d.baseUrl, "/agent-sessions/register", { host_tool: "codex", host_session_id: "s1", pid: "12" }),
      400,
      "invalid_request",
      "pid must be an integer",
    );
    await expectError(
      await post(d.baseUrl, "/agent-sessions/register", { host_tool: "codex", host_session_id: "s1", metadata: [] }),
      400,
      "invalid_request",
      "metadata must be an object",
    );
    await expectError(
      await post(d.baseUrl, "/agent-sessions/register", { host_tool: "codex", host_session_id: "s1", metadata: "x" }),
      400,
      "invalid_request",
      "metadata must be an object",
    );
    const registered = await post(d.baseUrl, "/agent-sessions/register", {
      host_tool: "codex",
      host_session_id: "s1",
      pid: 42,
      metadata: { mode: "phase0" },
    });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ binding: { pid: 42, metadata_json: "{\"mode\":\"phase0\"}" } });

    await expectError(await post(d.baseUrl, "/reply", { sender_peer_id: "peer:trimmed", message: "x" }), 400, "invalid_request", "in_reply_to must be a positive integer");
    await expectError(await post(d.baseUrl, "/reply", { sender_peer_id: "peer:trimmed", in_reply_to: 0, message: "x" }), 400, "invalid_request", "in_reply_to must be a positive integer");
  } finally {
    await d.stop();
  }
});

test("collection, URL, path, selector, cursor, and form validation stay route-observable", async () => {
  const d = await daemon();
  try {
    await post(d.baseUrl, "/peers/register", { peer_id: "peer:alice", session_name: "alice", tool: "codex" });
    await post(d.baseUrl, "/peers/register", { peer_id: "peer:bob", session_name: "bob", tool: "codex" });
    await post(d.baseUrl, "/groups", { name: "phase0.validation", creator_peer_id: "peer:alice" });
    await post(d.baseUrl, "/groups/phase0.validation/join", { peer_id: "peer:alice", alias: "alice" });
    await post(d.baseUrl, "/groups/phase0.validation/join", { peer_id: "peer:bob", alias: "bob" });
    const rootResponse = await post(d.baseUrl, "/groups/phase0.validation/messages", { sender_peer_id: "peer:alice", message: "root" });
    const root = await rootResponse.json() as { event: { event_id: number } };

    await expectError(await post(d.baseUrl, "/peers/peer%3Abob/inbox/ack", { event_ids: [0] }), 400, "invalid_request", "event_ids must be an array of positive integers");
    await expectError(await post(d.baseUrl, "/peers/peer%3Abob/inbox/ack", { event_ids: [1.5] }), 400, "invalid_request", "event_ids must be an array of positive integers");
    expect((await post(d.baseUrl, "/peers/peer%3Abob/inbox/ack", { event_ids: [] })).status).toBe(200);

    await expectError(await post(d.baseUrl, "/query/events", { sql: "SELECT 1", params: [{}] }), 400, "invalid_request", "params must be an array of strings, numbers, booleans, or nulls");
    expect((await post(d.baseUrl, "/query/events", { sql: "SELECT ? AS value", params: ["x"], limit: 1 })).status).toBe(200);

    await expectError(await post(d.baseUrl, "/groups/phase0.validation/messages", { sender_peer_id: "peer:alice", message: "x", skill_directives: [""] }), 400, "invalid_request", "skill_directives must be an array of non-empty strings");
    const directed = await post(d.baseUrl, "/groups/phase0.validation/messages", { sender_peer_id: "peer:alice", message: "x", skill_directives: [" inspect ", "inspect"] });
    expect(await directed.json()).toMatchObject({ event: { skill_directives_json: "[\"inspect\"]" } });

    await expectError(await post(d.baseUrl, `/events/${root.event.event_id}/reactions`, { peer_id: "peer:alice", emoji: "ok", op: "replace" }), 400, "invalid_request", "op must be add, remove, or toggle");
    await expectError(await post(d.baseUrl, `/events/${root.event.event_id}/reactions`, { peer_id: "peer:alice", emoji: "bad\u0001value" }), 400, "invalid_emoji", "emoji must be a short emoji or emoji alias");
    expect((await post(d.baseUrl, `/events/${root.event.event_id}/reactions`, { peer_id: "peer:alice", emoji: "👍", op: "toggle" })).status).toBe(200);

    for (const callbackUrl of ["not a url", "https://localhost/callback", "http://example.com/callback"]) {
      await expectError(await post(d.baseUrl, "/subscriptions", { peer_id: "peer:bob", callback_url: callbackUrl, token: "t" }), 400, "invalid_callback_url", callbackUrl === "not a url" ? "callback_url must be a valid URL" : "callback_url must be an http localhost URL");
    }
    expect((await post(d.baseUrl, "/subscriptions", { peer_id: "peer:bob", callback_url: "http://127.0.0.1:9/callback", token: "t" })).status).toBe(201);

    await expectError(await post(d.baseUrl, "/groups", { name: "-bad" }), 400, "invalid_group_name", "Group name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens");
    await expectError(await post(d.baseUrl, "/groups/phase0.validation/paths", { path: "relative" }), 400, "invalid_group_path", "Group path must be an absolute path");
    const rootPath = await post(d.baseUrl, "/groups/phase0.validation/paths", { path: "///" });
    expect(await rootPath.json()).toMatchObject({ paths: expect.arrayContaining([expect.objectContaining({ path: "/" })]) });

    await expectError(await fetch(`${d.baseUrl}/peers/peer%3Abob/inbox?limit=0`), 400, "invalid_request", "limit must be a positive integer");
    await expectError(await fetch(`${d.baseUrl}/events/peer%3Abob?cursor=-1`), 400, "invalid_request", "cursor must be a non-negative integer");
    await expectError(await fetch(`${d.baseUrl}/threads/${root.event.event_id}?format=json`), 400, "invalid_request", "format=json was removed; use format=events");
    await expectError(await fetch(`${d.baseUrl}/threads/${root.event.event_id}?format=events&selector_strategy=first`), 400, "invalid_selectors", "selectors.k is required when strategy is first");
    await expectError(await fetch(`${d.baseUrl}/threads/${root.event.event_id}?format=events&selector_strategy=all&limit=1`), 400, "invalid_selectors", "selectors.k is not allowed when strategy is all");
    await expectError(await fetch(`${d.baseUrl}/groups/phase0.validation/history?peer_id=peer%3Aalice&view=events`), 400, "invalid_request", "event_ids is required when view=events");
    await expectError(await fetch(`${d.baseUrl}/groups/phase0.validation/history?peer_id=peer%3Aalice&event_ids=bogus`), 400, "invalid_request", "event_ids must contain positive integer event ids");
    expect((await fetch(`${d.baseUrl}/groups/phase0.validation/history?peer_id=peer%3Aalice&event_ids=${root.event.event_id}`)).status).toBe(200);

    const badForm = new FormData();
    badForm.set("id", new File(["x"], "id.txt"));
    badForm.set("file", new File(["x"], "clip.txt", { type: "text/plain" }));
    await expectError(await fetch(`${d.baseUrl}/web/attachments`, { method: "POST", body: badForm }), 400, "invalid_request", "id must be a string");

    const form = new FormData();
    form.set("id", "   ");
    form.set("file", new File(["x"], "clip.txt", { type: "text/plain" }));
    const attachment = await fetch(`${d.baseUrl}/web/attachments`, { method: "POST", body: form });
    expect(attachment.status).toBe(201);
    const staged = await attachment.json() as { attachment: { id: string; path: string } };
    expect(staged.attachment.id).not.toBe("");
    expect(staged.attachment.path.startsWith(join(d.home, "tmp", "web-attachments"))).toBe(true);
  } finally {
    await d.stop();
  }
});
