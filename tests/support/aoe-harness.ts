// Shared helpers for the live AOE archive/resume harness (epic sync-ocdt).
// These spawn REAL Pi agents through the daemon's launch lifecycle, so they are
// gated off by default (SYNCHRONIZE_AOE_HARNESS=1) and live here so the backbone
// scenario (sync-ocdt.1) and its siblings (sync-ocdt.2/.3/.4) share one copy.
import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type ClientConfig } from "../../src/client.ts";
import { launchAgent, listAgentSessions } from "../../src/api/agent-sessions.ts";
import { archiveSession, listArchived } from "../../src/api/archive.ts";
import { readInbox, sendDm } from "../../src/api/inbox.ts";
import { sendGroupMessage } from "../../src/api/groups.ts";
import { aoeProfileName } from "../../src/launch/service.ts";
import { startDaemon, type TestDaemon } from "./daemon.ts";

export const HARNESS = process.env.SYNCHRONIZE_AOE_HARNESS === "1";
/** test() when the live harness is enabled, test.skip() otherwise. */
export const harnessTest = HARNESS ? test : test.skip;

// Mirror of the Python harness's --keep: when set, leave the daemon, the live
// Pi agents, the temp homes, and the AOE profile in place after the test so you
// can attach to the panes and inspect state. Reaping, daemon shutdown, and
// AOE/home cleanup all become no-ops. Run a single scenario with -t and clean up
// afterwards with `make clean-slate` + `aoe profile delete synchronize-<hash>`.
export const KEEP = process.env.SYNCHRONIZE_AOE_KEEP === "1";

export interface Delivery {
  pushed_to: string[];
  inbox_only: string[];
}

export interface LaunchedAgent {
  peerId: string;
  title: string;
  name: string;
}

// A per-file harness instance: owns the backend-title registry so spawned tmux
// sessions can be reaped even when resume mints fresh titles. Temp homes are
// handled by the shared daemon registry (cleanupDaemonHomes).
export function createHarness() {
  const spawnedTitles = new Set<string>();
  const spawnedRepos: string[] = [];
  const startedHomes: string[] = [];

  // Start a debug daemon (full decision trail to stderr) for the harness.
  // Track its home so cleanup can delete the AOE profile it owns — each daemon
  // home maps to a distinct `synchronize-<hash>` AOE profile, and the AOE tool
  // keeps its own per-profile session/group registry that outlives both the
  // tmux panes and the (deleted) daemon home unless we tear it down explicitly.
  async function startHarnessDaemon(): Promise<TestDaemon> {
    const daemon = await startDaemon({ debug: true });
    startedHomes.push(daemon.home);
    if (KEEP) {
      // Under --keep, daemon.stop() becomes a no-op so the agents stay live.
      const origStop = daemon.stop;
      daemon.stop = async () => {
        console.log(`[keep] daemon kept alive at ${daemon.baseUrl} (home=${daemon.home}); profile=${aoeProfileName(daemon.home)}`);
        void origStop; // intentionally not called
      };
    }
    return daemon;
  }

  // Launch one real Pi agent through the daemon's launch lifecycle and wait
  // until it has registered its host session (so it has a resumable transcript).
  async function launchPi(client: ClientConfig, name: string): Promise<LaunchedAgent> {
    const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
    spawnedRepos.push(repo);
    const result = await launchAgent(client, { tool: "pi", name, repo });
    spawnedTitles.add(result.title);
    await waitForBinding(client, result.peerId);
    return { peerId: result.peerId, title: result.title, name };
  }

  // Reap spawned tmux backends, remove per-agent temp repo dirs, and delete the
  // AOE profile each harness daemon created (which drops its AOE sessions +
  // groups — otherwise they accumulate as dead `synchronize-<hash>` profiles).
  async function cleanup(): Promise<void> {
    if (KEEP) {
      console.log(`[keep] leaving ${spawnedTitles.size} agent session(s) + ${startedHomes.length} daemon home(s)/profile(s) in place for inspection`);
      for (const home of startedHomes) console.log(`[keep]   home=${home} profile=${aoeProfileName(home)}`);
      return;
    }
    for (const title of spawnedTitles) await killAoeByTitle(title);
    await Promise.all(spawnedRepos.map((repo) => rm(repo, { recursive: true, force: true })));
    for (const home of startedHomes) await deleteAoeProfile(home);
  }

  return { spawnedTitles, startHarnessDaemon, launchPi, cleanup };
}

