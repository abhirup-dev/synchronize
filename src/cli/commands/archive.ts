import { archiveGroup, archiveSession } from "../../api/archive.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";

// `synchronize archive session --peer-id P | --session-id S [--reason R] [--dry-run]`
// `synchronize archive group <NAME> [--reason R] [--dry-run]`
//
// Archive is an OPERATOR/admin action on a target identity or group — it is not
// scoped to a caller's own membership, so it takes no --as identity.
export async function run(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("archive requires a subcommand: session | group");

  if (subcommand === "session") {
    const args = parseFlags(argv.slice(1));
    const peerId = args.flags["peer-id"];
    const sessionId = args.flags["session-id"];
    if (!peerId && !sessionId) throw new Error("archive session requires --peer-id or --session-id");
    const client = await ensureDaemon();
    const result = await archiveSession(client, {
      ...(peerId ? { peerId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(args.flags.reason ? { reason: args.flags.reason } : {}),
      dryRun: args.boolFlags.has("dry-run"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "group") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("archive group requires NAME");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const result = await archiveGroup(client, {
      group: name,
      ...(args.flags.reason ? { reason: args.flags.reason } : {}),
      dryRun: args.boolFlags.has("dry-run"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown archive subcommand: ${subcommand}`);
}
