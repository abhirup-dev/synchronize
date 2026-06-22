import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type ClientConfig } from "../src/client.ts";
import { heartbeatPeer, registerPeer } from "../src/api/peers.ts";
import { createGroup, joinGroup, sendGroupMessage } from "../src/api/groups.ts";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { archiveGroup, archiveSession } from "../src/api/archive.ts";
import { resumeGroup, resumeSession } from "../src/api/resume.ts";
import { createLaunchIntent } from "../src/launch/store.ts";
import { cleanupDaemonHomes, startDaemon } from "./support/daemon.ts";

// `homes` tracks the extra per-test CWD temp dirs (resume requires the original
// CWD to be present); daemon homes are reaped by cleanupDaemonHomes.
const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
  await cleanupDaemonHomes();
});

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  return (await errorOf(fn)).code;
}

async function errorOf(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected an ApiError but the call succeeded");
}

test("re-registering an archived identity resurrects it: active again, membership restored, can send", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "critic", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "critic" });

    await archiveSession(daemon.client, { peerId: peer.peer_id });
    // Archived → cannot send.
    expect(await errorCode(() => sendGroupMessage(daemon.client, { name: "room", senderPeerId: peer.peer_id, message: "x" }))).toBe(
      "must_reregister",
    );

    // Re-register the SAME peer_id == resume's tail. Resurrects to active.
    await registerPeer(daemon.client, { peerId: peer.peer_id, sessionName: "critic", tool: "claude" });

    // Now it can send again (active + membership reactivated, no re-join needed).
    await expect(
      sendGroupMessage(daemon.client, { name: "room", senderPeerId: peer.peer_id, message: "back online" }),
    ).resolves.toBeDefined();
  } finally {
    await daemon.stop();
  }
});

test("a heartbeat from an archived peer does NOT un-archive it (presence ⊥ lifecycle)", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "critic", tool: "claude" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "critic" });
    await archiveSession(daemon.client, { peerId: peer.peer_id });

    // Heartbeat moves presence only — lifecycle must stay archived.
    await heartbeatPeer(daemon.client, peer.peer_id);

    // Still archived: send remains blocked, seat remains reserved.
    expect(await errorCode(() => sendGroupMessage(daemon.client, { name: "room", senderPeerId: peer.peer_id, message: "x" }))).toBe(
      "must_reregister",
    );
    const { peer: other } = await registerPeer(daemon.client, { sessionName: "other", tool: "claude" });
    expect(await errorCode(() => joinGroup(daemon.client, { name: "room", peerId: other.peer_id, alias: "critic" }))).toBe(
      "alias_reserved_by_archived",
    );
  } finally {
    await daemon.stop();
  }
});

// --- jpxm.2: resume launch/show validation + command emission ---

async function archivedSession(
  client: ClientConfig,
  opts: { hostSessionId: string; cwd: string; pid?: number; tool?: string },
): Promise<string> {
  const { binding } = await registerAgentSession(client, {
    hostTool: opts.tool ?? "claude",
    tool: opts.tool ?? "claude",
    sessionName: "critic",
    hostSessionId: opts.hostSessionId,
    cwd: opts.cwd,
    ...(opts.pid !== undefined ? { pid: opts.pid } : {}),
  });
  await createGroup(client, { name: "room", creatorPeerId: binding.peer_id });
  await joinGroup(client, { name: "room", peerId: binding.peer_id, alias: "critic" });
  await archiveSession(client, { peerId: binding.peer_id });
  return binding.peer_id;
}

test("resume of a non-archived peer fails with peer_not_archived", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "live", tool: "claude" });
    expect(await errorCode(() => resumeSession(daemon.client, { peerId: peer.peer_id, print: true }))).toBe("peer_not_archived");
  } finally {
    await daemon.stop();
  }
});

test("resume show emits a faithful --resume command with the captured host_session_id + cwd", async () => {
  const daemon = await startDaemon({ debug: true });
  const cwd = await mkdtemp(join(tmpdir(), "resume-cwd-"));
  homes.push(cwd);
  try {
    const peerId = await archivedSession(daemon.client, { hostSessionId: "host-sess-1", cwd });
    const result = await resumeSession(daemon.client, { peerId, print: true });
    expect(result.mode).toBe("print");
    expect(result.cwd).toBe(cwd);
    expect(result.command?.[0]).toBe("claude");
    expect(result.command).toContain("--resume");
    expect(result.command?.[result.command.indexOf("--resume") + 1]).toBe("host-sess-1");
    expect(result.command).not.toContain("--fork-session");
    // ENV pins the archived peer for correlation on re-register.
    expect(result.env?.SYNCHRONIZE_PEER_ID).toBe(peerId);
  } finally {
    await daemon.stop();
  }
});

