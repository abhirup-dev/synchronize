import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  opendir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

export function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, WORKTRUNK_VERBOSE: "0" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}

export async function normalizeExisting(candidatePath) {
  const absolute = path.resolve(candidatePath);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

export function isWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function parseGitWorktrees(porcelain) {
  return porcelain
    .split(/\n\n+/)
    .map((block) => {
      const record = {};
      for (const line of block.split("\n")) {
        const separator = line.indexOf(" ");
        if (separator === -1) continue;
        record[line.slice(0, separator)] = line.slice(separator + 1);
      }
      return record.worktree
        ? {
            path: record.worktree,
            branch: record.branch?.replace(/^refs\/heads\//, "") || null,
            prunable: Object.hasOwn(record, "prunable"),
          }
        : null;
    })
    .filter(Boolean);
}

async function findNestedGitWorktrees(root) {
  const discovered = [];

  async function visit(directory) {
    let iterator;
    try {
      iterator = await opendir(directory);
    } catch {
      return;
    }

    for await (const entry of iterator) {
      const entryPath = path.join(directory, entry.name);
      if (entry.name === ".git") {
        discovered.push(directory);
        return;
      }
      if (entry.isDirectory()) await visit(entryPath);
    }
  }

  await visit(root);
  return discovered;
}

export async function discoverWorktrees(
  repoPath,
  {
    exec = runCommand,
    gitCommand = "git",
    worktrunkCommand = "wt",
  } = {},
) {
  const requestedRepo = await normalizeExisting(repoPath);
  const topLevelResult = exec(gitCommand, [
    "-C",
    requestedRepo,
    "rev-parse",
    "--show-toplevel",
  ]);
  const requestedTopLevel = await normalizeExisting(topLevelResult.stdout.trim());
  const commonResult = exec(gitCommand, [
    "-C",
    requestedTopLevel,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const commonDir = await normalizeExisting(commonResult.stdout.trim());
  const primaryRoot = await normalizeExisting(path.dirname(commonDir));

  const gitResult = exec(gitCommand, [
    "-C",
    primaryRoot,
    "worktree",
    "list",
    "--porcelain",
  ]);
  const gitWorktrees = parseGitWorktrees(gitResult.stdout);

  const wtResult = exec(
    worktrunkCommand,
    ["-C", primaryRoot, "list", "--format=json"],
    { allowFailure: true },
  );
  let worktrunkWorktrees = [];
  const warnings = [];
  if (wtResult.status === 0) {
    try {
      const parsed = JSON.parse(wtResult.stdout);
      worktrunkWorktrees = parsed
        .filter((entry) => entry.kind === "worktree" && entry.path)
        .map((entry) => ({
          path: entry.path,
          branch: entry.branch || null,
        }));
    } catch (error) {
      warnings.push(`could not parse Worktrunk JSON: ${error.message}`);
    }
  } else {
    warnings.push(
      `Worktrunk inventory unavailable: ${
        wtResult.stderr.trim() || `exit ${wtResult.status}`
      }`,
    );
  }

  const nestedRoot = path.join(primaryRoot, ".claude", "worktrees");
  const nestedCandidates = await findNestedGitWorktrees(nestedRoot);
  const nestedWorktrees = [];
  for (const candidate of nestedCandidates) {
    const candidateCommon = exec(
      gitCommand,
      [
        "-C",
        candidate,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
      { allowFailure: true },
    );
    if (candidateCommon.status !== 0) continue;
    const normalizedCommon = await normalizeExisting(
      candidateCommon.stdout.trim(),
    );
    if (normalizedCommon === commonDir) nestedWorktrees.push(candidate);
  }

  const records = new Map();
  const merge = async (entry, source) => {
    const normalizedPath = await normalizeExisting(entry.path);
    const current = records.get(normalizedPath) || {
      path: normalizedPath,
      branch: entry.branch || null,
      sources: [],
      prunable: Boolean(entry.prunable),
    };
    if (!current.branch && entry.branch) current.branch = entry.branch;
    current.prunable ||= Boolean(entry.prunable);
    if (!current.sources.includes(source)) current.sources.push(source);
    records.set(normalizedPath, current);
  };

  for (const entry of gitWorktrees) await merge(entry, "git");
  for (const entry of worktrunkWorktrees) await merge(entry, "worktrunk");
  for (const nestedPath of nestedWorktrees) {
    await merge({ path: nestedPath }, "claude-nested-scan");
  }
  await merge({ path: primaryRoot }, "git-common-dir");

  const worktrees = [...records.values()]
    .map((entry) => {
      let kind = "git";
      if (entry.path === primaryRoot) kind = "primary";
      else if (isWithin(entry.path, nestedRoot)) kind = "claude-nested";
      else if (entry.sources.includes("worktrunk")) kind = "worktrunk";
      return { ...entry, kind };
    })
    .sort((left, right) => right.path.length - left.path.length);

  return {
    requestedTopLevel,
    primaryRoot,
    commonDir,
    nestedRoot,
    worktrees,
    warnings,
    sourceCounts: {
      git: gitWorktrees.length,
      worktrunk: worktrunkWorktrees.length,
      nestedScan: nestedWorktrees.length,
      merged: worktrees.length,
    },
  };
}

async function* walkJsonlFiles(root) {
  let iterator;
  try {
    iterator = await opendir(root);
  } catch {
    return;
  }

  for await (const entry of iterator) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield entryPath;
    }
  }
}

export async function readTranscriptMetadata(filePath, agent) {
  let sessionId = null;
  let cwd = null;
  let parseErrors = 0;
  let linesRead = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      linesRead += 1;
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        parseErrors += 1;
        continue;
      }

      if (agent === "claude") {
        sessionId ||= record.sessionId || null;
        cwd ||= typeof record.cwd === "string" ? record.cwd : null;
      } else if (record.type === "session_meta") {
        sessionId ||= record.payload?.id || null;
        cwd ||= record.payload?.cwd || null;
      } else if (record.type === "turn_context") {
        cwd ||= record.payload?.cwd || null;
      }

      if (sessionId && cwd) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  if (!sessionId && agent === "claude") {
    const basename = path.basename(filePath, ".jsonl");
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        basename,
      )
    ) {
      sessionId = basename;
    }
  }

  const fileStat = await stat(filePath);
  return {
    agent,
    sessionId,
    cwd,
    sourcePath: filePath,
    bytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    parseErrors,
    linesRead,
  };
}

