#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_STORE = join(homedir(), "data", "state_store.db");
const DEFAULT_SCOPES = [
  "mem:sessions",
  "mem:summaries",
  "mem:memories",
  "mem:lessons",
  "mem:crystals",
  "mem:semantic",
  "mem:insights",
  "mem:graph:nodes",
  "mem:graph:edges",
  "mem:profiles",
  "mem:procedural",
];

const command = process.argv[2] || "audit";
const args = parseArgs(process.argv.slice(3));
const store = resolve(args.store || DEFAULT_STORE);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const eq = part.indexOf("=");
    if (eq !== -1) {
      out[part.slice(2, eq)] = part.slice(eq + 1);
    } else {
      const key = part.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function scopePath(scope) {
  return join(store, `${encodeURIComponent(scope)}.bin`);
}

function readScope(scope, fallback = {}) {
  const path = scopePath(scope);
  if (!existsSync(path)) return fallback;
  let text = readFileSync(path, "utf8");
  const end = findJsonObjectEnd(text);
  if (end >= 0) text = text.slice(0, end + 1);
  text = text.replace(/\u0000/g, "");
  if (!text.trim()) return fallback;
  return JSON.parse(text);
}

function findJsonObjectEnd(text) {
  let depth = 0;
  let inString = false;
  let escaping = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!started) {
      if (ch === "{") {
        started = true;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function writeScope(scope, value) {
  mkdirSync(dirname(scopePath(scope)), { recursive: true });
  writeFileSync(scopePath(scope), JSON.stringify(value), "utf8");
}

function topCounts(values, limit = 20) {
  const counts = new Map();
  for (const value of values) counts.set(value || "(missing)", (counts.get(value || "(missing)") || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function includesPath(cwd, needle) {
  return String(cwd || "").toLowerCase().includes(needle.toLowerCase());
}

function canonicalProject(session) {
  const cwd = session?.cwd || "";
  const project = session?.project || "";

  if (
    includesPath(cwd, "/Codes/Personal/synchronize") ||
    includesPath(cwd, "/Codes/Personal/synchronize-worktrees/") ||
    includesPath(cwd, "/Codes/worktrees/synchronize/") ||
    includesPath(cwd, "/private/tmp/sync-") ||
    project === "/Users/abhirupdas/Codes/Personal/synchronize"
  ) {
    return "synchronize";
  }

  if (
    includesPath(cwd, "/Codes/worktrees/content-intelligence/") ||
    includesPath(cwd, "/Codes/content-intelligence") ||
    project === "/Users/abhirupdas/Codes/worktrees/content-intelligence/abhirup-bench-tools-refactor" ||
    project === "abhirup-bench-tools-refactor" ||
    project === "feature_extraction_genai" ||
    project === "goldendataset_ds2_allposts_v4_lite"
  ) {
    return "content-intelligence";
  }

  if (typeof project === "string" && project.startsWith("/")) return basename(project);
  if (project) return project;
  if (cwd) return basename(cwd);
  return "unknown";
}

function sessionProjectIndex(sessions) {
  const index = new Map();
  for (const [id, session] of Object.entries(sessions)) {
    index.set(id, canonicalProject(session));
  }
  return index;
}

function inferProjectFromSessionIds(item, index) {
  const ids = new Set();
  if (typeof item.sessionId === "string") ids.add(item.sessionId);
  for (const id of item.sessionIds || []) if (typeof id === "string") ids.add(id);
  for (const id of item.sourceIds || []) if (typeof id === "string") ids.add(id);
  const projects = [...ids].map((id) => index.get(id)).filter(Boolean);
  return new Set(projects).size === 1 ? projects[0] : undefined;
}

function normalizeProjectMap(map, index) {
  let changed = 0;
  const next = {};
  for (const [id, item] of Object.entries(map)) {
    const inferred = inferProjectFromSessionIds(item, index);
    const existing = typeof item.project === "string" ? item.project : "";
    const canonical = inferred || canonicalProject({ cwd: item.cwd, project: existing });
    if (canonical && canonical !== existing) {
      changed++;
      next[id] = {
        ...item,
        project: canonical,
        agentmemoryPreviousProject: existing || undefined,
      };
    } else {
      next[id] = item;
    }
  }
  return { changed, value: next };
}

function audit() {
  const sessions = readScope("mem:sessions");
  const memories = readScope("mem:memories");
  const lessons = readScope("mem:lessons");
  const crystals = readScope("mem:crystals");
  const semantic = readScope("mem:semantic");
  const insights = readScope("mem:insights");
  const graphNodes = readScope("mem:graph:nodes");
  const graphEdges = readScope("mem:graph:edges");
  const sessionValues = Object.values(sessions);
  const contains = (value, ...needles) => needles.some((needle) => JSON.stringify(value).toLowerCase().includes(needle));

  return {
    store,
    sessions: {
      total: sessionValues.length,
      projectTop: topCounts(sessionValues.map((s) => s.project)),
      cwdTop: topCounts(sessionValues.map((s) => s.cwd), 12),
      canonicalProjectTop: topCounts(sessionValues.map(canonicalProject)),
    },
    memories: {
      total: Object.keys(memories).length,
      projectTop: topCounts(Object.values(memories).map((m) => m.project)),
    },
    lessons: {
      total: Object.keys(lessons).length,
      projectTop: topCounts(Object.values(lessons).map((m) => m.project)),
    },
    crystals: {
      total: Object.keys(crystals).length,
      projectTop: topCounts(Object.values(crystals).map((m) => m.project)),
    },
    semantic: {
      total: Object.keys(semantic).length,
      projectTop: topCounts(Object.values(semantic).map((m) => m.project)),
    },
    insights: {
      total: Object.keys(insights).length,
      projectTop: topCounts(Object.values(insights).map((m) => m.project)),
      mixedSynchronizeContentIntelligence: Object.values(insights).filter(
        (m) => contains(m, "synchronize") && contains(m, "content-intelligence", "bench", "prompt", "gemini", "dataset"),
      ).length,
    },
    graph: {
      nodes: Object.keys(graphNodes).length,
      edges: Object.keys(graphEdges).length,
    },
  };
}

function backup() {
  const out = resolve(args.out || join(homedir(), ".agentmemory", "backups", `scope-repair-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(out, { recursive: true });
  cpSync(store, join(out, basename(store)), { recursive: true, force: true });
  return { backup: out };
}

function exportScopes() {
  const scopes = args.scopes ? args.scopes.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_SCOPES;
  const outPath = resolve(args.out || join(homedir(), ".agentmemory", `agentmemory-export-${Date.now()}.json`));
  const payload = {
    exportedAt: new Date().toISOString(),
    store,
    scopes: Object.fromEntries(scopes.map((scope) => [scope, readScope(scope)])),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return { export: outPath, scopes };
}

function exportAgentMemoryImport() {
  const outPath = resolve(args.out || join(homedir(), ".agentmemory", `agentmemory-normalized-import-${Date.now()}.json`));
  const sessionsMap = readScope("mem:sessions");
  const normalizedSessions = {};
  for (const [id, session] of Object.entries(sessionsMap)) {
    const canonical = canonicalProject(session);
    const normalized = {
      ...session,
      id: session.id || id,
    };
    normalizedSessions[id] = canonical !== session.project ? {
      ...normalized,
      project: canonical,
      agentmemoryPreviousProject: session.project || undefined,
    } : normalized;
  }
  const index = sessionProjectIndex(normalizedSessions);
  const summaries = normalizeProjectMap(readScope("mem:summaries"), index).value;
  const memories = normalizeProjectMap(readScope("mem:memories"), index).value;
  const lessons = normalizeProjectMap(readScope("mem:lessons"), index).value;
  const crystals = normalizeProjectMap(readScope("mem:crystals"), index).value;
  const observations = {};
  for (const id of Object.keys(normalizedSessions)) {
    const obs = Object.values(readScope(`mem:obs:${id}`, {}));
    if (obs.length > 0) observations[id] = obs;
  }
  const exportData = {
    version: "0.9.24",
    exportedAt: new Date().toISOString(),
    sessions: Object.values(normalizedSessions),
    observations,
    memories: Object.values(memories),
    summaries: Object.values(summaries),
    lessons: Object.values(lessons),
    crystals: Object.values(crystals),
  };
  if (!args["drop-derived"]) {
    exportData.semanticMemories = Object.values(normalizeProjectMap(readScope("mem:semantic"), index).value);
    exportData.insights = Object.values(normalizeProjectMap(readScope("mem:insights"), index).value);
    exportData.graphNodes = Object.values(readScope("mem:graph:nodes"));
    exportData.graphEdges = Object.values(readScope("mem:graph:edges"));
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf8");
  return {
    exportData: outPath,
    sessions: exportData.sessions.length,
    observationBuckets: Object.keys(observations).length,
    observations: Object.values(observations).reduce((sum, arr) => sum + arr.length, 0),
    memories: exportData.memories.length,
    summaries: exportData.summaries.length,
    lessons: exportData.lessons.length,
    crystals: exportData.crystals.length,
    droppedDerived: Boolean(args["drop-derived"]),
  };
}

function restoreScopes() {
  if (!args.from) throw new Error("restore requires --from <export.json>");
  if (!args.apply) throw new Error("restore is destructive; pass --apply after taking a backup");
  const payload = JSON.parse(readFileSync(resolve(args.from), "utf8"));
  const scopes = args.scopes ? args.scopes.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(payload.scopes || {});
  for (const scope of scopes) {
    if (!(scope in payload.scopes)) throw new Error(`scope ${scope} not found in export`);
    writeScope(scope, payload.scopes[scope]);
  }
  return { restored: scopes };
}

async function postImport(baseUrl, body) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/agentmemory/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const message = parsed?.error || parsed?.message || text || `HTTP ${response.status}`;
    throw new Error(`import failed: ${message}`);
  }
  return parsed;
}

async function importAgentMemory() {
  if (!args.from) throw new Error("import-agentmemory requires --from <normalized-export.json>");
  if (!args.apply) throw new Error("import-agentmemory is destructive when the first chunk uses replace; pass --apply");
  const baseUrl = args.url || process.env.AGENTMEMORY_URL || "http://localhost:3111";
  const chunkSize = Number(args["chunk-size"] || 8);
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("--chunk-size must be a positive integer");
  const payload = JSON.parse(readFileSync(resolve(args.from), "utf8"));
  const sessions = payload.sessions || [];
  const observations = payload.observations || {};
  const failures = [];
  const imported = [];

  async function importRange(range, strategy, includeMetadata) {
    const body = {
      strategy,
      data: {
        version: payload.version || "0.9.24",
        exportedAt: payload.exportedAt || new Date().toISOString(),
        sessions: range,
        observations: Object.fromEntries(range.map((session) => [session.id || session.sessionId, observations[session.id || session.sessionId] || session.observations || []])),
      },
    };
    if (includeMetadata) {
      for (const key of ["memories", "summaries", "lessons", "crystals", "semanticMemories", "insights", "graphNodes", "graphEdges"]) {
        if (payload[key]) body.data[key] = payload[key];
      }
    }
    try {
      const result = await postImport(baseUrl, body);
      imported.push({ strategy, sessions: range.length, result });
    } catch (error) {
      if (range.length === 1) {
        failures.push({ id: range[0]?.id || range[0]?.sessionId || null, project: range[0]?.project || null, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const mid = Math.ceil(range.length / 2);
      await importRange(range.slice(0, mid), strategy, includeMetadata);
      await importRange(range.slice(mid), "merge", false);
    }
  }

  for (let index = 0; index < sessions.length; index += chunkSize) {
    await importRange(sessions.slice(index, index + chunkSize), index === 0 ? "replace" : "merge", index === 0);
  }
  return {
    url: baseUrl,
    chunks: imported.length,
    importedSessions: imported.reduce((sum, item) => sum + item.sessions, 0),
    failures,
  };
}

async function compareLive() {
  if (!args.from) throw new Error("compare-live requires --from <normalized-export.json>");
  const baseUrl = args.url || process.env.AGENTMEMORY_URL || "http://localhost:3111";
  const desired = JSON.parse(readFileSync(resolve(args.from), "utf8"));
  const live = [];
  const liveObservations = {};
  const pageSize = Number(args["page-size"] || 50);
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/agentmemory/export?maxSessions=${pageSize}&offset=${offset}`);
    if (!response.ok) throw new Error(`export failed: HTTP ${response.status} ${await response.text()}`);
    const page = await response.json();
    const sessions = page.sessions || page.data?.sessions || [];
    Object.assign(liveObservations, page.observations || page.data?.observations || {});
    live.push(...sessions);
    if (sessions.length < pageSize) break;
  }
  const idOf = (session) => session?.id || session?.sessionId;
  const desiredMap = new Map((desired.sessions || []).map((session) => [idOf(session), session]));
  const liveMap = new Map(live.map((session) => [idOf(session), session]));
  const missing = [...desiredMap.keys()].filter((id) => id && !liveMap.has(id));
  const extra = [...liveMap.keys()].filter((id) => id && !desiredMap.has(id));
  const obsDiff = [];
  for (const [id, desiredSession] of desiredMap) {
    if (!id || !liveMap.has(id)) continue;
    const desiredCount = (desired.observations?.[id] || desiredSession.observations || []).length;
    const liveCount = (liveObservations[id] || liveMap.get(id).observations || []).length;
    if (desiredCount !== liveCount) obsDiff.push({ id, desired: desiredCount, live: liveCount, project: liveMap.get(id).project, cwd: liveMap.get(id).cwd });
  }
  return {
    url: baseUrl,
    desiredSessions: desiredMap.size,
    liveSessions: liveMap.size,
    missing: missing.length,
    extra: extra.length,
    missingSample: missing.slice(0, 10),
    extraSample: extra.slice(0, 10),
    obsDiffCount: obsDiff.length,
    obsDiffSample: obsDiff.slice(0, 10),
    liveProjectTop: topCounts(live.map((session) => session.project)),
  };
}

function normalize() {
  const sessions = readScope("mem:sessions");
  const before = audit();
  const nextSessions = {};
  let sessionChanges = 0;
  for (const [id, session] of Object.entries(sessions)) {
    const canonical = canonicalProject(session);
    if (canonical !== session.project) {
      sessionChanges++;
      nextSessions[id] = {
        ...session,
        project: canonical,
        agentmemoryPreviousProject: session.project || undefined,
      };
    } else {
      nextSessions[id] = session;
    }
  }
  const index = sessionProjectIndex(nextSessions);
  const summaries = normalizeProjectMap(readScope("mem:summaries"), index);
  const memories = normalizeProjectMap(readScope("mem:memories"), index);
  const lessons = normalizeProjectMap(readScope("mem:lessons"), index);
  const crystals = normalizeProjectMap(readScope("mem:crystals"), index);
  const semantic = args["drop-semantic"] ? { changed: Object.keys(readScope("mem:semantic")).length, value: {} } : normalizeProjectMap(readScope("mem:semantic"), index);
  const insights = args["drop-insights"] ? { changed: Object.keys(readScope("mem:insights")).length, value: {} } : normalizeProjectMap(readScope("mem:insights"), index);
  const graphNodes = args["drop-graph"] ? { changed: Object.keys(readScope("mem:graph:nodes")).length, value: {} } : undefined;
  const graphEdges = args["drop-graph"] ? { changed: Object.keys(readScope("mem:graph:edges")).length, value: {} } : undefined;

  const result = {
    apply: Boolean(args.apply),
    sessionChanges,
    summariesChanged: summaries.changed,
    memoriesChanged: memories.changed,
    lessonsChanged: lessons.changed,
    crystalsChanged: crystals.changed,
    semanticChanged: semantic.changed,
    insightsChanged: insights.changed,
    graphNodesChanged: graphNodes?.changed || 0,
    graphEdgesChanged: graphEdges?.changed || 0,
    before: before.sessions.projectTop,
    after: topCounts(Object.values(nextSessions).map((s) => s.project)),
  };

  if (args.apply) {
    writeScope("mem:sessions", nextSessions);
    writeScope("mem:summaries", summaries.value);
    writeScope("mem:memories", memories.value);
    writeScope("mem:lessons", lessons.value);
    writeScope("mem:crystals", crystals.value);
    writeScope("mem:semantic", semantic.value);
    writeScope("mem:insights", insights.value);
    if (graphNodes) writeScope("mem:graph:nodes", graphNodes.value);
    if (graphEdges) writeScope("mem:graph:edges", graphEdges.value);
  }
  return result;
}

const commands = {
  audit,
  backup,
  export: exportScopes,
  "export-agentmemory": exportAgentMemoryImport,
  restore: restoreScopes,
  "import-agentmemory": importAgentMemory,
  "compare-live": compareLive,
  normalize,
};
if (!commands[command]) {
  console.error(`Usage: ${basename(process.argv[1])} audit|backup|export|export-agentmemory|import-agentmemory|compare-live|restore|normalize [--store path] [--apply]`);
  process.exit(2);
}

try {
  console.log(JSON.stringify(await commands[command](), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
