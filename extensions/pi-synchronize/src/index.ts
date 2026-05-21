import { mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverDaemon, deletePeer, heartbeatPeer, registerPeer, type Event, type PiSyncClient } from "./client.ts";
import { formatExternalEvent, mapEventToDelivery } from "./delivery.ts";
import { resolveSessionName } from "./identity.ts";
import { formatError, getLogPath, log } from "./log.ts";
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
    event: "session_start" | "session_shutdown" | "session_before_switch",
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

  async function teardown(): Promise<void> {
    log(`teardown begin peer_id=${peerId ?? "-"}`);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    sub?.stop();
    sub = null;
    if (peerId && client) {
      try {
        await deletePeer(client, peerId);
        log(`deleted peer ${peerId}`);
      } catch (error) {
        log(`failed to delete peer ${peerId}: ${formatError(error)}`);
      }
    }
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
    client = await discoverDaemon();
    const piSessionId = ctx.sessionManager?.getSessionId?.() ?? null;
    const sessionName = resolveSessionName({
      piSessionId,
      envSessionName: process.env.SYNCHRONIZE_SESSION_NAME ?? null,
    });
    const { peer } = await registerPeer(client, {
      tool: "pi",
      sessionName,
      purpose: "pi-coding-agent session",
    });
    peerId = peer.peer_id;
    process.env.SYNCHRONIZE_PEER_ID = peerId;
    log(`registered peer_id=${peerId} session_name=${sessionName}`);

    const home = process.env.SYNCHRONIZE_HOME ?? join(homedir(), ".synchronize");
    const sessionsDir = join(home, "pi-sessions");
    await mkdir(sessionsDir, { recursive: true });
    const fileId = piSessionId ?? sessionName;
    sessionFile = join(sessionsDir, `${fileId}.json`);
    await writeFile(
      sessionFile,
      JSON.stringify({ peer_id: peerId, session_name: sessionName, pid: process.pid }, null, 2),
    );

    sub = new PiEventSubscription({
      peerId,
      client,
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
    await sub.start();

    heartbeat = setInterval(() => {
      if (!client || !peerId) return;
      heartbeatPeer(client, peerId).catch((error) => log(`heartbeat failed: ${formatError(error)}`));
    }, HEARTBEAT_MS);

    log(`startup complete daemon=${client.baseUrl} log_file=${getLogPath()}`);
    ctx.ui?.notify?.(`synchronize: connected as ${sessionName} (log: ${getLogPath()})`, "info");
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      await startup(ctx);
    } catch (error) {
      log(`session_start failed: ${formatError(error)}`);
      ctx.ui?.notify?.(`synchronize: ${formatError(error)}`, "warning");
      await teardown();
    }
  });

  pi.on("session_before_switch", async () => {
    await teardown();
  });

  pi.on("session_shutdown", async () => {
    await teardown();
  });
}