function matchingWorktree(cwd, worktrees) {
  if (!cwd) return null;
  const normalized = path.resolve(cwd);
  return worktrees.find((worktree) => isWithin(normalized, worktree.path)) || null;
}

export async function scanTranscripts(agent, roots, worktrees) {
  const records = [];
  const diagnostics = {
    roots: [],
    filesScanned: 0,
    parsedFiles: 0,
    missingSessionId: 0,
    missingCwd: 0,
    unscopedFiles: 0,
    parseErrors: 0,
  };

  for (const configuredRoot of roots) {
    const root = await normalizeExisting(configuredRoot);
    try {
      await access(root);
    } catch {
      diagnostics.roots.push({ path: root, exists: false });
      continue;
    }
    diagnostics.roots.push({ path: root, exists: true });

    for await (const filePath of walkJsonlFiles(root)) {
      diagnostics.filesScanned += 1;
      const metadata = await readTranscriptMetadata(filePath, agent);
      diagnostics.parseErrors += metadata.parseErrors;
      if (!metadata.sessionId) diagnostics.missingSessionId += 1;
      if (!metadata.cwd) diagnostics.missingCwd += 1;
      if (!metadata.sessionId || !metadata.cwd) continue;
      diagnostics.parsedFiles += 1;

      const normalizedCwd = await normalizeExisting(metadata.cwd);
      const worktree = matchingWorktree(normalizedCwd, worktrees);
      if (!worktree) {
        diagnostics.unscopedFiles += 1;
        continue;
      }
      records.push({
        ...metadata,
        cwd: normalizedCwd,
        worktreePath: worktree.path,
        worktreeKind: worktree.kind,
        worktreeBranch: worktree.branch,
      });
    }
  }

  return { records, diagnostics };
}

export function groupScopedSessions(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = `${record.agent}:${record.sessionId}`;
    const group = grouped.get(key) || {
      agent: record.agent,
      sessionId: record.sessionId,
      records: [],
    };
    group.records.push(record);
    grouped.set(key, group);
  }

  return [...grouped.values()].map((group) => {
    const isCanonicalTranscript = (record) =>
      path.basename(record.sourcePath) === `${group.sessionId}.jsonl` &&
      !record.sourcePath.split(path.sep).includes("subagents");
    const ordered = [...group.records].sort(
      (left, right) =>
        Number(isCanonicalTranscript(right)) -
          Number(isCanonicalTranscript(left)) ||
        right.bytes - left.bytes ||
        right.modifiedAt.localeCompare(left.modifiedAt) ||
        left.sourcePath.localeCompare(right.sourcePath),
    );
    const representative = ordered[0];
    const worktrees = [
      ...new Map(
        ordered.map((record) => [
          record.worktreePath,
          {
            path: record.worktreePath,
            kind: record.worktreeKind,
            branch: record.worktreeBranch,
          },
        ]),
      ).values(),
    ];
    return {
      agent: group.agent,
      sessionId: group.sessionId,
      cwd: representative.cwd,
      worktree: {
        path: representative.worktreePath,
        kind: representative.worktreeKind,
        branch: representative.worktreeBranch,
      },
      worktrees,
      sourcePath: representative.sourcePath,
      sourcePaths: ordered.map((record) => record.sourcePath),
      duplicateSourceCount: Math.max(0, ordered.length - 1),
      bytes: representative.bytes,
      modifiedAt: representative.modifiedAt,
    };
  });
}

