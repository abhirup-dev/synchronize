import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectAudit } from "../lib/project-audit.mjs";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("project audit scopes observations and bounds graph reads", async () => {
  const calls = [];
  const sessions = [
    {
      id: "project-session",
      project: "demo",
      cwd: "/repo",
      status: "completed",
      observationCount: 1,
      summary: { title: "summary", observationCount: 1 },
    },
    {
      id: "other-session",
      project: "other",
      cwd: "/other",
      status: "completed",
      observationCount: 5,
    },
  ];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, search: parsed.search, init });
    if (parsed.pathname === "/agentmemory/health") {
      return jsonResponse({
        version: "test",
        health: { status: "healthy", connectionState: "connected" },
        circuitBreaker: { state: "closed" },
      });
    }
    if (parsed.pathname === "/agentmemory/config/flags") {
      return jsonResponse({
        embeddingProvider: "openai",
        flags: [{ key: "GRAPH_EXTRACTION_ENABLED", enabled: true }],
      });
    }
    if (parsed.pathname === "/agentmemory/diagnostics") {
      return jsonResponse({ summary: { pass: 1, warn: 0, fail: 0 } });
    }
    if (parsed.pathname === "/agentmemory/semantic") {
      return jsonResponse({ semantic: [] });
    }
    if (parsed.pathname === "/agentmemory/graph/stats") {
      return jsonResponse({ totalNodes: 10_000, totalEdges: 20_000 });
    }
    if (parsed.pathname === "/agentmemory/graph/query") {
      assert.deepEqual(JSON.parse(init.body), { limit: 7, offset: 0 });
      return jsonResponse({
        nodes: [],
        edges: [],
        totalNodes: 10_000,
        totalEdges: 20_000,
        truncated: true,
      });
    }
    if (parsed.pathname === "/agentmemory/branch/worktrees") {
      assert.equal(parsed.searchParams.get("cwd"), "/repo");
      return jsonResponse({ worktrees: [{ path: "/repo" }] });
    }
    if (parsed.pathname === "/agentmemory/observations") {
      assert.equal(parsed.searchParams.get("sessionId"), "project-session");
      return jsonResponse({
        observations: [
          { id: "obs-1", title: "Captured", narrative: "Stored" },
        ],
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const manifest = {
    repository: {
      primaryRoot: "/repo",
      worktrees: [{ path: "/repo" }],
    },
    stats: {
      total: 1,
      byAgent: { claude: 1 },
      byIngestionStatus: { present: 1 },
      selected: 1,
    },
    sessions: [
      {
        sessionId: "project-session",
        agent: "claude",
        worktree: { path: "/repo", kind: "primary" },
      },
    ],
  };

  const audit = await buildProjectAudit(
    {
      agentmemoryUrl: "http://agentmemory.test",
      project: "demo",
      graphSampleLimit: 7,
      candidateManifest: manifest,
    },
    {
      fetchImpl,
      getAgentMemorySessions: async () => sessions,
    },
  );

  assert.equal(audit.stats.sessions, 1);
  assert.equal(audit.sessions[0].observations.status, "complete");
  assert.equal(
    audit.sessions[0].graph.status,
    "not-observable-per-session",
  );
  assert.equal(audit.graph.sampledNodes, 0);
  assert.equal(audit.graph.sampleLimit, 7);
  assert.deepEqual(audit.worktrees.missingFromAgentMemory, []);
  assert.equal(
    calls.filter((call) => call.path === "/agentmemory/sessions").length,
    0,
  );
  assert.equal(
    calls.filter((call) => call.path === "/agentmemory/observations").length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.path === "/agentmemory/graph/query").length,
    1,
  );
});
