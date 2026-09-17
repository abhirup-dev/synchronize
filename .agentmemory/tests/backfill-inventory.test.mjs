import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  crossCheckAgentMemory,
  groupScopedSessions,
  isWithin,
  parseGitWorktrees,
  readTranscriptMetadata,
} from "../lib/backfill-inventory.mjs";

test("isWithin observes path component boundaries", () => {
  assert.equal(isWithin("/repo/worktree/file", "/repo/worktree"), true);
  assert.equal(isWithin("/repo/worktree-other", "/repo/worktree"), false);
});

test("parseGitWorktrees parses porcelain records", () => {
  const records = parseGitWorktrees(
    [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /worktrees/feature",
      "HEAD def456",
      "branch refs/heads/feature",
      "prunable reason",
      "",
    ].join("\n"),
  );
  assert.deepEqual(records, [
    { path: "/repo", branch: "main", prunable: false },
    { path: "/worktrees/feature", branch: "feature", prunable: true },
  ]);
});

test("groupScopedSessions prefers the canonical top-level transcript", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const shared = {
    agent: "claude",
    sessionId: id,
    cwd: "/repo",
    worktreePath: "/repo",
    worktreeKind: "primary",
    worktreeBranch: "main",
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };
  const [group] = groupScopedSessions([
    {
      ...shared,
      sourcePath: `/archive/${id}/subagents/agent-a.jsonl`,
      bytes: 20_000,
    },
    {
      ...shared,
      sourcePath: `/archive/${id}.jsonl`,
      bytes: 1_000,
    },
  ]);
  assert.equal(group.sourcePath, `/archive/${id}.jsonl`);
  assert.equal(group.duplicateSourceCount, 1);
});

test("crossCheckAgentMemory distinguishes present, missing, and conflict", () => {
  const transcripts = ["present", "missing", "conflict"].map((sessionId) => ({
    sessionId,
  }));
  const checked = crossCheckAgentMemory(
    transcripts,
    [
      { id: "present", project: "project-a", summary: { title: "done" } },
      { id: "conflict", project: "project-b" },
    ],
    "project-a",
  );
  assert.deepEqual(
    checked.map(({ ingestionStatus, summaryStatus }) => ({
      ingestionStatus,
      summaryStatus,
    })),
    [
      { ingestionStatus: "present", summaryStatus: "summarized" },
      { ingestionStatus: "missing", summaryStatus: "not-ingested" },
      { ingestionStatus: "conflict", summaryStatus: "unsummarized" },
    ],
  );
});

test("readTranscriptMetadata reads Claude and Codex stable IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentmemory-audit-"));
  await mkdir(path.join(root, "nested"));
  const claudePath = path.join(root, "nested", "claude.jsonl");
  const codexPath = path.join(root, "codex.jsonl");
  await writeFile(
    claudePath,
    `${JSON.stringify({ sessionId: "claude-id", cwd: "/repo" })}\n`,
  );
  await writeFile(
    codexPath,
    `${JSON.stringify({
      type: "session_meta",
      payload: { id: "codex-id", cwd: "/worktree" },
    })}\n`,
  );

  const claude = await readTranscriptMetadata(claudePath, "claude");
  const codex = await readTranscriptMetadata(codexPath, "codex");
  assert.equal(claude.sessionId, "claude-id");
  assert.equal(claude.cwd, "/repo");
  assert.equal(codex.sessionId, "codex-id");
  assert.equal(codex.cwd, "/worktree");
});
