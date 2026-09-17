import { countBy } from "./backfill-inventory.mjs";
import { createAgentMemoryClient } from "./agentmemory-client.mjs";

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadBoundedGraphSample(client, limit) {
  const result = await client.queryGraph({ limit, offset: 0 });
  return {
    nodes: result.nodes || [],
    edges: result.edges || [],
    totalNodes: result.totalNodes ?? null,
    totalEdges: result.totalEdges ?? null,
    fromSnapshot: Boolean(result.fromSnapshot),
    truncated: Boolean(result.truncated),
    limit,
    warning: result.warning || null,
  };
}

function featureEnabled(flags, key) {
  return Boolean(flags.flags?.find((flag) => flag.key === key)?.enabled);
}

export async function buildProjectAudit(
  {
    agentmemoryUrl,
    project,
    apiTimeoutMs = 60_000,
    apiConcurrency = 4,
    graphSampleLimit = 250,
    secret,
    candidateManifest,
  },
  {
    fetchImpl = globalThis.fetch,
    getAgentMemorySessions,
  } = {},
) {
  const client = createAgentMemoryClient({
    baseUrl: agentmemoryUrl,
    secret,
    timeoutMs: apiTimeoutMs,
    fetchImpl,
  });

  const sessionPayloadPromise = getAgentMemorySessions
    ? getAgentMemorySessions().then((sessions) => ({ sessions }))
    : client.getSessions();

  const [
    health,
    flags,
    sessionPayload,
    diagnostics,
    semanticPayload,
    graphStats,
    graphSample,
    nativeWorktrees,
  ] = await Promise.all([
    client.getHealth(),
    client.getFlags(),
    sessionPayloadPromise,
    client.diagnose({ project }),
    client.getSemantic(),
    client.getGraphStats(),
    loadBoundedGraphSample(client, graphSampleLimit),
    candidateManifest
      ? client.getBranchWorktrees(candidateManifest.repository.primaryRoot)
      : Promise.resolve(null),
  ]);

  const projectSessions = sessionPayload.sessions.filter(
    (session) => session.project === project,
  );
  const observationsBySession = new Map(
    await mapWithConcurrency(
      projectSessions,
      apiConcurrency,
      async (session) => {
        const payload = await client.getObservations(session.id);
        return [session.id, payload.observations || []];
      },
    ),
  );

  const graphObservationIds = new Set();
  for (const item of [...graphSample.nodes, ...graphSample.edges]) {
    for (const observationId of item.sourceObservationIds || []) {
      graphObservationIds.add(observationId);
    }
  }

  const semanticSessionIds = new Set();
  for (const semantic of semanticPayload.semantic || []) {
    for (const sessionId of semantic.sourceSessionIds || []) {
      semanticSessionIds.add(sessionId);
    }
  }

  const candidateById = new Map(
    (candidateManifest?.sessions || []).map((session) => [
      session.sessionId,
      session,
    ]),
  );
  const graphEnabled = featureEnabled(flags, "GRAPH_EXTRACTION_ENABLED");

  const sessions = projectSessions
    .map((session) => {
      const observations = observationsBySession.get(session.id) || [];
      const graphLinked = observations.filter((observation) =>
        graphObservationIds.has(observation.id),
      );
      const candidate = candidateById.get(session.id);

      const captureStatus =
        session.observationCount === observations.length
          ? "complete"
          : session.status === "active"
            ? "active-in-flight"
          : "count-mismatch";

      let summaryStatus = "missing";
      if (session.status === "active" && !session.summary) {
        summaryStatus = "active";
      } else if (session.summary) {
        summaryStatus =
          session.summary.observationCount === undefined ||
          session.summary.observationCount === observations.length
            ? "complete"
            : "count-mismatch";
      }

      let graphStatus = "disabled";
      if (graphEnabled) {
        graphStatus =
          graphLinked.length > 0
            ? "present-in-bounded-sample"
            : "not-observable-per-session";
      }

      const issues = [];
      if (captureStatus !== "complete") issues.push("observation-count-mismatch");
      if (summaryStatus === "missing") issues.push("summary-missing");
      if (summaryStatus === "count-mismatch") issues.push("summary-count-mismatch");

      return {
        id: session.id,
        agent: candidate?.agent || session.agentId || "unknown",
        project: session.project,
        cwd: session.cwd,
        status: session.status,
        tags: session.tags || [],
        worktree: candidate?.worktree || null,
        observations: {
          declared: session.observationCount || 0,
          stored: observations.length,
          indexable: observations.filter(
            (observation) => observation.title && observation.narrative,
          ).length,
          status: captureStatus,
        },
        summary: {
          status: summaryStatus,
          observationCount: session.summary?.observationCount ?? null,
          title: session.summary?.title ?? null,
        },
        embeddings: {
          status: "not-observable",
          providerAvailable: Boolean(flags.embeddingProvider),
          note:
            "AgentMemory v0.9.28 exposes provider health but not per-session vector-index membership through its public API.",
        },
        graph: {
          status: graphStatus,
          linkedObservationsInSample: graphLinked.length,
          totalObservations: observations.length,
        },
        semantic: {
          linked: semanticSessionIds.has(session.id),
        },
        issues,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const diagnosticSummary = diagnostics.summary || {};
  const runtimeHealthy =
    health.health?.status === "healthy" &&
    health.circuitBreaker?.state === "closed";

  const localWorktreePaths = new Set(
    candidateManifest?.repository.worktrees.map((worktree) => worktree.path) ||
      [],
  );
  const nativeWorktreeList =
    nativeWorktrees?.worktrees || nativeWorktrees?.branches || [];
  const nativeWorktreePaths = new Set(
    nativeWorktreeList
      .map((worktree) =>
        typeof worktree === "string"
          ? worktree
          : worktree.path || worktree.cwd || null,
      )
      .filter(Boolean),
  );

  return {
    generatedAt: new Date().toISOString(),
    project,
    evidencePolicy: {
      publicSurfacesOnly: true,
      agentMemory: [
        "GET /agentmemory/health",
        "GET /agentmemory/config/flags",
        "GET /agentmemory/sessions",
        "GET /agentmemory/branch/worktrees?cwd=...",
        "GET /agentmemory/observations",
        "GET /agentmemory/graph/stats",
        `POST /agentmemory/graph/query (bounded to ${graphSampleLimit} nodes)`,
        "GET /agentmemory/semantic",
        "POST /agentmemory/diagnostics",
      ],
      worktrees: ["git worktree list --porcelain", "wt list --format=json"],
      limitation:
        "AgentMemory v0.9.28 exposes neither per-session embedding membership nor a project/session-scoped graph query. Embeddings are reported as not-observable; graph evidence is only positive when found in the bounded sample.",
    },
    runtime: {
      healthy: runtimeHealthy,
      version: health.version,
      serviceStatus: health.health?.status || health.status,
      connectionState: health.health?.connectionState || null,
      circuitBreaker: health.circuitBreaker,
      provider: flags.provider,
      embeddingProvider: flags.embeddingProvider,
      features: Object.fromEntries(
        (flags.flags || []).map((flag) => [flag.key, flag.enabled]),
      ),
      functionMetrics: health.functionMetrics || [],
    },
    candidates: candidateManifest
      ? {
          total: candidateManifest.stats.total,
          byAgent: candidateManifest.stats.byAgent,
          byIngestionStatus: candidateManifest.stats.byIngestionStatus,
          selected: candidateManifest.stats.selected,
        }
      : null,
    embeddings: {
      providerAvailable: Boolean(flags.embeddingProvider),
      provider: flags.embeddingProvider || null,
      perSessionCoverage: "not-observable",
    },
    graph: {
      totalNodes: graphStats.totalNodes ?? graphSample.totalNodes,
      totalEdges: graphStats.totalEdges ?? graphSample.totalEdges,
      sampledNodes: graphSample.nodes.length,
      sampledEdges: graphSample.edges.length,
      sampleLimit: graphSample.limit,
      sampleTruncated: graphSample.truncated,
      fromSnapshot: graphSample.fromSnapshot,
      sourceLinkedObservationCount: graphObservationIds.size,
      warning: graphSample.warning,
    },
    worktrees: candidateManifest
      ? {
          localCount: localWorktreePaths.size,
          agentMemoryCount: nativeWorktreePaths.size,
          missingFromAgentMemory: [...localWorktreePaths].filter(
            (worktreePath) => !nativeWorktreePaths.has(worktreePath),
          ),
          extraInAgentMemory: [...nativeWorktreePaths].filter(
            (worktreePath) => !localWorktreePaths.has(worktreePath),
          ),
        }
      : null,
    semantic: {
      total: (semanticPayload.semantic || []).length,
      sourceLinkedSessionCount: semanticSessionIds.size,
    },
    nativeDiagnostics: diagnostics,
    stats: {
      sessions: sessions.length,
      observations: sessions.reduce(
        (sum, session) => sum + session.observations.stored,
        0,
      ),
      byAgent: countBy(sessions, (session) => session.agent),
      bySummaryStatus: countBy(
        sessions,
        (session) => session.summary.status,
      ),
      byGraphStatus: countBy(sessions, (session) => session.graph.status),
      sessionsWithIssues: sessions.filter((session) => session.issues.length > 0)
        .length,
      nativeDiagnostics: {
        pass: diagnosticSummary.pass || 0,
        warn: diagnosticSummary.warn || 0,
        fail: diagnosticSummary.fail || 0,
        fixable: diagnosticSummary.fixable || 0,
      },
    },
    sessions,
  };
}
