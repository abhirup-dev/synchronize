import { mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  discoverDaemon,
  heartbeatPeer,
  registerAgentSession,
  registerPeer,
  setPeerActivity,
  type Event,
  type PiSyncClient,
} from "./client.ts";
import { formatExternalEvent, mapEventToDelivery } from "./delivery.ts";
import { resolveSessionName } from "./identity.ts";
import { formatError, getLogPath, log } from "./log.ts";
import { ensureSynchronizeCliReady } from "./preflight.ts";
import { PiEventSubscription } from "./subscription.ts";

/**
 * Minimal Pi extension API surface we depend on. We type it structurally so
 * the package doesn't require @earendil-works/pi-coding-agent at build time —
 * Pi just needs to call the default export with its real ExtensionAPI.
 */
export interface PiSendOptions {
  deliverAs?: "steer" | "followUp" | "nextTurn";
}

export interface PiExtensionContext {
  sessionManager?: {
    getSessionId?: () => string;
    getSessionName?: () => string;
  };
  ui?: { notify?: (message: string, level?: string) => void };
  isIdle?: () => boolean;
  abort?: () => void;
}

export interface PiExtensionAPI {
  on(
    event:
      | "session_start"
      | "session_shutdown"
      | "session_before_switch"
      | "agent_start"
      | "agent_end",
    handler: (event: unknown, ctx: PiExtensionContext) => void | Promise<void>,
  ): void;
  sendUserMessage(content: string, options?: PiSendOptions): Promise<void> | void;
}

const HEARTBEAT_MS = 15_000;