test("resume print preserves profile command shape and redacts profile env", async () => {
  const daemon = await startDaemon({ debug: true });
  const cwd = await mkdtemp(join(tmpdir(), "resume-profile-"));
  homes.push(cwd);
  try {
    await writeFile(
      join(daemon.home, "config.toml"),
      `
[agent.glaude]
tool = "claude"
bin = "/opt/bin/claude"
args = ["--profile-arg"]

[agent.glaude.env]
ANTHROPIC_AUTH_TOKEN = "literal-secret"
`,
    );
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      tool: "claude",
      sessionName: "critic",
      hostSessionId: "host-sess-profile",
      cwd,
    });
    const db = new Database(join(daemon.home, "synchronize.db"));
    createLaunchIntent(db, {
      launchId: "launch-profile-resume",
      peerId: binding.peer_id,
      tool: "claude",
      profileName: "glaude",
      sessionName: "critic",
      alias: "critic",
      cwd,
      backend: "local_aoe",
      backendTitle: "abc12345-critic",
      args: ["--stored-arg"],
    });
    db.close();
    await createGroup(daemon.client, { name: "room", creatorPeerId: binding.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: binding.peer_id, alias: "critic" });
    await archiveSession(daemon.client, { peerId: binding.peer_id });

    const result = await resumeSession(daemon.client, { peerId: binding.peer_id, print: true });
    expect(result.command?.[0]).toBe("/opt/bin/claude");
    expect(result.command).toContain("--profile-arg");
    expect(result.command).toContain("--stored-arg");
    expect(result.env?.ANTHROPIC_AUTH_TOKEN).toBe("<redacted:agent-profile>");
    expect(JSON.stringify(result)).not.toContain("literal-secret");
  } finally {
    await daemon.stop();
  }
});

test("resume fails with cwd_missing when the worktree is gone (hint names the branch path)", async () => {
  const daemon = await startDaemon({ debug: true });
  try {
    const peerId = await archivedSession(daemon.client, { hostSessionId: "host-sess-2", cwd: "/nonexistent/worktree/path-xyz" });
    const err = await errorOf(() => resumeSession(daemon.client, { peerId, print: true }));
    expect(err.code).toBe("cwd_missing");
    expect(err.message).toContain("/nonexistent/worktree/path-xyz");
  } finally {
    await daemon.stop();
  }
});

test("resume is blocked by a live peer with a helpful payload, and --force terminates it", async () => {
  const daemon = await startDaemon({ debug: true });
  const cwd = await mkdtemp(join(tmpdir(), "resume-live-"));
  homes.push(cwd);
  // A real, killable process stands in for the live (non-AOE) zombie.
  const child = Bun.spawn({ cmd: ["sleep", "30"], stdout: "ignore", stderr: "ignore" });
  try {
    const peerId = await archivedSession(daemon.client, { hostSessionId: "host-sess-3", cwd, pid: child.pid });

    const blocked = await errorOf(() => resumeSession(daemon.client, { peerId, print: true }));
    expect(blocked.code).toBe("peer_still_live");
    expect(blocked.message).toContain(String(child.pid));
    expect(blocked.message).toContain("--force");

    // --force re-verifies and kills the live pid, then proceeds (print mode).
    const forced = await resumeSession(daemon.client, { peerId, print: true, force: true });
    expect(forced.forced).toBe(true);
    expect(forced.mode).toBe("print");
    await child.exited; // the force kill terminated it
  } finally {
    child.kill();
    await daemon.stop();
  }
});

// --- jpxm.3: group resume with per-member outcomes (never collapsed) ---

test("resume group reports per-member outcomes: launchable printed, missing-cwd skipped", async () => {
  const daemon = await startDaemon({ debug: true });
  const goodCwd = await mkdtemp(join(tmpdir(), "resume-grp-"));
  homes.push(goodCwd);
  try {
    // Member A: cwd exists → resumable. Member B: cwd gone → cwd_missing → skipped.
    const { binding: a } = await registerAgentSession(daemon.client, {
      hostTool: "claude", tool: "claude", sessionName: "critic", hostSessionId: "g-a", cwd: goodCwd,
    });
    const { binding: b } = await registerAgentSession(daemon.client, {
      hostTool: "pi", tool: "pi", sessionName: "planner", hostSessionId: "g-b", cwd: "/gone/path-abc",
    });
    await createGroup(daemon.client, { name: "team", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "team", peerId: a.peer_id, alias: "critic" });
    await joinGroup(daemon.client, { name: "team", peerId: b.peer_id, alias: "planner" });
    await archiveGroup(daemon.client, { group: "team" });

    const result = await resumeGroup(daemon.client, { group: "team", print: true });
    expect(result.members).toHaveLength(2);
    const byAlias = Object.fromEntries(result.members.map((m) => [m.alias, m]));
    expect(byAlias.critic?.action).toBe("printed"); // launchable
    expect(byAlias.planner?.action).toBe("skipped"); // cwd_missing
    expect(byAlias.planner?.warning).toContain("cwd");
    // Partial outcome preserved: one failure did not hide the other's success.
  } finally {
    await daemon.stop();
  }
});
