#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ackInbox, heartbeatPeer, readInbox, registerAgentSession, replyToEvent, setPeerActivity } from "../../../src/api/index.ts";
import type { Event } from "../../../src/api/types.ts";
import { ensureDaemon } from "../../../src/client.ts";
import { ENV_LAUNCH_ID, ENV_PEER_ID, ENV_SESSION_NAME } from "../../../src/constants.ts";
import { LettaSynchronizeRuntime, type LettaDeliveryMode, type LettaSession } from "./runtime.ts";

const DEFAULT_ZAI_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_MODEL = "zai/glm-4.7";

interface Args {
  name: string;
  model: string;
  deliveryMode: LettaDeliveryMode;
  pollMs: number;
  cwd: string;
  agentId?: string;
  conversationId?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    name: process.env[ENV_SESSION_NAME] || "letta",
    model: process.env.SYNCHRONIZE_LETTA_MODEL || DEFAULT_MODEL,
    deliveryMode: (process.env.SYNCHRONIZE_LETTA_DELIVERY as LettaDeliveryMode | undefined) || "interrupt",
    pollMs: Number(process.env.SYNCHRONIZE_LETTA_POLL_MS || "1000"),
    cwd: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = argv[index + 1];
    if (arg === "--name" && next) {
      args.name = next;
      index += 1;
    } else if (arg === "--model" && next) {
      args.model = next;
      index += 1;
    } else if (arg === "--delivery" && next) {
      if (next !== "steer" && next !== "interrupt") throw new Error("--delivery must be steer or interrupt");
      args.deliveryMode = next;
      index += 1;
    } else if (arg === "--poll-ms" && next) {
      args.pollMs = Number(next);
      index += 1;
    } else if (arg === "--cwd" && next) {
      args.cwd = next;
      index += 1;
    } else if (arg === "--agent" && next) {
      args.agentId = next;
      index += 1;
    } else if (arg === "--conversation" && next) {
      args.conversationId = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.pollMs) || args.pollMs <= 0) throw new Error("--poll-ms must be a positive number");
  return args;
}

function printHelpAndExit(): never {
  console.log("Usage: letta-synchronize [--name NAME] [--model MODEL] [--delivery interrupt|steer] [--poll-ms MS] [--agent AGENT_ID] [--conversation CONV_ID]");
  process.exit(0);
}

async function ensureLettaCliPath(): Promise<void> {
  if (process.env.LETTA_CLI_PATH) return;
  const resolved = await import.meta.resolve("@letta-ai/letta-code");
  process.env.LETTA_CLI_PATH = fileURLToPath(resolved);
}

async function loadZaiApiKey(): Promise<void> {
  if (process.env.ZAI_CODING_API_KEY) return;
  const keyFile = process.env.ZAI_CODING_API_KEY_FILE;
  if (!keyFile) return;
  const key = (await readFile(keyFile, "utf8")).trim();
  if (key) process.env.ZAI_CODING_API_KEY = key;
}

async function createLettaSession(args: Args): Promise<LettaSession> {
  await ensureLettaCliPath();
  process.env.LETTA_LOCAL_BACKEND_EXPERIMENTAL ??= "1";
  process.env.ZAI_CODING_BASE_URL ??= DEFAULT_ZAI_CODING_BASE_URL;
  await loadZaiApiKey();
  if (!process.env.ZAI_CODING_API_KEY) {
    throw new Error("ZAI_CODING_API_KEY or ZAI_CODING_API_KEY_FILE is required for the Letta Z.ai coding provider");
  }

  const sdk = await import("@letta-ai/letta-code-sdk");
  const options = {
    model: args.model,
    cwd: args.cwd,
    permissionMode: "bypassPermissions" as const,
    skillSources: [],
    memfs: false,
    memfsStartup: "skip" as const,
    systemInfoReminder: false,
    maxApprovalRecoveryAttempts: 0,
  };
  if (args.conversationId) return sdk.resumeSession(args.conversationId, options);
  if (args.agentId) return sdk.createSession(args.agentId, options);
  return sdk.createSession(undefined, options);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = await ensureDaemon();
  const hostSessionId = `letta-sync:${process.pid}`;
  const session = await createLettaSession(args);
  const bus = {
    async register(input: {
      peerId?: string;
      sessionName: string;
      purpose: string;
      launchId?: string;
      model?: string;
      metadata?: Record<string, unknown>;
    }) {
      const peerId = input.peerId ?? process.env[ENV_PEER_ID];
      const launchId = input.launchId ?? process.env[ENV_LAUNCH_ID];
      const binding = await registerAgentSession(client, {
        sessionName: input.sessionName,
        purpose: input.purpose,
        tool: "letta",
        hostTool: "letta",
        hostSessionId,
        cwd: args.cwd,
        pid: process.pid,
        source: "letta-code-sdk",
        agentType: "letta-code-sdk",
        ...(peerId ? { peerId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(launchId ? { launchId } : {}),
      });
      return { peerId: binding.binding.peer_id, sessionName: binding.binding.peer.session_name };
    },
    async heartbeat(peerId: string) {
      await heartbeatPeer(client, peerId);
    },
    async setActivity(peerId: string, state: "initializing" | "working" | "idle") {
      await setPeerActivity(client, { peerId, state });
    },
    async readInbox(peerId: string): Promise<Event[]> {
      return (await readInbox(client, peerId)).events;
    },
    async ack(peerId: string, eventIds: number[]) {
      await ackInbox(client, peerId, eventIds);
    },
    async reply(peerId: string, eventId: number, message: string) {
      await replyToEvent(client, { senderPeerId: peerId, inReplyTo: eventId, message });
    },
  };

  const runtime = new LettaSynchronizeRuntime(bus, session, {
    sessionName: args.name,
    model: args.model,
    deliveryMode: args.deliveryMode,
    pollMs: args.pollMs,
    logger: (line) => console.error(line),
    ...(process.env[ENV_PEER_ID] ? { peerId: process.env[ENV_PEER_ID] } : {}),
    ...(process.env[ENV_LAUNCH_ID] ? { launchId: process.env[ENV_LAUNCH_ID] } : {}),
  });

  const shutdown = () => {
    void runtime.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const registration = await runtime.initialize();
  console.error(
    `[letta-synchronize] registered peer=${registration.peerId} agent=${registration.letta.agentId} conversation=${registration.letta.conversationId} model=${registration.letta.model}`,
  );
  await runtime.start();
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(`[letta-synchronize] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