export async function fetchAgentMemorySessions(
  baseUrl,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 60_000,
  } = {},
) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/agentmemory/sessions`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`AgentMemory sessions request failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(
      `AgentMemory sessions request returned HTTP ${response.status}; refusing to classify transcripts against an unhealthy runtime`,
    );
  }
  const payload = await response.json();
  if (!Array.isArray(payload.sessions)) {
    throw new Error("AgentMemory sessions response is missing sessions[]");
  }
  return payload.sessions;
}

export function crossCheckAgentMemory(sessions, agentMemorySessions, project) {
  const byId = new Map();
  for (const session of agentMemorySessions) {
    const entries = byId.get(session.id) || [];
    entries.push(session);
    byId.set(session.id, entries);
  }

  return sessions.map((session) => {
    const matches = byId.get(session.sessionId) || [];
    const projectMatches = matches.filter((match) => match.project === project);
    let ingestionStatus = "missing";
    if (projectMatches.length > 0) ingestionStatus = "present";
    else if (matches.length > 0) ingestionStatus = "conflict";

    const selected = projectMatches[0] || matches[0] || null;
    return {
      ...session,
      ingestionStatus,
      summaryStatus:
        ingestionStatus === "missing"
          ? "not-ingested"
          : selected?.summary
            ? "summarized"
            : "unsummarized",
      agentMemory: selected
        ? {
            id: selected.id,
            project: selected.project,
            status: selected.status,
            observationCount: selected.observationCount,
            tags: selected.tags || [],
          }
        : null,
    };
  });
}

export function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export async function buildCandidateManifest(options, dependencies = {}) {
  const repository = await discoverWorktrees(options.repo, dependencies);
  const project = options.project || path.basename(repository.primaryRoot);
  const scans = {};
  const records = [];

  if (options.agent === "all" || options.agent === "claude") {
    scans.claude = await scanTranscripts(
      "claude",
      options.claudeRoots,
      repository.worktrees,
    );
    records.push(...scans.claude.records);
  }
  if (options.agent === "all" || options.agent === "codex") {
    scans.codex = await scanTranscripts(
      "codex",
      options.codexRoots,
      repository.worktrees,
    );
    records.push(...scans.codex.records);
  }

  const grouped = groupScopedSessions(records);
  const agentMemorySessions = dependencies.getAgentMemorySessions
    ? await dependencies.getAgentMemorySessions()
    : await fetchAgentMemorySessions(options.agentmemoryUrl, {
        fetchImpl: dependencies.fetchImpl,
        timeoutMs: options.apiTimeoutMs,
      });
  const checked = crossCheckAgentMemory(grouped, agentMemorySessions, project)
    .sort(
      (left, right) =>
        left.agent.localeCompare(right.agent) ||
        left.worktree.path.localeCompare(right.worktree.path) ||
        left.sessionId.localeCompare(right.sessionId),
    );

  const filtered =
    options.status === "all"
      ? checked
      : checked.filter(
          (session) => session.ingestionStatus === options.status,
        );

  return {
    generatedAt: new Date().toISOString(),
    project,
    filters: {
      agent: options.agent,
      status: options.status,
    },
    repository: {
      requestedTopLevel: repository.requestedTopLevel,
      primaryRoot: repository.primaryRoot,
      commonDir: repository.commonDir,
      nestedRoot: repository.nestedRoot,
      sourceCounts: repository.sourceCounts,
      warnings: repository.warnings,
      worktrees: repository.worktrees,
    },
    transcriptScans: Object.fromEntries(
      Object.entries(scans).map(([agent, scan]) => [
        agent,
        scan.diagnostics,
      ]),
    ),
    agentMemory: {
      url: options.agentmemoryUrl,
      totalSessions: agentMemorySessions.length,
      projectSessions: agentMemorySessions.filter(
        (session) => session.project === project,
      ).length,
    },
    stats: {
      total: checked.length,
      selected: filtered.length,
      byAgent: countBy(checked, (session) => session.agent),
      byIngestionStatus: countBy(
        checked,
        (session) => session.ingestionStatus,
      ),
      bySummaryStatus: countBy(checked, (session) => session.summaryStatus),
      byWorktreeKind: countBy(
        checked,
        (session) => session.worktree.kind,
      ),
      duplicateSessionSources: checked.filter(
        (session) => session.duplicateSourceCount > 0,
      ).length,
    },
    sessions: filtered,
  };
}
