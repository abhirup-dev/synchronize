#!/usr/bin/env node

import { homedir } from "node:os";
import path from "node:path";

import {
  buildCandidateManifest,
  fetchAgentMemorySessions,
} from "../lib/backfill-inventory.mjs";
import { buildProjectAudit } from "../lib/project-audit.mjs";

const DEFAULT_AGENTMEMORY_URL = "http://127.0.0.1:3111";

function usage() {
  console.log(`usage: agentmemory-backfill-candidates [command] [options]

Read-only AgentMemory inventory and project health CLI.

Commands:
  candidates                 Discover Claude/Codex transcript deltas (default)
  status                     Deep project ingestion and feature audit
  session SESSION_ID         Deep audit for one AgentMemory session

Shared options:
  --repo PATH                Any checkout of the repository (default: cwd)
  --project NAME             Canonical AgentMemory project (default: repo name)
  --agentmemory-url URL      REST base (default: AGENTMEMORY_URL or ${DEFAULT_AGENTMEMORY_URL})
  --format table|json|jsonl  Output format (default: table)
  --api-timeout-ms N         Per-request timeout (default: 60000)
  --api-concurrency N        Observation request concurrency (default: 4)
  --graph-sample-limit N     Maximum graph nodes inspected (default: 250)
  --git-command PATH         Git executable (default: git)
  --worktrunk-command PATH   Worktrunk executable (default: wt)

Candidate options:
  --agent all|claude|codex   Agent transcript family (default: all)
  --status all|missing|present|conflict
                             AgentMemory ingestion filter (default: all)
  --claude-root PATH         Claude transcript root (repeatable)
  --codex-root PATH          Codex transcript root (repeatable)

The CLI never imports, summarizes, embeds, extracts a graph, or heals state.`);
}

function parseArgs(argv) {
  const options = {
    command: "candidates",
    sessionId: null,
    agent: "all",
    status: "all",
    format: "table",
    repo: process.cwd(),
    project: null,
    agentmemoryUrl:
      process.env.AGENTMEMORY_URL || DEFAULT_AGENTMEMORY_URL,
    apiTimeoutMs: 60_000,
    apiConcurrency: 4,
    graphSampleLimit: 250,
    gitCommand: "git",
    worktrunkCommand: "wt",
    claudeRoots: [],
    codexRoots: [],
  };

  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    options.command = argv[0];
    index = 1;
    if (options.command === "session") {
      options.sessionId = argv[index];
      index += 1;
      if (!options.sessionId) throw new Error("session requires SESSION_ID");
    }
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      usage();
      process.exit(0);
    }
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[index];
    };

    if (arg === "--agent") options.agent = next();
    else if (arg === "--status") options.status = next();
    else if (arg === "--format") options.format = next();
    else if (arg === "--repo") options.repo = next();
    else if (arg === "--project") options.project = next();
    else if (arg === "--agentmemory-url") options.agentmemoryUrl = next();
    else if (arg === "--api-timeout-ms") options.apiTimeoutMs = Number(next());
    else if (arg === "--api-concurrency") options.apiConcurrency = Number(next());
    else if (arg === "--graph-sample-limit") {
      options.graphSampleLimit = Number(next());
    }
    else if (arg === "--git-command") options.gitCommand = next();
    else if (arg === "--worktrunk-command") options.worktrunkCommand = next();
    else if (arg === "--claude-root") options.claudeRoots.push(next());
    else if (arg === "--codex-root") options.codexRoots.push(next());
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (!["candidates", "status", "session"].includes(options.command)) {
    throw new Error("command must be candidates, status, or session");
  }
  if (!["all", "claude", "codex"].includes(options.agent)) {
    throw new Error("--agent must be all, claude, or codex");
  }
  if (!["all", "missing", "present", "conflict"].includes(options.status)) {
    throw new Error("--status must be all, missing, present, or conflict");
  }
  if (!["table", "json", "jsonl"].includes(options.format)) {
    throw new Error("--format must be table, json, or jsonl");
  }
  if (!Number.isInteger(options.apiTimeoutMs) || options.apiTimeoutMs < 1) {
    throw new Error("--api-timeout-ms must be a positive integer");
  }
  if (!Number.isInteger(options.apiConcurrency) || options.apiConcurrency < 1) {
    throw new Error("--api-concurrency must be a positive integer");
  }
  if (
    !Number.isInteger(options.graphSampleLimit) ||
    options.graphSampleLimit < 1 ||
    options.graphSampleLimit > 2_000
  ) {
    throw new Error("--graph-sample-limit must be an integer from 1 to 2000");
  }
  if (options.claudeRoots.length === 0) {
    options.claudeRoots.push(path.join(homedir(), ".claude", "projects"));
  }
  if (options.codexRoots.length === 0) {
    options.codexRoots.push(
      path.join(homedir(), ".codex", "sessions"),
      path.join(homedir(), ".codex", "archived_sessions"),
    );
  }
  return options;
}

function truncate(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function printRows(headers, widths, rows) {
  console.log(
    headers.map((header, index) => header.padEnd(widths[index])).join("  "),
  );
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(
      row
        .map((cell, index) =>
          truncate(cell, widths[index]).padEnd(widths[index]),
        )
        .join("  "),
    );
  }
}

