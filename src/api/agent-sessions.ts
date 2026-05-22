import { requestJson, type ClientConfig } from "../client.ts";
import type { AgentSessionBinding } from "./types.ts";

export interface RegisterAgentSessionInput {
  peerId?: string;
  sessionName?: string;
  purpose?: string;
  tool?: string;
  hostTool: string;
  hostSessionId: string;
  hostSessionFile?: string | undefined;
  cwd?: string | undefined;
  pid?: number | undefined;
  source?: string | undefined;
  model?: string | undefined;
  agentType?: string | undefined;
  metadata?: Record<string, unknown>;
  launchId?: string | undefined;
}

export function registerAgentSession(
  client: ClientConfig,
  input: RegisterAgentSessionInput,
): Promise<{ binding: AgentSessionBinding }> {
  return requestJson<{ binding: AgentSessionBinding }>(client, "/agent-sessions/register", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      session_name: input.sessionName,
      purpose: input.purpose,
      tool: input.tool,
      host_tool: input.hostTool,
      host_session_id: input.hostSessionId,
      host_session_file: input.hostSessionFile,
      cwd: input.cwd,
      pid: input.pid,
      source: input.source,
      model: input.model,
      agent_type: input.agentType,
      metadata: input.metadata,
      launch_id: input.launchId,
    }),
  });
}

export function listAgentSessions(
  client: ClientConfig,
  input: { hostTool?: string; peerId?: string; launchId?: string } = {},
): Promise<{ bindings: AgentSessionBinding[] }> {
  const params = new URLSearchParams();
  if (input.hostTool) params.set("tool", input.hostTool);
  if (input.peerId) params.set("peer_id", input.peerId);
  if (input.launchId) params.set("launch_id", input.launchId);
  const query = params.toString();
  return requestJson<{ bindings: AgentSessionBinding[] }>(client, `/agent-sessions${query ? `?${query}` : ""}`);
}

export function renameAgentSession(
  client: ClientConfig,
  input:
    | { peerId: string; sessionName: string; hostTool?: never; hostSessionId?: never }
    | { hostTool: string; hostSessionId: string; sessionName: string; peerId?: never },
): Promise<{ binding: AgentSessionBinding }> {
  return requestJson<{ binding: AgentSessionBinding }>(client, "/agent-sessions/rename", {
    method: "POST",
    body: JSON.stringify({
      peer_id: "peerId" in input ? input.peerId : undefined,
      host_tool: "hostTool" in input ? input.hostTool : undefined,
      host_session_id: "hostSessionId" in input ? input.hostSessionId : undefined,
      session_name: input.sessionName,
    }),
  });
}
