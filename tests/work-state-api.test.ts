import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { createGroup, joinGroup, sendGroupMessage } from "../src/api/groups.ts";
import { listPeerWorkStateHistory, registerPeer, setPeerWorkState } from "../src/api/peers.ts";
import { startTestDaemon, type TestDaemon } from "./helpers/daemon.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function startDaemon(): Promise<TestDaemon> {
  const home = await mkdtemp(join(tmpdir(), "sync-work-state-api-"));
  homes.push(home);
  return startTestDaemon({ home });
}

async function errorCode(daemon: TestDaemon, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${daemon.baseUrl}/peers/work-state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json() as { error?: { code?: string } };
  return json.error?.code ?? "no_error";
}

function historyCount(home: string, peerId: string): number {
  const db = new Database(join(home, "synchronize.db"), { readonly: true });
  try {
    return db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM peer_work_state_history WHERE peer_id = ?")
      .get(peerId)!.n;
  } finally {
    db.close();
  }
}

test("work-state set renews current state without duplicate history, then clear appends history", async () => {
  const daemon = await startDaemon();
  try {
    const { peer } = await registerPeer(daemon.client, { peerId: "worker", sessionName: "worker", tool: "claude" });
    const first = await setPeerWorkState(daemon.client, {
      peerId: peer.peer_id,
      phase: "implementation",
      summary: "Implement work-state endpoint",
      scope: { kind: "issue", value: "sync-08gl.2.2" },
      task: "sync-08gl.2.2",
      ttlMinutes: 1,
    });
    expect(first.ttl_minutes).toBe(1);
    expect(first.work_state).toMatchObject({
      phase: "implementation",
      summary: "Implement work-state endpoint",
      task: "sync-08gl.2.2",
      source: "api",
    });
    expect(first.peer.activity_state).toBe("working");
    expect(historyCount(daemon.home, peer.peer_id)).toBe(1);

    const renewed = await setPeerWorkState(daemon.client, {
      peerId: peer.peer_id,
      phase: "implementation",
      summary: "Implement work-state endpoint",
      scope: { kind: "issue", value: "sync-08gl.2.2" },
      task: "sync-08gl.2.2",
      ttlMinutes: 1,
    });
    expect(renewed.work_state?.phase).toBe("implementation");
    expect(historyCount(daemon.home, peer.peer_id)).toBe(1);

    const cleared = await setPeerWorkState(daemon.client, { peerId: peer.peer_id, clear: true });
    expect(cleared.work_state).toBeNull();
    expect(cleared.ttl_minutes).toBeNull();
    expect(historyCount(daemon.home, peer.peer_id)).toBe(2);
  } finally {
    await daemon.stop();
  }
});

test("work-state resolves host sessions and stores explicit event correlation", async () => {
  const daemon = await startDaemon();
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "native-session",
      sessionName: "planner",
      tool: "claude",
    });
    await createGroup(daemon.client, { name: "work-state-room", creatorPeerId: binding.peer_id });
    await joinGroup(daemon.client, { name: "work-state-room", peerId: binding.peer_id, alias: "planner" });
    const { event } = await sendGroupMessage(daemon.client, { name: "work-state-room", senderPeerId: binding.peer_id, message: "Planning next slice" });

    const response = await setPeerWorkState(daemon.client, {
      hostTool: "claude",
      hostSessionId: "native-session",
      phase: "planning",
      summary: "Plan history endpoint",
      triggerEventId: event.event_id,
      ttlMinutes: 999,
      source: "mcp",
    });
    expect(response.ttl_minutes).toBe(480);
    expect(response.work_state?.trigger_event_id).toBe(event.event_id);
    expect(response.work_state?.source).toBe("mcp");

    const db = new Database(join(daemon.home, "synchronize.db"), { readonly: true });
    try {
      const row = db
        .query<{ trigger_event_id: number | null; correlation_method: string; source: string }, [string]>(
          `SELECT trigger_event_id, correlation_method, source
           FROM peer_work_state_history
           WHERE peer_id = ?`,
        )
        .get(binding.peer_id)!;
      expect(row).toEqual({ trigger_event_id: event.event_id, correlation_method: "explicit", source: "mcp" });
    } finally {
      db.close();
    }
  } finally {
    await daemon.stop();
  }
});

