import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
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

async function fixture(name: string, response: Response): Promise<{ name: string; status: number; body: unknown }> {
  return { name, status: response.status, body: contractShape(await response.json()) };
}

function contractShape(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [contractShape(value[0], key)];
  if (value === null) return null;
  if (key === "git_dirty") return "boolean";
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (key === "code" || key === "message") return value;
    return "string";
  }
  if (typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, contractShape(childValue, childKey)]));
}

test("normalized HTTP contract fixtures capture route family response shapes", async () => {
  const d = await daemon();
  try {
    const fixtures: Array<{ name: string; status: number; body: unknown }> = [];
    fixtures.push(await fixture("health", await fetch(`${d.baseUrl}/health`)));

    const alice = await fetch(`${d.baseUrl}/peers/register`, json({ peer_id: "peer:alice", session_name: "alice", tool: "codex" }));
    fixtures.push(await fixture("peers.register", alice.clone()));
    await fetch(`${d.baseUrl}/peers/register`, json({ peer_id: "peer:bob", session_name: "bob", tool: "codex" }));
    fixtures.push(await fixture("peers.list", await fetch(`${d.baseUrl}/peers`)));
    fixtures.push(await fixture("peers.activity", await fetch(`${d.baseUrl}/peers/activity`, json({ peer_id: "peer:alice", state: "working" }))));

    fixtures.push(await fixture("agent-sessions.register", await fetch(`${d.baseUrl}/agent-sessions/register`, json({
      peer_id: "peer:agent",
      host_tool: "codex",
      host_session_id: "contract-session",
      session_name: "contract-agent",
      metadata: { fixture: true },
    }))));
    fixtures.push(await fixture("agent-sessions.lookup", await fetch(`${d.baseUrl}/agent-sessions/codex/contract-session`)));

    fixtures.push(await fixture("groups.create", await fetch(`${d.baseUrl}/groups`, json({ name: "phase0.contract", creator_peer_id: "peer:alice", description: "room" }))));
    await fetch(`${d.baseUrl}/groups/phase0.contract/join`, json({ peer_id: "peer:alice", alias: "alice" }));
    await fetch(`${d.baseUrl}/groups/phase0.contract/join`, json({ peer_id: "peer:bob", alias: "bob" }));
    fixtures.push(await fixture("groups.get", await fetch(`${d.baseUrl}/groups/phase0.contract`)));

    const message = await fetch(`${d.baseUrl}/groups/phase0.contract/messages`, json({ sender_peer_id: "peer:alice", message: "hello @bob" }));
    fixtures.push(await fixture("groups.messages", message.clone()));
    const messageBody = await message.json() as { event: { event_id: number } };
    await fetch(`${d.baseUrl}/groups/phase0.contract/messages`, json({ sender_peer_id: "peer:bob", message: "reply", in_reply_to: messageBody.event.event_id }));
    fixtures.push(await fixture("groups.history.events", await fetch(`${d.baseUrl}/groups/phase0.contract/history?peer_id=peer%3Aalice&event_ids=${messageBody.event.event_id}`)));
    fixtures.push(await fixture("events.lookup", await fetch(`${d.baseUrl}/events/${messageBody.event.event_id}?peer_id=peer%3Aalice`)));
    fixtures.push(await fixture("threads.status", await fetch(`${d.baseUrl}/threads/${messageBody.event.event_id}/status`)));
    fixtures.push(await fixture("inbox.read", await fetch(`${d.baseUrl}/peers/peer%3Abob/inbox`)));
    fixtures.push(await fixture("activity.feed", await fetch(`${d.baseUrl}/activity/peer%3Abob`)));
    fixtures.push(await fixture("query.events", await fetch(`${d.baseUrl}/query/events`, json({ sql: "SELECT event_id, type FROM events ORDER BY event_id", limit: 2 }))));
    fixtures.push(await fixture("web.session", await fetch(`${d.baseUrl}/web/session`, { method: "POST" })));
    fixtures.push(await fixture("web.state", await fetch(`${d.baseUrl}/web/state`)));
    fixtures.push(await fixture("unknown.not_found", await fetch(`${d.baseUrl}/phase0/unknown`)));

    expect(fixtures).toEqual([
      {
        name: "health",
        status: 200,
        body: {
          ok: true,
          service: "string",
          api_version: "number",
          capabilities: ["string"],
          pid: "number",
          started_at: "string",
          provenance: { api_version: "number", entrypoint_path: "string", git_dirty: "boolean", git_sha: "string", source_root: "string" },
        },
      },
      { name: "peers.register", status: 201, body: { peer: peerShape({ deleted_at: null, lifecycle_state: "string", archive_source: null, archived_at: null, archived_reason: null, auto_archive: null }) } },
      { name: "peers.list", status: 200, body: { peers: [peerShape({ deleted_at: null, online: true, presence: "string", lifecycle_state: "string", archive_source: null, archived_at: null, archived_reason: null, auto_archive: null })] } },
      { name: "peers.activity", status: 200, body: { peer: peerShape({ deleted_at: null, activity_state: "string", last_activity_at: "string", lifecycle_state: "string", archive_source: null, archived_at: null, archived_reason: null, auto_archive: null }) } },
      { name: "agent-sessions.register", status: 201, body: { binding: agentSessionShape() } },
      { name: "agent-sessions.lookup", status: 200, body: { binding: agentSessionShape() } },
      { name: "groups.create", status: 201, body: { group: groupShape() } },
      { name: "groups.get", status: 200, body: { group: groupShape(), members: [memberShape({ activity_state: "string" })], paths: [groupPathShape()] } },
      { name: "groups.messages", status: 201, body: { event: eventShape(), posted_to: postedToShape(), warnings: [], delivery: { pushed_to: ["string"], inbox_only: [] } } },
      { name: "groups.history.events", status: 200, body: { view: "string", events: [eventShape()], truncated: false } },
      { name: "events.lookup", status: 200, body: { event: eventShape() } },
      { name: "threads.status", status: 200, body: { status: threadStatusShape() } },
      { name: "inbox.read", status: 200, body: { events: [], next_cursor: "number" } },
      { name: "activity.feed", status: 200, body: { events: [eventShape({ acked_at: "string", awaiting: "number", reply_count: "number" })], peers: [peerShape({ activity_state: "string", last_activity_at: "string", online: true, presence: "string" })], next_cursor: "number", awaiting_count: "number" } },
      { name: "query.events", status: 200, body: { columns: ["string"], rows: [{ event_id: "number", type: "string" }], row_count: "number", truncated: true, elapsed_ms: "number" } },
      { name: "web.session", status: 200, body: { peer: peerShape({ deleted_at: null, purpose: "string", lifecycle_state: "string", archive_source: null, archived_at: null, archived_reason: null, auto_archive: null }) } },
      { name: "web.state", status: 200, body: webStateShape() },
      { name: "unknown.not_found", status: 404, body: { error: { code: "not_found", message: "GET /phase0/unknown is not implemented" } } },
    ]);
  } finally {
    await d.stop();
  }
});

