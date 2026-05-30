import { getThread, getThreadStatus, getThreadSummary, listThreads, postThreadSummary } from "../../api/threads.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";

export async function run(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (!subcommand) throw new Error("threads requires a subcommand");
  const client = await ensureDaemon();

  if (subcommand === "list") {
    const args = parseFlags(rest);
    const limit = parseOptionalPositiveInt(args.flags.limit, "--limit");
    const response = await listThreads(client, {
      ...(args.flags.group ? { group: args.flags.group } : {}),
      ...(args.flags["started-by-peer-id"] ? { startedByPeerId: args.flags["started-by-peer-id"] } : {}),
      ...(args.flags["started-by-session-name"] ? { startedBySessionName: args.flags["started-by-session-name"] } : {}),
      ...(args.flags["participated-by-peer-id"] ? { participatedByPeerId: args.flags["participated-by-peer-id"] } : {}),
      ...(args.flags["participated-by-session-name"] ? { participatedBySessionName: args.flags["participated-by-session-name"] } : {}),
      ...(args.flags["active-since"] ? { activeSince: args.flags["active-since"] } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "status") {
    const [rootEventIdRaw] = rest;
    const rootEventId = parseRequiredPositiveInt(rootEventIdRaw, "threads status requires ROOT_EVENT_ID");
    console.log(JSON.stringify(await getThreadStatus(client, rootEventId), null, 2));
    return;
  }

  if (subcommand === "show") {
    const [rootEventIdRaw, ...flagArgs] = rest;
    const rootEventId = parseRequiredPositiveInt(rootEventIdRaw, "threads show requires ROOT_EVENT_ID");
    const args = parseFlags(flagArgs);
    const format = args.flags.format ?? "json";
    if (format !== "json" && format !== "transcript") throw new Error("--format must be json or transcript");
    const response = await getThread(client, { rootEventId, format });
    if (format === "transcript") {
      console.log(response.transcript ?? "");
      return;
    }
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "summary") {
    const [rootEventIdRaw, ...flagArgs] = rest;
    const rootEventId = parseRequiredPositiveInt(rootEventIdRaw, "threads summary requires ROOT_EVENT_ID");
    const args = parseFlags(flagArgs);
    const refresh = args.flags.refresh === "true" || args.flags.refresh === "";
    const format = args.flags.format ?? "text";
    if (format !== "text" && format !== "json") throw new Error("--format must be text or json");
    const response = refresh
      ? await postThreadSummary(client, {
          rootEventId,
          ...(args.flags.strategy ? { strategy: args.flags.strategy } : {}),
          ...(args.flags.k ? { k: parseRequiredPositiveInt(args.flags.k, "--k must be a positive integer") } : {}),
          ...(args.flags["first-k"] ? { first_k: parseRequiredPositiveInt(args.flags["first-k"], "--first-k must be a positive integer") } : {}),
          ...(args.flags["last-k"] ? { last_k: parseRequiredPositiveInt(args.flags["last-k"], "--last-k must be a positive integer") } : {}),
        })
      : await getThreadSummary(client, rootEventId);
    if (format === "json") {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    if (response.status === "disabled") {
      console.log("(thread summaries disabled — set OPENROUTER_API_KEY to enable)");
      return;
    }
    if (response.status === "pending") {
      console.log("(no summary yet — pass --refresh to compute one now)");
      return;
    }
    console.log(response.summary ?? "");
    if (response.stale) console.error("(stale — newer events have landed since this summary)");
    return;
  }

  throw new Error(`Unknown threads subcommand: ${subcommand}`);
}

function parseOptionalPositiveInt(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  return parseRequiredPositiveInt(raw, `${label} must be a positive integer`);
}

function parseRequiredPositiveInt(raw: string | undefined, message: string): number {
  const value = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(message);
  return value;
}
