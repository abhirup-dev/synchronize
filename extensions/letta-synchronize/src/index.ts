#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ackInbox, heartbeatPeer, readInbox, registerAgentSession, replyToEvent, setPeerActivity } from "../../../src/api/index.ts";
import type { Event } from "../../../src/api/types.ts";
import { ensureDaemon } from "../../../src/client.ts";
import { ENV_LAUNCH_ID, ENV_PEER_ID, ENV_SESSION_NAME } from "../../../src/constants.ts";
import { LettaSynchronizeRuntime, type LettaDeliveryMode, type LettaSession } from "./runtime.ts";
import { RemoteLettaSession } from "./remote-session.ts";

const DEFAULT_ZAI_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_MODEL = "zai/glm-4.7";
const DEFAULT_REMOTE_BASE_URL = "http://localhost:8283";

type LettaBackend = "remote" | "agent" | "local";

interface Args {
  name: string;
  model: string;
  deliveryMode: LettaDeliveryMode;
  pollMs: number;
  cwd: string;
  backend: LettaBackend;
  serverUrl: string;
  apiKey?: string;
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
    backend: (process.env.LETTA_BACKEND as LettaBackend | undefined) || "remote",
    serverUrl: process.env.LETTA_BASE_URL || DEFAULT_REMOTE_BASE_URL,
    ...(process.env.LETTA_AGENT_ID ? { agentId: process.env.LETTA_AGENT_ID } : {}),
  };
  const envApiKey = process.env.LETTA_API_KEY || process.env.LETTA_SERVER_PASSWORD;
  if (envApiKey) args.apiKey = envApiKey;
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
    } else if (arg === "--backend" && next) {
      if (next !== "remote" && next !== "agent" && next !== "local") {
        throw new Error("--backend must be remote, agent, or local");
      }
      args.backend = next;
      index += 1;
    } else if ((arg === "--server" || arg === "--base-url") && next) {
      args.serverUrl = next;
      index += 1;
    } else if (arg === "--api-key" && next) {
      args.apiKey = next;
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
  console.log(
    [
      "Usage: letta-synchronize [options]",
      "",
      "  --name NAME              synchronize session name (default: letta)",
      "  --backend remote|agent|local  (default: remote)",
      "                           remote = memory-only via letta-client (server tools only)",
      "                           agent  = remote agent brain + LOCAL tools via letta-code-sdk",
      "                           local  = standalone local letta-code agent",
      "  --delivery interrupt|steer  delivery semantics (default: interrupt)",
      "  --poll-ms MS             inbox poll interval (default: 1000)",
      "",
      "Remote/agent backends (--server, --agent):",
      "  --server URL             Letta server base URL (env LETTA_BASE_URL)",
      "  --agent AGENT_ID         existing agent to drive (env LETTA_AGENT_ID), required",
      "  --conversation CONV_ID   pin a specific conversation thread",
      "  --api-key KEY            optional bearer (env LETTA_API_KEY / LETTA_SERVER_PASSWORD)",
      "",
      "Agent backend runs the agent's client-side tools in --cwd; point --cwd at",
      "the vault and run where the files live (e.g. the VPS). To join a remote",
      "synchronize bus, set SYNCHRONIZE_DAEMON_URL (+ SYNCHRONIZE_TOKEN).",
      "",
      "Local backend (--backend local):",
      "  --model MODEL            Letta Code model (default: zai/glm-4.7)",
      "  --conversation CONV_ID   resume a local conversation",
      "  --agent AGENT_ID         seed a local agent",
    ].join("\n"),
  );
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
  if (args.backend === "remote") return createRemoteLettaSession(args);
  if (args.backend === "agent") return createAgentLettaSession(args);
  return createLocalLettaSession(args);
}

/**
 * Tool-capable backend: drive the *remote* Letta agent (e.g. Rocky) via the
 * Letta Code SDK. The SDK connects to the server (LETTA_BASE_URL) for the
 * agent's brain/memory, and spawns the local `letta` CLI to execute its
 * client-side tools (Bash/Read/Write/Edit/Glob/Grep + skills) in `cwd`. Run
 * this where the files live (e.g. on the VPS, with cwd pointed at the vault).
 *
 * Unlike the local backend, this does NOT set LETTA_LOCAL_BACKEND_EXPERIMENTAL
 * — we want the persistent server-side agent, not a throwaway local one.
 */
async function createAgentLettaSession(args: Args): Promise<LettaSession> {
  if (!args.agentId && !args.conversationId) {
    throw new Error(
      "agent backend requires --agent <agent-id> (e.g. Rocky) or --conversation <conv-id>; set LETTA_AGENT_ID",
    );
  }
  await ensureLettaCliPath();
  // The Letta Code SDK reads the server target from the environment.
  process.env.LETTA_BASE_URL = args.serverUrl;
  process.env.LETTA_API_KEY = args.apiKey && args.apiKey !== "" ? args.apiKey : process.env.LETTA_API_KEY || "dummy";

  const sdk = await import("@letta-ai/letta-code-sdk");
  const options = {
    cwd: args.cwd,
    // Headless bot deployment: never block on approval prompts or interactive
    // tools (the documented cause of stalled non-interactive sessions).
    permissionMode: "bypassPermissions" as const,
    disallowedTools: ["AskUserQuestion"],
    canUseTool: async () => ({ behavior: "allow" as const }),
    systemInfoReminder: false,
    maxApprovalRecoveryAttempts: 0,
  };
  // resumeSession(agent-xxx) attaches to the agent's default (persistent)
  // conversation; conv-xxx pins a specific thread.
  if (args.conversationId) return sdk.resumeSession(args.conversationId, options);
  return sdk.resumeSession(args.agentId!, options);
}

function createRemoteLettaSession(args: Args): LettaSession {
  if (!args.agentId) {
    throw new Error(
      "remote backend requires an agent id: pass --agent <id> or set LETTA_AGENT_ID (e.g. Rocky's agent id)",
    );
  }
  return new RemoteLettaSession({
    baseURL: args.serverUrl,
    agentId: args.agentId,
    ...(args.apiKey ? { apiKey: args.apiKey } : {}),
    model: args.model,
    logger: (line) => console.error(`[letta-synchronize] ${line}`),
  });
}

async function createLocalLettaSession(args: Args): Promise<LettaSession> {
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