export default function synchronizeExtension(pi: PiExtensionAPI): void {
  let client: PiSyncClient | null = null;
  let peerId: string | null = null;
  let sub: PiEventSubscription | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let ctxRef: PiExtensionContext | null = null;
  let sessionFile: string | null = null;

  // Process-lifetime peer. teardownSession runs on Pi's internal session
  // boundaries (before-switch) and only releases per-session state — the peer
  // row and heartbeat are preserved so the Pi process stays online across
  // Pi's internal session rotations. teardownProcess runs on actual process
  // shutdown and is the only path that deletes the peer.
  async function teardownSession(): Promise<void> {
    log(`session teardown peer_id=${peerId ?? "-"} (peer preserved)`);
    sub?.stop();
    sub = null;
    ctxRef = null;
  }

  async function teardownProcess(): Promise<void> {
    log(`process teardown begin peer_id=${peerId ?? "-"}`);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    sub?.stop();
    sub = null;
    // Heartbeat-only lifecycle: do NOT delete the peer on process teardown.
    // Once heartbeats stop, the daemon drops the peer offline within the lease
    // window on its own. Deleting here was the footgun — it killed peers during
    // session rotation / borrowed-peer reuse / second-launch teardown. See
    // session-tracker/plan-agent-ttl-presence-v0.md.
    if (sessionFile) {
      try {
        await unlink(sessionFile);
      } catch {
        /* ignore */
      }
      sessionFile = null;
    }
    delete process.env.SYNCHRONIZE_PEER_ID;
    peerId = null;
    client = null;
    ctxRef = null;
  }

  async function startup(ctx: PiExtensionContext): Promise<void> {
    ctxRef = ctx;
    const piSessionId = ctx.sessionManager?.getSessionId?.() ?? null;

    // Idempotent path: if this process already registered a peer in a
    // previous session_start, reuse it. Only refresh the per-session
    // agent_session binding and event subscription. This makes the peer
    // process-lifetime instead of Pi-session-lifetime.
    if (client && peerId) {
      log(`startup reusing peer_id=${peerId} pi_session_id=${piSessionId ?? "<unset>"}`);
      if (piSessionId) {
        const sessionName = process.env.SYNCHRONIZE_SESSION_NAME ?? `pi-${peerId}`;
        try {
          await registerAgentSession(client, {
            peerId,
            sessionName,
            hostSessionId: piSessionId,
            cwd: process.cwd(),
          });
          log(`refreshed agent_session host_session_id=${piSessionId} peer_id=${peerId}`);
        } catch (error) {
          log(`agent_session refresh failed: ${formatError(error)}`);
        }
      }
      sub?.stop();
      sub = buildSubscription(peerId, client);
      await sub.start();
      return;
    }

    // Fresh registration path.
    const cliPath = await ensureSynchronizeCliReady();
    log(`synchronize CLI preflight passed cli=${cliPath}`);
    client = await discoverDaemon();
    const envSessionName = process.env.SYNCHRONIZE_SESSION_NAME ?? null;
    const sessionName = resolveSessionName({ piSessionId, envSessionName });
    log(
      `identity resolved session_name=${sessionName} env_session_name=${envSessionName ?? "<unset>"} pi_session_id=${piSessionId ?? "<unset>"}`,
    );
    const { peer } = await registerPeer(client, {
      tool: "pi",
      sessionName,
      purpose: "pi-coding-agent session",
    });
    peerId = peer.peer_id;
    process.env.SYNCHRONIZE_PEER_ID = peerId;
    log(`registered peer_id=${peerId} session_name=${sessionName}`);
    if (piSessionId) {
      await registerAgentSession(client, {
        peerId,
        sessionName,
        hostSessionId: piSessionId,
        cwd: process.cwd(),
      });
      log(`registered agent_session host_tool=pi host_session_id=${piSessionId} peer_id=${peerId}`);
    }

    const home = process.env.SYNCHRONIZE_HOME ?? join(homedir(), ".synchronize");
    const sessionsDir = join(home, "pi-sessions");
    await mkdir(sessionsDir, { recursive: true });
    const fileId = piSessionId ?? sessionName;
    sessionFile = join(sessionsDir, `${fileId}.json`);
    await writeFile(
      sessionFile,
      JSON.stringify({ peer_id: peerId, session_name: sessionName, pid: process.pid }, null, 2),
    );

    sub = buildSubscription(peerId, client);
    await sub.start();

    heartbeat = setInterval(() => {
      if (!client || !peerId) return;
      heartbeatPeer(client, peerId).catch((error) => log(`heartbeat failed: ${formatError(error)}`));
    }, HEARTBEAT_MS);

    log(`startup complete daemon=${client.baseUrl} log_file=${getLogPath()}`);
    ctx.ui?.notify?.(`synchronize: connected as ${sessionName} (log: ${getLogPath()})`, "info");
  }

  function buildSubscription(currentPeerId: string, currentClient: PiSyncClient): PiEventSubscription {
    return new PiEventSubscription({
      peerId: currentPeerId,
      client: currentClient,
      onEvent: async (event: Event) => {
        const idle = ctxRef?.isIdle?.() ?? true;
        const delivery = mapEventToDelivery(event, ctxRef ?? {});
        const preview = (event.body ?? "").slice(0, 80).replace(/\n/g, "\\n");
        log(
          `event received event_id=${event.event_id} type=${event.type} from=${event.sender_peer_id ?? "-"} group_id=${event.group_id ?? "-"} idle=${idle} delivery=${delivery ?? "immediate"} preview="${preview}"`,
        );
        const wrapped = formatExternalEvent(event);
        try {
          await pi.sendUserMessage(wrapped, delivery ? { deliverAs: delivery } : undefined);
          log(`event injected event_id=${event.event_id} delivery=${delivery ?? "immediate"} bytes=${wrapped.length}`);
        } catch (error) {
          log(`event inject FAILED event_id=${event.event_id}: ${formatError(error)}`);
          throw error;
        }
      },
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      await startup(ctx);
    } catch (error) {
      log(`session_start failed: ${formatError(error)}`);
      ctx.ui?.notify?.(`synchronize: ${formatError(error)}`, "warning");
      // Failure here is per-session — don't delete the peer if one was already
      // registered in a previous startup. Just release per-session state.
      await teardownSession();
    }
  });

  // Intentionally not handling session_before_switch — the peer is
  // process-lifetime, not Pi-session-lifetime. Pi rotates its internal
  // sessions during normal operation (context window, tool flows, etc.) and
  // reacting to that event was the root cause of peers being soft-deleted
  // out from under live Pi processes.

  pi.on("session_shutdown", async () => {
    await teardownProcess();
  });

  // Activity presence: an agentic run brackets the "working" state. agent_start
  // fires for ANY input source (human prompt OR a synchronize steer/followUp
  // channel injection), so it covers channel-driven turns without special
  // casing. agent_end returns the peer to idle. Best-effort — a failed push
  // must never disrupt the run.
  async function pushActivity(state: "working" | "idle"): Promise<void> {
    if (!peerId || !client) return;
    try {
      await setPeerActivity(client, peerId, state);
    } catch (error) {
      log(`activity push (${state}) failed peer_id=${peerId}: ${formatError(error)}`);
    }
  }

  pi.on("agent_start", async () => {
    await pushActivity("working");
  });

  pi.on("agent_end", async () => {
    await pushActivity("idle");
  });
}
