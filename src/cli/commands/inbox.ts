import { ackInbox, readInbox } from "../../api/inbox.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { requireIdentity } from "../identity.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const client = await ensureDaemon();
  const identity = await requireIdentity(client);
  const response = await readInbox(client, identity.peer_id);
  if (args.boolFlags.has("ack") && response.events.length > 0) {
    await ackInbox(client, identity.peer_id, response.events.map((event) => event.event_id));
  }
  console.log(JSON.stringify(response, null, 2));
}
