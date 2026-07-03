import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../src/db.ts";
import { annotateSession } from "../src/annotate/index.ts";
import { runAnnotationQuery, resolveBinding, QueryError } from "../src/annotate/query.ts";

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((h) => rm(h, { recursive: true, force: true })));
});

async function freshDb(): Promise<Database> {
  const home = await mkdtemp(join(tmpdir(), "sa-test-"));
  homes.push(home);
  const { db } = await openDatabase(join(home, "db.sqlite"));
  return db;
}

function seedSession(db: Database, binding: string, tool: string, sessionId: string, file?: string): void {
  db.query("INSERT INTO peers (peer_id,tool,session_name,machine_id,lease_expires_at) VALUES (?,?,?,?,?)").run(
    `peer-${binding}`, tool, sessionId, "m1", "2099-01-01T00:00:00Z",
  );
  db.query(
    "INSERT INTO agent_sessions (binding_id,peer_id,host_tool,host_session_id,host_session_file,cwd) VALUES (?,?,?,?,?,?)",
  ).run(binding, `peer-${binding}`, tool, sessionId, file ?? null, "/x");
}

function seedAnnotations(db: Database, binding: string): void {
  const ins = db.query(
    `INSERT INTO session_annotations (binding_id,seq,turn_index,line_number,category,kind,tool,normalized_tool,text)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const rows: Array<[number, number, number, string, string, string | null, string | null, string]> = [
    [0, 0, 1, "user", "user_message", null, null, "fix the beads sync bug"],
    [1, 1, 2, "assistant", "assistant_thinking", null, null, "the push hook likely fails"],
    [2, 1, 3, "tool", "shell_tool_call", "Bash", "Bash", "git log -S beads-"],
    [3, 2, 4, "tool", "tool_result", "Bash", "Bash", "beads-7f matched DEBUG line"],
    [4, 3, 5, "mcp", "mcp_tool_call", "mcp__synchronize__bridge_reply", "bridge_reply", "found it the %beads- prefix"],
    [5, 3, 6, "assistant", "assistant_text", null, null, "patching now"],
  ];
  for (const r of rows) ins.run(binding, ...r);
}

describe("v0 query layer", () => {
  test("session resolves by binding_id and by host_session_id", async () => {
    const db = await freshDb();
    seedSession(db, "claude:abc", "claude", "abc");
    expect(resolveBinding(db, "claude:abc")).toBe("claude:abc");
    expect(resolveBinding(db, "abc")).toBe("claude:abc");
    expect(resolveBinding(db, "nope")).toBeNull();
  });

  test("Q1: session + exact facet", async () => {
    const db = await freshDb();
    seedSession(db, "claude:abc", "claude", "abc");
    seedAnnotations(db, "claude:abc");
    const r = runAnnotationQuery(db, { session: "abc", where: [{ field: "normalized_tool", op: "eq", value: "bridge_reply" }] });
    expect(r.windowed).toBe(false);
    expect(r.rows.map((x) => x.seq)).toEqual([4]);
  });

  test("Q2: session + body LIKE substring", async () => {
    const db = await freshDb();
    seedSession(db, "claude:abc", "claude", "abc");
    seedAnnotations(db, "claude:abc");
    const r = runAnnotationQuery(db, { session: "abc", where: [{ field: "text", op: "like", value: "%DEBUG%" }] });
    expect(r.rows.map((x) => x.seq)).toEqual([3]);
  });

  test("Q3: exact facet AND body LIKE, with ±1 window", async () => {
    const db = await freshDb();
    seedSession(db, "claude:abc", "claude", "abc");
    seedAnnotations(db, "claude:abc");
    const r = runAnnotationQuery(db, {
      where: [
        { field: "normalized_tool", op: "eq", value: "bridge_reply" },
        { field: "text", op: "like", value: "%beads-%" },
      ],
      window: 1,
    });
    expect(r.windowed).toBe(true);
    // hit is seq 4; ±1 window → seqs 3,4,5, all flagged with hit_seq=4
    expect(r.rows.map((x) => x.seq)).toEqual([3, 4, 5]);
    expect(r.rows.every((x) => x.hit_seq === 4)).toBe(true);
  });

  test("window=0 returns only the hit", async () => {
    const db = await freshDb();
    seedSession(db, "claude:abc", "claude", "abc");
    seedAnnotations(db, "claude:abc");
    const r = runAnnotationQuery(db, { where: [{ field: "kind", op: "eq", value: "tool_result" }], window: 0 });
    expect(r.rows.map((x) => x.seq)).toEqual([3]);
  });

  test("non-allowlisted field is rejected (injection guard)", async () => {
    const db = await freshDb();
    seedSession(db, "claude:abc", "claude", "abc");
    expect(() => runAnnotationQuery(db, { where: [{ field: "text; DROP TABLE x", op: "eq", value: "1" }] })).toThrow(QueryError);
  });

  test("unknown session is rejected", async () => {
    const db = await freshDb();
    expect(() => runAnnotationQuery(db, { session: "ghost" })).toThrow(QueryError);
  });
});

// Golden faithfulness tests against the real sample transcripts the Python
// prototypes annotated. Skipped when the transcripts aren't on this machine.
describe("decoder golden (real transcripts)", () => {
  const piFile = join(
    homedir(),
    ".pi/agent/sessions/--Users-abhirupdas-Codes-Personal-synchronize--/2026-06-07T07-33-09-632Z_019ea0ff-f580-7438-aded-78cc2500d04f.jsonl",
  );
  const piTest = existsSync(piFile) ? test : test.skip;
  piTest("Pi decoder reproduces the prototype counts exactly", async () => {
    const db = await freshDb();
    seedSession(db, "pi:019ea0ff", "pi", "019ea0ff", piFile);
    const r = await annotateSession(db, "pi:019ea0ff");
    expect(r.annotationCount).toBe(1464);
    expect(r.parsedLines).toBe(517);
    expect(r.diagnosticsCount).toBe(0);
    expect(r.byCategory).toEqual({
      session: 1, runtime: 4, message: 512, user: 45, assistant: 185, mcp: 90, tool: 585, synchronize: 42,
    });
  });

  const claudeFile = join(
    homedir(),
    ".claude/projects/-Users-abhirupdas-Codes-Personal-synchronize/cd99d7a7-d1c6-442b-8f50-c9fa01d90283.jsonl",
  );
  const claudeTest = existsSync(claudeFile) ? test : test.skip;
  claudeTest("Claude decoder classifies the real transcript with no diagnostics", async () => {
    const db = await freshDb();
    seedSession(db, "claude:cd99", "claude", "cd99", claudeFile);
    const r = await annotateSession(db, "claude:cd99");
    expect(r.diagnosticsCount).toBe(0);
    // Matches the original Python prototype exactly (claude.py).
    expect(r.annotationCount).toBe(12660);
    expect(r.byCategory).toEqual({
      assistant: 1184, attachment: 2202, mcp: 1490, message: 2920, runtime: 777,
      session: 2331, synchronize: 285, system: 111, tool: 1226, user: 134,
    });
    expect(r.byTool["bridge_reply"]).toBeGreaterThan(0);
  });
});
