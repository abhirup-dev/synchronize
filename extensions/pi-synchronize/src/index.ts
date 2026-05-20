import { mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverDaemon, deletePeer, heartbeatPeer, registerPeer, type Event, type PiSyncClient } from "./client.ts";
import { formatExternalEvent, mapEventToDelivery } from "./delivery.ts";
import { resolveSessionName } from "./identity.ts";
import { formatError, log } from "./log.ts";
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
  session?: { id?: string } | null;
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
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    sub?.stop();
    sub = null;
    if (peerId && client) {
      try {
        await deletePeer(client, peerId);
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
    const sessionName = resolveSessionName({
      piSessionId: ctx.session?.id ?? null,
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
    const fileId = ctx.session?.id ?? sessionName;
    sessionFile = join(sessionsDir, `${fileId}.json`);
    await writeFile(
      sessionFile,
      JSON.stringify({ peer_id: peerId, session_name: sessionName, pid: process.pid }, null, 2),
    );

    sub = new PiEventSubscription({
      peerId,
      client,
      onEvent: async (event: Event) => {
        const wrapped = formatExternalEvent(event);
        const delivery = mapEventToDelivery(event, ctxRef ?? {});
        await pi.sendUserMessage(wrapped, delivery ? { deliverAs: delivery } : undefined);
      },
    });
    await sub.start();

    heartbeat = setInterval(() => {
      if (!client || !peerId) return;
      heartbeatPeer(client, peerId).catch((error) => log(`heartbeat failed: ${formatError(error)}`));
    }, HEARTBEAT_MS);

    ctx.ui?.notify?.(`synchronize: connected as ${sessionName}`, "info");
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