function printCandidates(manifest) {
  console.log("AgentMemory transcript candidate inventory");
  console.log(`repository: ${manifest.repository.primaryRoot}`);
  console.log(`project:    ${manifest.project}`);
  console.log(
    `worktrees:  ${manifest.repository.sourceCounts.merged} merged ` +
      `(git=${manifest.repository.sourceCounts.git}, ` +
      `worktrunk=${manifest.repository.sourceCounts.worktrunk}, ` +
      `nested-scan=${manifest.repository.sourceCounts.nestedScan})`,
  );
  console.log(
    `sessions:   ${manifest.stats.total} total, ` +
      `${manifest.stats.byIngestionStatus.present || 0} present, ` +
      `${manifest.stats.byIngestionStatus.missing || 0} missing, ` +
      `${manifest.stats.byIngestionStatus.conflict || 0} conflict`,
  );
  console.log("");
  if (manifest.sessions.length === 0) {
    console.log("No sessions match the selected filters.");
    return;
  }
  printRows(
    ["agent", "state", "worktree", "session", "cwd"],
    [7, 9, 15, 36, 58],
    manifest.sessions.map((session) => [
      session.agent,
      session.ingestionStatus,
      session.worktree.kind,
      session.sessionId,
      session.cwd,
    ]),
  );
}

function printStatus(audit) {
  console.log("AgentMemory project status");
  console.log(`project:      ${audit.project}`);
  console.log(
    `runtime:      ${audit.runtime.healthy ? "healthy" : "unhealthy"} ` +
      `(v${audit.runtime.version || "?"}, circuit=${audit.runtime.circuitBreaker?.state || "unknown"})`,
  );
  if (audit.candidates) {
    console.log(
      `transcripts:  ${audit.candidates.total} scoped, ` +
        `${audit.candidates.byIngestionStatus.present || 0} present, ` +
        `${audit.candidates.byIngestionStatus.missing || 0} missing, ` +
        `${audit.candidates.byIngestionStatus.conflict || 0} conflict`,
    );
  }
  console.log(
    `stored:       ${audit.stats.sessions} sessions, ${audit.stats.observations} observations`,
  );
  console.log(
    `summaries:    ${JSON.stringify(audit.stats.bySummaryStatus)}`,
  );
  console.log(
    `embeddings:   provider=${audit.embeddings.provider || "none"}, ` +
      `per-session=${audit.embeddings.perSessionCoverage}`,
  );
  console.log(`graph:        ${JSON.stringify(audit.stats.byGraphStatus)}`);
  console.log(
    `diagnostics:  ${JSON.stringify(audit.stats.nativeDiagnostics)}`,
  );
  console.log("");

  const issues = audit.sessions.filter((session) => session.issues.length > 0);
  if (issues.length === 0) {
    console.log("No per-session pipeline issues detected.");
    return;
  }
  printRows(
    ["agent", "session", "obs", "summary", "vectors", "graph", "issues"],
    [7, 36, 11, 14, 13, 18, 52],
    issues.map((session) => [
      session.agent,
      session.id,
      `${session.observations.stored}/${session.observations.declared}`,
      session.summary.status,
      session.embeddings.status,
      session.graph.status,
      session.issues.join(","),
    ]),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let sessionCache;
  const getAgentMemorySessions = async () => {
    sessionCache ||= fetchAgentMemorySessions(options.agentmemoryUrl, {
      timeoutMs: options.apiTimeoutMs,
    });
    return sessionCache;
  };
  const dependencies = {
    gitCommand: options.gitCommand,
    worktrunkCommand: options.worktrunkCommand,
    getAgentMemorySessions,
  };

  const candidateOptions = {
    ...options,
    status: options.command === "candidates" ? options.status : "all",
  };
  const candidates = await buildCandidateManifest(
    candidateOptions,
    dependencies,
  );

  if (!options.project) options.project = candidates.project;
  if (options.command === "candidates") {
    if (options.format === "json") {
      console.log(JSON.stringify(candidates, null, 2));
    } else if (options.format === "jsonl") {
      for (const session of candidates.sessions) {
        console.log(JSON.stringify(session));
      }
    } else {
      printCandidates(candidates);
    }
    return;
  }

  const audit = await buildProjectAudit({
    agentmemoryUrl: options.agentmemoryUrl,
    project: options.project,
    apiTimeoutMs: options.apiTimeoutMs,
    apiConcurrency: options.apiConcurrency,
    graphSampleLimit: options.graphSampleLimit,
    secret: process.env.AGENTMEMORY_SECRET,
    candidateManifest: candidates,
  }, { getAgentMemorySessions });

  if (options.command === "session") {
    const session = audit.sessions.find(
      (candidate) => candidate.id === options.sessionId,
    );
    if (!session) {
      throw new Error(
        `session ${options.sessionId} is not present in project ${options.project}`,
      );
    }
    if (options.format === "table") {
      console.log(JSON.stringify(session, null, 2));
    } else {
      console.log(JSON.stringify(session));
    }
    return;
  }

  if (options.format === "json") {
    console.log(JSON.stringify(audit, null, 2));
  } else if (options.format === "jsonl") {
    for (const session of audit.sessions) {
      console.log(JSON.stringify(session));
    }
  } else {
    printStatus(audit);
  }
}

main().catch((error) => {
  console.error(`agentmemory-backfill-candidates: ${error.message}`);
  process.exit(1);
});
