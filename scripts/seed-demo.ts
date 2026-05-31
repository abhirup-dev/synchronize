#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { Database } from "bun:sqlite";
import { ensureDaemon, requestJson } from "../src/client.ts";
import { writeJson } from "../src/fs.ts";

const peers = {
  codexApi: "demo-codex-api",
  claudeTests: "demo-claude-tests",
  codexMedia: "demo-codex-media",
  staleWorker: "demo-stale-worker",
};

async function main(): Promise<void> {
  const client = await ensureDaemon();
  await register(client, peers.codexApi, "codex-api", "codex", "backend review");
  await register(client, peers.claudeTests, "claude-tests", "claude", "test writer");
  await register(client, peers.codexMedia, "codex-media", "codex", "media triage");
  await register(client, peers.staleWorker, "old-worker", "codex", "stale refactor");

  await group(client, "backend-review", peers.codexApi);
  await group(client, "media-triage", peers.codexMedia);
  await group(client, "scratch-plan", peers.claudeTests, true);

  await joinGroup(client, "backend-review", peers.codexApi, "api");
  await joinGroup(client, "backend-review", peers.claudeTests, "tests");
  await joinGroup(client, "backend-review", peers.staleWorker, "legacy");
  await joinGroup(client, "media-triage", peers.codexMedia, "media");
  await joinGroup(client, "media-triage", peers.claudeTests, "review");
  await joinGroup(client, "scratch-plan", peers.claudeTests, "planner");

  await sendGroup(client, "backend-review", peers.codexApi, "Found failing auth trace; sharing context.");
  await sendGroup(client, "backend-review", peers.claudeTests, "Writing a focused regression test.");
  await sendGroup(client, "media-triage", peers.codexMedia, "Collected screenshot and API trace.");
  await dm(client, peers.claudeTests, peers.codexApi, "Can you validate the repro once tests finish?");
  await dm(client, peers.codexApi, peers.staleWorker, "You have pending context when you return.");

  const sampleDir = joinPath(client.paths.home, "demo-source");
  await mkdir(sampleDir, { recursive: true });
  const tracePath = joinPath(sampleDir, "api-trace.json");
  const notesPath = joinPath(sampleDir, "review-notes.md");
  await writeFile(tracePath, JSON.stringify({ status: 500, route: "/auth/session", demo: true }, null, 2), "utf8");
  await writeFile(notesPath, "# Review notes\n\nDemo MediaStore artifact.\n", "utf8");
  await shareMedia(client, "backend-review", peers.codexApi, tracePath, "auth API trace");
  await shareMedia(client, "media-triage", peers.codexMedia, notesPath, "triage notes");
  const db = new Database(client.paths.dbPath);
  db.query("UPDATE peers SET lease_expires_at = ? WHERE peer_id = ?").run(
    new Date(Date.now() - 10 * 60_000).toISOString(),
    peers.staleWorker,
  );
  db.close();

  await writeJson(client.paths.cliIdentityPath, { peer_id: peers.codexApi, session_name: "codex-api" });
}

async function register(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  peerId: string,
  sessionName: string,
  tool: string,
  purpose: string,
): Promise<void> {
  await requestJson(client, "/peers/register", {
    method: "POST",
    body: JSON.stringify({ peer_id: peerId, session_name: sessionName, tool, purpose }),
  });
}

async function group(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  name: string,
  creatorPeerId: string,
  ephemeral = false,
): Promise<void> {
  await requestJson(client, "/groups", {
    method: "POST",
    body: JSON.stringify({ name, creator_peer_id: creatorPeerId, ephemeral }),
  });
}

async function joinGroup(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  name: string,
  peerId: string,
  alias: string,
): Promise<void> {
  await requestJson(client, `/groups/${encodeURIComponent(name)}/join`, {
    method: "POST",
    body: JSON.stringify({ peer_id: peerId, alias }),
  });
}

async function sendGroup(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  name: string,
  senderPeerId: string,
  message: string,
): Promise<void> {
  await requestJson(client, `/groups/${encodeURIComponent(name)}/messages`, {
    method: "POST",
    body: JSON.stringify({ sender_peer_id: senderPeerId, message }),
  });
}

async function dm(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  senderPeerId: string,
  recipientPeerId: string,
  message: string,
): Promise<void> {
  await requestJson(client, "/dm", {
    method: "POST",
    body: JSON.stringify({ sender_peer_id: senderPeerId, recipient_peer_id: recipientPeerId, message }),
  });
}

async function shareMedia(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  groupName: string,
  sharedByPeerId: string,
  path: string,
  description: string,
): Promise<void> {
  await requestJson(client, `/groups/${encodeURIComponent(groupName)}/media`, {
    method: "POST",
    body: JSON.stringify({ shared_by_peer_id: sharedByPeerId, path, description }),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