// Delete the AOE profile a daemon home owns (removes its AOE sessions + groups).
// `aoe profile delete` prompts for confirmation, so pipe 'y'. No-op when aoe is
// absent or the profile never materialized.
export async function deleteAoeProfile(home: string): Promise<void> {
  const profile = aoeProfileName(home);
  const proc = Bun.spawn({
    cmd: ["sh", "-c", `printf 'y\\n' | aoe profile delete ${profile}`],
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

// Best-effort: kill the tmux session(s) AOE created for a backend title.
export async function killAoeByTitle(title: string): Promise<void> {
  const list = Bun.spawn({ cmd: ["tmux", "list-sessions", "-F", "#{session_name}"], stdout: "pipe", stderr: "ignore" });
  const names = (await new Response(list.stdout).text()).split("\n").map((s) => s.trim()).filter(Boolean);
  await list.exited;
  for (const name of names) {
    if (name.startsWith(`aoe_${title}_`)) {
      const kill = Bun.spawn({ cmd: ["tmux", "kill-session", "-t", name], stdout: "ignore", stderr: "ignore" });
      await kill.exited;
    }
  }
}

// Wait until a launched agent has registered its host session (the Pi extension
// fires a few seconds after spawn).
export async function waitForBinding(client: ClientConfig, peerId: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { bindings } = await listAgentSessions(client, { peerId });
    if (bindings.some((b) => b.host_session_id)) return;
    await Bun.sleep(1500);
  }
  throw new Error(`agent ${peerId} did not register a host session in time`);
}

// Poll a peer's inbox until a message body containing `marker` arrives.
export async function waitForInbox(client: ClientConfig, peerId: string, marker: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { events } = await readInbox(client, peerId);
    if (events.some((e) => (e.body ?? "").includes(marker))) return;
    await Bun.sleep(1000);
  }
  throw new Error(`peer ${peerId} did not receive a DM containing "${marker}" in time`);
}

// Poll until a resumed peer has resurrected (archived -> active) — i.e. it is no
// longer listed among the archived sessions, which happens once its respawned
// process re-registers via the pinned ENV_PEER_ID.
export async function waitForResumed(client: ClientConfig, peerId: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { sessions } = await listArchived(client);
    if (!sessions.some((s) => s.peer_id === peerId)) return;
    await Bun.sleep(1500);
  }
  throw new Error(`peer ${peerId} did not resurrect (still archived) in time`);
}

export async function dmErrorCode(client: ClientConfig, senderPeerId: string, recipientPeerId: string, message: string): Promise<string> {
  try {
    await sendDm(client, { senderPeerId, recipientPeerId, message });
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return "ok";
}

// Send a DM, retrying through `must_reregister` until the resumed sender has
// re-registered (resurrected archived->active) and can send again.
export async function dmWhenActive(client: ClientConfig, senderPeerId: string, recipientPeerId: string, message: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await sendDm(client, { senderPeerId, recipientPeerId, message });
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === "must_reregister") {
        await Bun.sleep(1500);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`sender ${senderPeerId} did not resurrect (still must_reregister) in time`);
}

// Send a group message, retrying through `must_reregister` until the resumed
// sender can post again. Returns the delivery summary (peer-id fanout sets).
export async function groupSendWhenActive(
  client: ClientConfig,
  name: string,
  senderPeerId: string,
  message: string,
  timeoutMs = 120_000,
): Promise<Delivery> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { delivery } = await sendGroupMessage(client, { name, senderPeerId, message });
      return delivery;
    } catch (error) {
      if (error instanceof ApiError && error.code === "must_reregister") {
        await Bun.sleep(1500);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`group sender ${senderPeerId} did not resurrect in time`);
}

// Send a group message — optionally threaded via `inReplyTo` — retrying through
// `must_reregister` until the (possibly just-resumed) sender can post. Returns
// the new event id (for chaining thread replies) plus the delivery summary.
export async function groupPostWhenActive(
  client: ClientConfig,
  name: string,
  senderPeerId: string,
  message: string,
  inReplyTo?: number,
  timeoutMs = 120_000,
): Promise<{ eventId: number; delivery: Delivery }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await sendGroupMessage(client, {
        name,
        senderPeerId,
        message,
        ...(inReplyTo !== undefined ? { inReplyTo } : {}),
      });
      return { eventId: res.event.event_id, delivery: res.delivery };
    } catch (error) {
      if (error instanceof ApiError && error.code === "must_reregister") {
        await Bun.sleep(1500);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`group sender ${senderPeerId} did not resurrect in time`);
}

// The full set of active members reached by a group send (sender excluded).
export function reached(delivery: Delivery): Set<string> {
  return new Set([...delivery.pushed_to, ...delivery.inbox_only]);
}

// Reap any live agents via the real archive path so nothing is orphaned (resume
// mints new backend titles that title-tracking can miss).
export async function reap(client: ClientConfig, peerIds: string[]): Promise<void> {
  if (KEEP) return; // keep agents alive for inspection
  for (const peerId of peerIds) await archiveSession(client, { peerId }).catch(() => {});
}
