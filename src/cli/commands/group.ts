import { createGroup, getGroupHistory, joinGroup, leaveGroup, renameInGroup, sendGroupMessage } from "../../api/groups.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { requireIdentity } from "../identity.ts";
import { printCliRealtimeWarning } from "../warnings.ts";

export async function run(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("group requires a subcommand");

  if (subcommand === "create") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group create requires NAME");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    if (!args.flags.as) throw new Error("group create requires --as SESSION_NAME to confirm the CLI peer identity");
    const identity = await requireIdentity(client, args.flags.as);
    const response = await createGroup(client, {
      name,
      ephemeral: args.boolFlags.has("ephemeral"),
      creatorPeerId: identity.peer_id,
    });
    console.log(JSON.stringify(response.group, null, 2));
    return;
  }

  if (subcommand === "join") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group join requires NAME");
    const args = parseFlags(rest);
    const alias = args.flags.alias;
    if (!args.flags.as) throw new Error("group join requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await joinGroup(client, {
      name,
      peerId: identity.peer_id,
      fresh: args.boolFlags.has("fresh"),
      ...(alias ? { alias } : {}),
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "leave") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group leave requires NAME");
    const args = parseFlags(rest);
    if (!args.flags.as) throw new Error("group leave requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await leaveGroup(client, { name, peerId: identity.peer_id });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "rename") {
    const [name, newAlias, ...rest] = argv.slice(1);
    if (!name || !newAlias) throw new Error("group rename requires NAME NEW_ALIAS");
    const args = parseFlags(rest);
    if (!args.flags.as) throw new Error("group rename requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await renameInGroup(client, { name, peerId: identity.peer_id, newAlias });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "send") {
    const [name, ...messageParts] = argv.slice(1);
    const args = parseFlags(messageParts);
    if (!args.flags.as) throw new Error("group send requires --as SESSION_NAME to confirm the CLI peer identity");
    const message = args.rest.join(" ").trim();
    if (!name || !message) throw new Error("group send requires NAME MESSAGE");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await sendGroupMessage(client, { name, senderPeerId: identity.peer_id, message });
    printCliRealtimeWarning();
    console.log(JSON.stringify(response.event, null, 2));
    return;
  }

  if (subcommand === "history") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group history requires NAME");
    const args = parseFlags(rest);
    if (!args.flags.as) throw new Error("group history requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await getGroupHistory(client, { name, peerId: identity.peer_id });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  throw new Error(`Unknown group subcommand: ${subcommand}`);
}