function peerShape(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    peer_id: "string",
    tool: "string",
    session_name: "string",
    purpose: null,
    machine_id: "string",
    lease_expires_at: "string",
    activity_state: null,
    last_activity_at: null,
    last_cursor: "number",
    created_at: "string",
    updated_at: "string",
    ...extra,
  };
}

function agentSessionShape(): Record<string, unknown> {
  return {
    binding_id: "string",
    peer_id: "string",
    host_tool: "string",
    host_session_id: "string",
    host_session_file: null,
    cwd: null,
    git_branch: null,
    git_dirty: null,
    pid: null,
    source: null,
    model: null,
    agent_type: null,
    metadata_json: "string",
    launch_id: null,
    created_at: "string",
    updated_at: "string",
    last_seen_at: "string",
    peer: peerShape({ online: true, presence: "string", lifecycle_state: "string", archive_source: null, archived_at: null, archived_reason: null }),
  };
}

function groupShape(): Record<string, unknown> {
  return {
    group_id: "number",
    name: "string",
    durable: true,
    media_dir: "string",
    creator_peer_id: "string",
    description: "string",
    created_at: "string",
    auto_archive: "number",
  };
}

function memberShape(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    group_id: "number",
    peer_id: "string",
    alias: "string",
    join_event_id: "number",
    history_from_event_id: "number",
    active: true,
    purpose: null,
    joined_at: "string",
    left_at: null,
    member_state: "string",
    session_name: "string",
    tool: "string",
    host_session_id: null,
    activity_state: null,
    ...extra,
  };
}

