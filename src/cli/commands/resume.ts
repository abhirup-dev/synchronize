import { resumeGroup, resumeSession } from "../../api/resume.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";

// `synchronize resume launch --peer-id P | --session-id S [--force] [--print]`
// `synchronize resume show  --peer-id P | --session-id S`   (alias for --print)
// `synchronize resume group <NAME> [--only a,b] [--exclude a,b] [--force] [--print]`
//
// Like archive, resume is an operator action on a target identity/group; no --as.
export async function run(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("resume requires a subcommand: launch | show | group");

  if (subcommand === "launch" || subcommand === "show") {
    const args = parseFlags(argv.slice(1));
    const peerId = args.flags["peer-id"];
    const sessionId = args.flags["session-id"];
    if (!peerId && !sessionId) throw new Error(`resume ${subcommand} requires --peer-id or --session-id`);
    const client = await ensureDaemon();
    const result = await resumeSession(client, {
      ...(peerId ? { peerId } : {}),
      ...(sessionId ? { sessionId } : {}),
      // `resume show` always prints; `resume launch` prints only with --print.
      print: subcommand === "show" || args.boolFlags.has("print"),
      force: args.boolFlags.has("force"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "group") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("resume group requires NAME");
    const args = parseFlags(rest);
    const only = args.flags.only ? args.flags.only.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const exclude = args.flags.exclude ? args.flags.exclude.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const client = await ensureDaemon();
    const result = await resumeGroup(client, {
      group: name,
      print: args.boolFlags.has("print"),
      force: args.boolFlags.has("force"),
      ...(only ? { only } : {}),
      ...(exclude ? { exclude } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown resume subcommand: ${subcommand}`);
}
