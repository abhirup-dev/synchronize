import type { Agent, AgentWorkState, AgentWorkStateHistoryEntry } from "./data/types.ts";

const PHASE_LABELS: Record<AgentWorkState["phase"], string> = {
  research: "Research",
  analysis: "Analysis",
  planning: "Planning",
  implementation: "Implementing",
  testing: "Testing",
  review: "Reviewing",
  coordination: "Coordinating",
  blocked: "Blocked",
  other: "Working",
};

export function phaseLabel(phase: AgentWorkState["phase"]): string {
  return PHASE_LABELS[phase] ?? phase;
}

export function workStateSummary(agent: Pick<Agent, "workState" | "workStateStatus">): string | null {
  if (agent.workState) return `${phaseLabel(agent.workState.phase)}: ${agent.workState.summary}`;
  if (agent.workStateStatus?.state === "stale") return "Work state expired";
  return null;
}

export function historyLabel(entry: AgentWorkStateHistoryEntry): string {
  const suffix = entry.clearedAt ? " cleared" : "";
  return `${phaseLabel(entry.phase)}${suffix}`;
}

export function formatRelativeTime(value?: string): string {
  if (!value) return "unknown";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unknown";
  const delta = Math.max(0, Date.now() - time);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
