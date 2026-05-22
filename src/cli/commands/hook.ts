import { registerAgentSession } from "../../api/agent-sessions.ts";
import { ensureDaemon } from "../../client.ts";
import { ENV_HOOK_ENABLE, ENV_LAUNCH_ID, ENV_SESSION_NAME } from "../../constants.ts";

interface ClaudeHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  source?: string;
  model?: string;
  agent_type?: string;
  [key: string]: unknown;
}

interface PiHookInput {
  session_id?: string;
  session_name?: string;
  session_file?: string;
  cwd?: string;
  source?: string;
  [key: string]: unknown;
}

export async function run(argv: string[]): Promise<void> {
  const [target] = argv;
  if (target === "claude-session") {
    await runClaudeHook();
    return;
  }
  if (target === "pi-session") {
    await runPiHook();
    return;
  }
  throw new Error("hook requires one of: claude-session, pi-session");
}

async function runClaudeHook(): Promise<void> {
  if (process.env[ENV_HOOK_ENABLE] !== "1") {
    return;
  }
  const input = await readHookInput<ClaudeHookInput>();
  const hostSessionId = requireField(input, "session_id");
  const client = await ensureDaemon();
  const sessionName = process.env[ENV_SESSION_NAME] ?? generateSessionName("claude");
  const response = await registerAgentSession(client, {
    hostTool: "claude",
    hostSessionId,
    pid: process.ppid,
    sessionName,
    tool: "claude",
    purpose: "claude session",
    metadata: compactMetadata(input),
    ...(process.env[ENV_LAUNCH_ID] ? { launchId: process.env[ENV_LAUNCH_ID] } : {}),
    ...(stringOrUndefined(input.transcript_path) ? { hostSessionFile: stringOrUndefined(input.transcript_path) } : {}),
    ...(stringOrUndefined(input.cwd) ? { cwd: stringOrUndefined(input.cwd) } : {}),
    ...(stringOrUndefined(input.source) ? { source: stringOrUndefined(input.source) } : {}),
    ...(stringOrUndefined(input.model) ? { model: stringOrUndefined(input.model) } : {}),
    ...(stringOrUndefined(input.agent_type) ? { agentType: stringOrUndefined(input.agent_type) } : {}),
  });
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function runPiHook(): Promise<void> {
  const input = await readHookInput<PiHookInput>();
  const hostSessionId = requireField(input, "session_id");
  const client = await ensureDaemon();
  const response = await registerAgentSession(client, {
    hostTool: "pi",
    hostSessionId,
    pid: process.ppid,
    sessionName: process.env[ENV_SESSION_NAME] ?? stringOrUndefined(input.session_name) ?? generateSessionName("pi"),
    tool: "pi",
    purpose: "pi-coding-agent session",
    metadata: compactMetadata(input),
    ...(process.env[ENV_LAUNCH_ID] ? { launchId: process.env[ENV_LAUNCH_ID] } : {}),
    ...(stringOrUndefined(input.session_file) ? { hostSessionFile: stringOrUndefined(input.session_file) } : {}),
    ...(stringOrUndefined(input.cwd) ? { cwd: stringOrUndefined(input.cwd) } : {}),
    ...(stringOrUndefined(input.source) ? { source: stringOrUndefined(input.source) } : {}),
  });
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function readHookInput<T extends Record<string, unknown>>(): Promise<T> {
  const raw = await Bun.stdin.text();
  if (raw.trim() === "") throw new Error("hook expected JSON on stdin");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("hook input must be a JSON object");
  }
  return parsed as T;
}

function requireField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`hook input missing required ${key}`);
  }
  return value.trim();
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || typeof value === "function") continue;
    metadata[key] = value;
  }
  return metadata;
}

function generateSessionName(prefix: string): string {
  const adjectives = ["bright", "calm", "clear", "quick", "steady", "tidy"];
  const verbs = ["builds", "checks", "maps", "traces", "links", "writes"];
  const nouns = ["bridge", "cursor", "ledger", "signal", "thread", "worker"];
  const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)] ?? items[0]!;
  return `${prefix}-${pick(adjectives)}-${pick(verbs)}-${pick(nouns)}`;
}
