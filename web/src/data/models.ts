// Single-source model registry for agent launch + model switching. Consumed by
// SpawnAgentDialog (launch-time picker) and the agent-profile model picker
// (glass revamp Phase 5) — keep them one source so the two pickers never drift.

import type { AgentLaunchTool } from "./types.ts";

export interface ModelOption {
  id: string;
  tool: AgentLaunchTool;
  label: string;
  model?: string;
  thinking?: string;
}

export const MODEL_OPTIONS: Record<AgentLaunchTool, ModelOption[]> = {
  claude: [
    { id: "claude-sonnet", tool: "claude", label: "Sonnet", model: "claude-sonnet-4-6", thinking: "medium" },
    { id: "claude-haiku", tool: "claude", label: "Haiku", model: "claude-haiku-4-5-20251001", thinking: "high" },
    { id: "claude-opus", tool: "claude", label: "Opus", model: "claude-opus-4-8", thinking: "medium" },
  ],
  pi: [
    { id: "pi-gpt-55-high", tool: "pi", label: "5.5 high", model: "gpt-5.5", thinking: "high" },
    { id: "pi-gpt-55-medium", tool: "pi", label: "5.5 medium", model: "gpt-5.5", thinking: "medium" },
    { id: "pi-gpt-55-low", tool: "pi", label: "5.5 low", model: "gpt-5.5", thinking: "low" },
    { id: "pi-gpt-54-mini", tool: "pi", label: "5.4 mini", model: "gpt-5.4-mini", thinking: "high" },
  ],
  letta: [
    { id: "letta-glm-47", tool: "letta", label: "GLM 4.7", model: "zai/glm-4.7" },
  ],
};

export const DEFAULT_MODEL_ID: Record<AgentLaunchTool, string> = {
  claude: "claude-sonnet",
  pi: "pi-gpt-55-medium",
  letta: "letta-glm-47",
};

// Compact display form for roster chips: strips provider prefixes and date
// suffixes ("claude-haiku-4-5-20251001" -> "claude-haiku-4-5", "zai/glm-4.7" -> "glm-4.7").
export function modelShort(model: string): string {
  return model.replace(/^zai\//, "").replace(/-\d{8}$/, "");
}