test("work-state history filters by phase, task, scope, time, and correlation", async () => {
  const daemon = await startDaemon();
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "history-session",
      sessionName: "historian",
      tool: "claude",
    });
    await createGroup(daemon.client, { name: "work-history-room", creatorPeerId: binding.peer_id });
    await joinGroup(daemon.client, { name: "work-history-room", peerId: binding.peer_id, alias: "historian" });
    const { event } = await sendGroupMessage(daemon.client, { name: "work-history-room", senderPeerId: binding.peer_id, message: "History anchor" });

    await setPeerWorkState(daemon.client, {
      peerId: binding.peer_id,
      phase: "planning",
      summary: "Plan history filters",
      scope: { kind: "issue", value: "sync-08gl.2.3" },
      task: "sync-08gl.2.3 history endpoint",
      triggerEventId: event.event_id,
    });
    await setPeerWorkState(daemon.client, {
      peerId: binding.peer_id,
      phase: "implementation",
      summary: "Implement inferred history",
      scope: { kind: "custom", value: "history-followup" },
      task: "generic history followup",
    });

    const db = new Database(join(daemon.home, "synchronize.db"));
    try {
      db.query("UPDATE events SET created_at = '2026-06-27T00:04:00.000Z' WHERE event_id = ?").run(event.event_id);
      db.query(
        `UPDATE peer_work_state_history
         SET updated_at = '2026-06-27T00:00:00.000Z'
         WHERE peer_id = ? AND phase = 'planning'`,
      ).run(binding.peer_id);
      db.query(
        `UPDATE peer_work_state_history
         SET updated_at = '2026-06-27T00:05:00.000Z'
         WHERE peer_id = ? AND phase = 'implementation'`,
      ).run(binding.peer_id);
    } finally {
      db.close();
    }

    const all = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id });
    expect(all.history.map((entry) => entry.phase)).toEqual(["implementation", "planning"]);

    const planning = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id, phase: "planning" });
    expect(planning.history).toHaveLength(1);
    expect(planning.history[0]).toMatchObject({
      phase: "planning",
      task: "sync-08gl.2.3 history endpoint",
      trigger_event_id: event.event_id,
      correlation_method: "explicit",
    });

    const task = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id, taskContains: "followup" });
    expect(task.history.map((entry) => entry.phase)).toEqual(["implementation"]);

    const scope = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id, scopeKind: "issue", scopeValue: "sync-08gl.2.3" });
    expect(scope.history.map((entry) => entry.phase)).toEqual(["planning"]);

    const from = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id, from: "2026-06-27T00:03:00.000Z" });
    expect(from.history.map((entry) => entry.phase)).toEqual(["implementation"]);

    const byEvent = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id, eventId: event.event_id });
    expect(byEvent.history.map((entry) => entry.correlation_method).sort()).toEqual(["explicit", "timestamp_inferred"]);

    const inferred = await listPeerWorkStateHistory(daemon.client, { peerId: binding.peer_id, correlation: "timestamp_inferred" });
    expect(inferred.history).toHaveLength(1);
    expect(inferred.history[0]?.inferred_event_id).toBe(event.event_id);
  } finally {
    await daemon.stop();
  }
});

test("work-state endpoint rejects invalid phase, ttl, trigger event, and archived set", async () => {
  const daemon = await startDaemon();
  try {
    const { peer } = await registerPeer(daemon.client, { peerId: "invalid-worker", sessionName: "invalid-worker", tool: "claude" });
    expect(await errorCode(daemon, { peer_id: peer.peer_id, phase: "coding", summary: "bad" })).toBe("invalid_work_phase");
    expect(await errorCode(daemon, { peer_id: peer.peer_id, phase: "testing", summary: "bad", ttl_minutes: 0 })).toBe("invalid_ttl_minutes");
    expect(await errorCode(daemon, { peer_id: peer.peer_id, phase: "testing", summary: "bad", trigger_event_id: 999_999 })).toBe("event_not_found");

    const db = new Database(join(daemon.home, "synchronize.db"));
    db.query("UPDATE peers SET lifecycle_state = 'archived' WHERE peer_id = ?").run(peer.peer_id);
    db.close();
    expect(await errorCode(daemon, { peer_id: peer.peer_id, phase: "testing", summary: "bad" })).toBe("peer_archived");
  } finally {
    await daemon.stop();
  }
});

test("web agent projection is shared by /web/state and /web/agents", async () => {
  const daemon = await startDaemon();
  try {
    const { peer } = await registerPeer(daemon.client, { peerId: "web-agent-worker", sessionName: "web-agent-worker", tool: "claude" });
    await setPeerWorkState(daemon.client, {
      peerId: peer.peer_id,
      phase: "review",
      summary: "Review web projection",
      task: "sync-08gl.4.1",
      ttlMinutes: 30,
    });

    const state = await (await fetch(`${daemon.baseUrl}/web/state?limit=1`)).json() as {
      agents: Array<{ peer_id: string; work_state?: { phase: string; task?: string }; work_state_status?: { state: string } }>;
    };
    const agents = await (await fetch(`${daemon.baseUrl}/web/agents`)).json() as {
      agents: Array<{ peer_id: string; work_state?: { phase: string; task?: string }; work_state_status?: { state: string } }>;
    };
    const detail = await (await fetch(`${daemon.baseUrl}/web/agents/${peer.peer_id}`)).json() as {
      agents: Array<{ peer_id: string; work_state?: { phase: string; task?: string }; work_state_status?: { state: string } }>;
    };

    const fromState = state.agents.find((agent) => agent.peer_id === peer.peer_id);
    const fromList = agents.agents.find((agent) => agent.peer_id === peer.peer_id);
    expect(fromState).toBeDefined();
    expect(fromState).toEqual(fromList);
    expect(detail.agents).toEqual([fromState!]);
    expect(fromState?.work_state).toMatchObject({ phase: "review", task: "sync-08gl.4.1" });
    expect(fromState?.work_state_status?.state).toBe("active");
  } finally {
    await daemon.stop();
  }
});
