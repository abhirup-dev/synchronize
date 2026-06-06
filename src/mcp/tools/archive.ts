import { z } from "zod";
import { archiveGroup, archiveSession, listArchived } from "../../api/archive.ts";
import { resumeGroup, resumeSession } from "../../api/resume.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

// Admin-style archive/resume tools for a MANAGING agent. Unlike the other
// bridge_* tools, these are NOT scoped to the caller's own membership — a
// managing agent may archive/resume a session or group it does not belong to,
// on the operator's behalf. They go through the same daemon endpoints and return
// the same failure codes (peer_not_archived, cwd_missing, peer_still_live, …) as
// the CLI. --force is an explicit boolean, never defaulted. See sync-cmw2.1.
export function registerArchiveTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_archive_session",
    {
      description:
        "Archive one agent session (freeze its identity, reserve its alias seats, reap its AOE runtime) " +
        "so it can be faithfully resumed later. Admin-style: you need NOT be a member of its groups. " +
        "Identify it by `peer_id` or `session_id` (host session id). `dry_run` reports what would happen " +
        "without mutating. Returns the per-session outcome incl. reserved aliases and a resume hint.",
      inputSchema: {
        peer_id: z.string().optional(),
        session_id: z.string().optional(),
        reason: z.string().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await archiveSession(client, {
          ...(args.peer_id ? { peerId: args.peer_id } : {}),
          ...(args.session_id ? { sessionId: args.session_id } : {}),
          ...(args.reason ? { reason: args.reason } : {}),
          ...(args.dry_run ? { dryRun: true } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_archive_group",
    {
      description:
        "Archive a whole group as a unit — every active member is archived (AOE members reaped, " +
        "non-AOE probed) and every alias reserved. Admin-style: you need NOT be a member. Returns a " +
        "PER-MEMBER status list (action: archived | already_archived | would_archive | skipped); a " +
        "partial outcome is never collapsed to one bit. `dry_run` previews without mutating.",
      inputSchema: {
        group: z.string().min(1),
        reason: z.string().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await archiveGroup(client, {
          group: args.group,
          ...(args.reason ? { reason: args.reason } : {}),
          ...(args.dry_run ? { dryRun: true } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_resume_session",
    {
      description:
        "Resume one archived session, faithfully continuing its prior conversation. Identify by " +
        "`peer_id` or `session_id`. `mode`='launch' spawns it via AOE in its original cwd; `mode`='print' " +
        "returns the exact command+env+cwd for you to hand the operator to run themselves. Validation may " +
        "return peer_not_archived, cwd_missing, or peer_still_live (a live process blocks resume). Set " +
        "`force`=true to terminate a still-live process before resuming (it KILLS the running process). " +
        "Admin-style: membership not required.",
      inputSchema: {
        peer_id: z.string().optional(),
        session_id: z.string().optional(),
        mode: z.enum(["launch", "print"]).optional(),
        force: z.boolean().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await resumeSession(client, {
          ...(args.peer_id ? { peerId: args.peer_id } : {}),
          ...(args.session_id ? { sessionId: args.session_id } : {}),
          print: args.mode === "print",
          ...(args.force ? { force: true } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_resume_group",
    {
      description:
        "Resume a whole archived group — relaunch each launchable member, reporting a PER-MEMBER outcome " +
        "(launching | printed | skipped | blocked). Inspect-only members are skipped; a still-live zombie " +
        "is blocked. `mode`='launch'|'print'. `only`/`exclude` filter by alias. `force` terminates live " +
        "processes before resuming. Admin-style: membership not required.",
      inputSchema: {
        group: z.string().min(1),
        mode: z.enum(["launch", "print"]).optional(),
        force: z.boolean().optional(),
        only: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await resumeGroup(client, {
          group: args.group,
          print: args.mode === "print",
          ...(args.force ? { force: true } : {}),
          ...(args.only ? { only: args.only } : {}),
          ...(args.exclude ? { exclude: args.exclude } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_list_archived",
    {
      description:
        "List every archived (resumable) identity with its reserved alias seats, archived_at, reason, and " +
        "source. Use this to discover what can be resumed. Returns { sessions: [...] }.",
      inputSchema: {},
    },
    wrap(async () => {
      const client = await getClient(state);
      return text(await listArchived(client));
    }),
  );
}