function groupPathShape(): Record<string, unknown> {
  return { path_id: "number", group_id: "number", path: "string", label: null, active: true, created_at: "string" };
}

function eventShape(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: "number",
    type: "string",
    sender_peer_id: "string",
    recipient_peer_id: null,
    group_id: "number",
    group_name: "string",
    body: "string",
    media_id: null,
    parent_event_id: null,
    reply_to_event_id: null,
    mentions_json: "string",
    skill_directives_json: null,
    created_at: "string",
    reactions: [],
    ...extra,
  };
}

function postedToShape(): Record<string, unknown> {
  return {
    surface: "string",
    direct_event_id: null,
    direct_sender_peer_id: null,
    direct_sender: null,
    direct_preview: null,
    group_id: "number",
    group_name: "string",
  };
}

function threadStatusShape(): Record<string, unknown> {
  return {
    root_event_id: "number",
    group_id: "number",
    group_name: "string",
    root_sender_peer_id: "string",
    root_sender_session_name: "string",
    root_sender_alias: "string",
    created_at: "string",
    last_event_id: "number",
    last_activity_at: "string",
    reply_count: "number",
    event_count: "number",
    participant_count: "number",
    participants: [{
      peer_id: "string",
      session_name: "string",
      alias: "string",
      active: true,
      event_count: "number",
      first_event_id: "number",
      last_event_id: "number",
      last_activity_at: "string",
    }],
  };
}

function webStateShape(): Record<string, unknown> {
  return {
    ok: true,
    daemon: { pid: "number", base_url: "string", started_at: "string", token_required: false },
    generated_at: "string",
    agent_runtime_details: [agentRuntimeDetailsShape()],
    cursor: "number",
    peers: [peerShape({ online: true, presence: "string", purpose: "string", lifecycle_state: "string", archive_source: null, archived_at: null, archived_reason: null })],
    groups: [groupShape()],
    group_paths: [groupPathShape()],
    memberships: [memberShape({ activity_state: "string", online: true, presence: "string" })],
    room_summaries: [{ group_id: "number", last_event_id: "number", last_event_at: "string", last_preview: "string", message_count: "number" }],
    events: [],
    media: [],
    launch_tools: {
      claude: { tool: "string", available: true, path: "string" },
      pi: { tool: "string", available: true, path: "string" },
      letta: { tool: "string", available: true, path: "string" },
    },
    launch_lifecycle: [],
    skill_catalog: [{ id: "string", name: "string", description: "string", runtimes: ["string"], source_path: "string" }],
  };
}

function agentRuntimeDetailsShape(): Record<string, unknown> {
  return {
    peer_id: "string",
    session_name: "string",
    tool: "string",
    machine_id: "string",
    binding_id: null,
    host_tool: null,
    host_session_id: null,
    host_session_file: null,
    cwd: null,
    git_branch: null,
    git_dirty: null,
    pid: null,
    source: null,
    model: null,
    agent_type: null,
    launch_id: null,
    created_at: null,
    updated_at: null,
    last_seen_at: null,
    launch_state: null,
    backend_title: null,
    profile_name: null,
    target_group: null,
    failure_code: null,
    failure_message: null,
    thinking: null,
  };
}
