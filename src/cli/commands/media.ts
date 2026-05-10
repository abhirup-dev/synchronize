import { getMedia, listMedia, shareMedia } from "../../api/media.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { requireIdentity } from "../identity.ts";
import { printCliRealtimeWarning } from "../warnings.ts";

export async function run(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("media requires a subcommand");

  if (subcommand === "share") {
    const [group, file, ...rest] = argv.slice(1);
    if (!group || !file) throw new Error("media share requires GROUP FILE");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await shareMedia(client, {
      group,
      sharedByPeerId: identity.peer_id,
      path: file,
      ...(args.flags.description ? { description: args.flags.description } : {}),
    });
    printCliRealtimeWarning();
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "list") {
    const [group, ...rest] = argv.slice(1);
    if (!group) throw new Error("media list requires GROUP");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const response = await listMedia(client, { group, ...(args.flags.query ? { query: args.flags.query } : {}) });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "get") {
    const [mediaId] = argv.slice(1);
    if (!mediaId) throw new Error("media get requires MEDIA_ID");
    const client = await ensureDaemon();
    const response = await getMedia(client, mediaId);
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  throw new Error(`Unknown media subcommand: ${subcommand}`);
}
