import { z } from "zod";
import { launchAgent, stopAgent } from "../../api/agent-sessions.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerLaunchTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_launch",
    {
      description:
        "Spawn a new persistent agent session (claude or pi) via the local backend (AOE). " +
        "Pass `group` to drop the teammate straight into a synchronize group — it auto-joins on " +
        "boot under alias = name (the group is created if absent); omit `group` for a standalone agent. " +
        "`repo` is the working directory the agent runs in. Put tool-specific flags (e.g. --model) in `args`. " +
        "Returns: { launchId, peerId, sessionName, title, group?, pendingCount, warning? }. The session " +
        "registers itself a few seconds later; poll bridge_list_peers(group) to see it come online. " +
        "Idempotency: each call spawns a new session — names must be unique within a group.",
      inputSchema: {
        tool: z.enum(["claude", "pi"]),
        name: z.string().min(1),
        repo: z.string().min(1),
        group: z.string().optional(),
        args: z.array(z.string()).optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await launchAgent(client, {
          tool: args.tool,
          name: args.name,
          repo: args.repo,
          ...(args.group ? { group: args.group } : {}),
          ...(args.args ? { args: args.args } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_stop",
    {
      description:
        "Stop a persistent agent session spawned via bridge_launch. Pass the `title` returned by " +
        "bridge_launch (works even before the agent registered), or a `peer_id` for a known session. " +
        "Kills only the backend/tmux session — the peer's durable identity and group history remain. " +
        "Returns: { stopped, title, peer_id? }.",
      inputSchema: {
        title: z.string().optional(),
        peer_id: z.string().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      if (args.title) return text(await stopAgent(client, { title: args.title }));
      if (args.peer_id) return text(await stopAgent(client, { peerId: args.peer_id }));
      throw new Error("bridge_stop requires title or peer_id");
    }),
  );
}
