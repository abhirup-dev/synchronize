import { Letta } from "@letta-ai/letta-client";
import type { LettaInit, LettaSession, LettaStreamMessage } from "./runtime.ts";

export interface RemoteLettaSessionOptions {
  baseURL: string;
  agentId: string;
  apiKey?: string;
  /** Optional override label; the agent's configured model is authoritative. */
  model?: string;
  logger?: (message: string) => void;
}

/**
 * Drives a live agent on a remote Letta *server* (the agent platform) over its
 * REST API, as opposed to the local Letta Code SDK harness.
 *
 * The runtime contract (`LettaSession`) is request/response per job: the runtime
 * calls `send()` then iterates `stream()` until a `result` message arrives. We
 * map that onto a single streaming `messages.create` call and translate the
 * server's typed chunk protocol — `reasoning_message` / `tool_call_message` /
 * `tool_return_message` / `assistant_message`, terminated by `stop_reason` +
 * `usage_statistics` — into the flat `LettaStreamMessage` shape the runtime reads.
 */
export class RemoteLettaSession implements LettaSession {
  private readonly client: Letta;
  private readonly agentId: string;
  private readonly modelHint: string | undefined;
  private readonly log: (message: string) => void;
  private pendingPrompt: string | null = null;
  private aborter: AbortController | null = null;
  private currentRunId: string | null = null;

  constructor(options: RemoteLettaSessionOptions) {
    this.agentId = options.agentId;
    this.modelHint = options.model;
    this.log = options.logger ?? (() => {});
    this.client = new Letta({
      baseURL: options.baseURL,
      // Server runs with SECURE=false; the SDK still wants a non-empty token.
      apiKey: options.apiKey && options.apiKey !== "" ? options.apiKey : "none",
    });
  }

  async initialize(): Promise<LettaInit> {
    const agent = await this.client.agents.retrieve(this.agentId);
    const tools = Array.isArray(agent.tools)
      ? agent.tools.map((tool) => tool.name).filter((name): name is string => Boolean(name))
      : [];
    return {
      agentId: agent.id,
      // Remote agents are inherently persistent; the agent id *is* the session.
      sessionId: agent.id,
      conversationId: agent.id,
      model: agent.llm_config?.model ?? this.modelHint ?? "",
      tools,
    };
  }

  async send(message: string): Promise<void> {
    this.pendingPrompt = message;
  }

  async *stream(): AsyncIterable<LettaStreamMessage> {
    const prompt = this.pendingPrompt;
    this.pendingPrompt = null;
    if (prompt === null) return;

    this.aborter = new AbortController();
    this.currentRunId = null;
    const assistantChunks: string[] = [];
    let stopReason: string | null = null;

    let stream: AsyncIterable<RemoteStreamChunk>;
    try {
      stream = (await this.client.agents.messages.create(
        this.agentId,
        { messages: [{ role: "user", content: prompt }], streaming: true },
        { signal: this.aborter.signal },
      )) as AsyncIterable<RemoteStreamChunk>;
    } catch (error) {
      yield { type: "result", success: false, error: formatError(error) };
      this.reset();
      return;
    }

    try {
      for await (const chunk of stream) {
        if (typeof chunk.run_id === "string" && chunk.run_id) this.currentRunId = chunk.run_id;
        switch (chunk.message_type) {
          case "assistant_message": {
            const content = normalizeContent(chunk.content);
            if (content) {
              assistantChunks.push(content);
              yield { type: "assistant", content };
            }
            break;
          }
          case "reasoning_message":
            if (typeof chunk.reasoning === "string" && chunk.reasoning.trim()) {
              this.log(`reasoning: ${truncate(chunk.reasoning, 160)}`);
            }
            break;
          case "tool_call_message":
            if (chunk.tool_call?.name) this.log(`tool_call: ${chunk.tool_call.name}`);
            break;
          case "tool_return_message":
            if (chunk.status) this.log(`tool_return: ${chunk.status}`);
            break;
          case "stop_reason":
            stopReason = chunk.stop_reason ?? null;
            break;
          case "usage_statistics":
            // terminal marker; ignore
            break;
          default:
            break;
        }
      }
    } catch (error) {
      const aborted = this.aborter?.signal.aborted ?? false;
      yield {
        type: "result",
        success: false,
        error: aborted ? "interrupted" : formatError(error),
      };
      this.reset();
      return;
    }

    const result = assistantChunks.join("\n\n").trim();
    if (isErrorStopReason(stopReason) && !result) {
      yield { type: "result", success: false, error: `letta stop_reason: ${stopReason}` };
    } else {
      yield { type: "result", success: true, result };
    }
    this.reset();
  }

  async abort(): Promise<void> {
    this.aborter?.abort();
    const runId = this.currentRunId;
    if (runId) {
      try {
        await this.client.agents.messages.cancel(this.agentId, { run_ids: [runId] });
        this.log(`cancelled run ${runId}`);
      } catch (error) {
        this.log(`cancel run ${runId} failed: ${formatError(error)}`);
      }
    }
  }

  close(): void {
    this.aborter?.abort();
    this.reset();
  }

  private reset(): void {
    this.aborter = null;
    this.currentRunId = null;
  }
}

interface RemoteStreamChunk {
  message_type: string;
  run_id?: string;
  content?: unknown;
  reasoning?: string;
  tool_call?: { name?: string };
  status?: string;
  stop_reason?: string;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

// Stop reasons that indicate the turn ended without a usable answer.
const ERROR_STOP_REASONS = new Set(["error", "llm_api_error", "invalid_tool_call", "cancelled", "no_tool_call"]);

function isErrorStopReason(reason: string | null): boolean {
  return reason !== null && ERROR_STOP_REASONS.has(reason);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
