import { useMemo, type ReactNode } from "react";
import { DataSourceProvider } from "../data/context.tsx";
import { MockDataSource } from "../data/mock.ts";
import { AGENTS } from "../data/seed.ts";
import { createSnapshot } from "../data/store.ts";
import type { Agent } from "../data/types.ts";

export const agentsWithRuntimeDetails: Agent[] = AGENTS.map((agent) => {
  if (agent.id === "you" || agent.role === "web") return agent;
  const toolById: Record<string, string> = {
    atlas: "claude",
    cortex: "codex",
    vega: "opencode",
    nova: "pi",
    echo: "letta",
    pulse: "python",
    mira: "web",
    jay: "codex",
  };
  const modelById: Record<string, string> = {
    atlas: "claude-sonnet-4-6",
    cortex: "gpt-5.5",
    vega: "gpt-5-codex",
    nova: "pi-coding-agent",
    echo: "letta-code-sdk",
    pulse: "analytics-worker",
    mira: "human-peer",
    jay: "gpt-5.5",
  };
  const tool = toolById[agent.id] ?? "unknown";
  const model = modelById[agent.id] ?? "unknown";
  const sessionId =
    agent.id === "atlas"
      ? "72be6e11-67ee-4195-9c2b-14f2c6a8e93d"
      : `${agent.id}-session-2026-06-23`;
  return {
    ...agent,
    role: tool === "web" ? agent.role : tool,
    ...(agent.id === "atlas" ? { statusNote: "Testing/observer" } : {}),
    runtimeDetails: {
      peerId: agent.id,
      bindingId: `${tool}:${sessionId}`,
      launchId: `launch-${agent.id}-preview`,
      profileName: agent.id === "atlas" ? "claude-sonnet" : `${tool}-default`,
      tool,
      sessionName: agent.name,
      model,
      thinking: agent.status === "busy" ? "medium" : "low",
      source: "session_start",
      agentType: `${tool} session`,
      hostTool: tool,
      hostSessionId: sessionId,
      machineId: "MTPL-7638",
      cwd: agent.id === "vega" ? "/Users/dev/work/infrastructure" : "/Users/dev/work/synchronize",
      gitBranch: agent.id === "vega" ? "main" : "codex/agent-preview",
      gitDirty: agent.status === "busy",
      launchState: agent.status === "offline" ? "stopped" : "running",
      backendTitle: agent.id,
      updatedAt: "2026-06-23T10:30:00.000Z",
    },
  };
});

export function RuntimeDetailsProvider({ children }: { children: ReactNode }) {
  const ds = useMemo(() => {
    const source = new MockDataSource();
    const agents = createSnapshot(agentsWithRuntimeDetails);
    const scoped = source as MockDataSource & { agents: () => ReturnType<MockDataSource["agents"]> };
    scoped.agents = () => agents;
    return scoped;
  }, []);
  return <DataSourceProvider value={ds}>{children}</DataSourceProvider>;
}
