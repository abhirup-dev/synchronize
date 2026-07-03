// Shared tool taxonomy + synchronize-event extraction. Both decoders call these
// so classification stays identical across agents (the plan's "shared classifier
// parameterized by a taxonomy table"). Ported from the prototype parsers.

export type ToolFamily = "shell" | "filesystem" | "web" | "agent" | "mcp" | "other";

export interface ToolClass {
  category: "tool" | "mcp";
  family: ToolFamily;
  normalizedTool: string;
  toolServer: string | null;
}

const SHELL = new Set(["Bash", "Shell", "Terminal", "bash", "shell"]);
const FILESYSTEM = new Set([
  "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "NotebookEdit",
  "read", "write", "edit", "glob", "grep", "ls",
]);
const WEB = new Set(["WebFetch", "WebSearch", "web_search", "web_fetch"]);
const AGENT = new Set([
  "Task", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskOutput", "TaskStop", "Agent",
]);

// Classify a raw tool name into a stable family + normalized name + server.
// MCP tools arrive either as Claude's `mcp__<server>__<tool>` or Pi's
// `<server>_bridge_<tool>` / `synchronize_bridge_<tool>`; both normalize to the
// bare tool name with the server pulled out.
export function classifyTool(rawName: string): ToolClass {
  const raw = rawName ?? "";

  // Claude MCP: mcp__<server>__<tool>
  const mcpMatch = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(raw);
  if (mcpMatch) {
    return { category: "mcp", family: "mcp", normalizedTool: mcpMatch[2]!, toolServer: mcpMatch[1]! };
  }
  // Pi MCP: <server>_bridge_<tool> (synchronize_bridge_send_group → bridge_send_group, server=synchronize)
  const piBridge = /^([a-z0-9]+)_(bridge_.+)$/.exec(raw);
  if (piBridge) {
    return { category: "mcp", family: "mcp", normalizedTool: piBridge[2]!, toolServer: piBridge[1]! };
  }

  if (SHELL.has(raw)) return { category: "tool", family: "shell", normalizedTool: raw, toolServer: null };
  if (FILESYSTEM.has(raw)) return { category: "tool", family: "filesystem", normalizedTool: raw, toolServer: null };
  if (WEB.has(raw)) return { category: "tool", family: "web", normalizedTool: raw, toolServer: null };
  if (AGENT.has(raw)) return { category: "tool", family: "agent", normalizedTool: raw, toolServer: null };
  return { category: "tool", family: "other", normalizedTool: raw, toolServer: null };
}

const FAMILY_CALL_KIND: Record<ToolFamily, string> = {
  shell: "shell_tool_call",
  filesystem: "filesystem_tool_call",
  web: "web_tool_call",
  agent: "agent_tool_call",
  mcp: "mcp_tool_call",
  other: "tool_call",
};

// Kind for a tool CALL annotation given its family.
export function toolCallKind(cls: ToolClass): string {
  if (cls.family === "mcp" && cls.toolServer === "synchronize") return "synchronize_mcp_tool_call";
  return FAMILY_CALL_KIND[cls.family];
}

export interface SyncEvent {
  kind: "synchronize_channel" | "synchronize_event";
  attrs: Record<string, string>;
  body: string;
}

const CHANNEL_RE = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
const SYNC_EVENT_RE = /<synchronize_event\b([^>]*)>([\s\S]*?)<\/synchronize_event>/g;
const ATTR_RE = /([\w-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) attrs[m[1]!] = m[2]!;
  return attrs;
}

// Pull embedded synchronize envelopes out of a message text block. Returns one
// SyncEvent per <channel …> or <synchronize_event …> match.
export function extractSynchronizeEvents(text: string): SyncEvent[] {
  if (!text || (!text.includes("<channel") && !text.includes("<synchronize_event"))) return [];
  const out: SyncEvent[] = [];
  let m: RegExpExecArray | null;
  CHANNEL_RE.lastIndex = 0;
  while ((m = CHANNEL_RE.exec(text)) !== null) {
    out.push({ kind: "synchronize_channel", attrs: parseAttrs(m[1]!), body: m[2]!.trim() });
  }
  SYNC_EVENT_RE.lastIndex = 0;
  while ((m = SYNC_EVENT_RE.exec(text)) !== null) {
    out.push({ kind: "synchronize_event", attrs: parseAttrs(m[1]!), body: m[2]!.trim() });
  }
  return out;
}

// Short, single-line human summary for an annotation. Mirrors the prototypes'
// truncation (no newlines, capped length).
export function summarize(text: string | null | undefined, max = 120): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
