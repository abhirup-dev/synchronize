import { sendDm } from "../../api/inbox.ts";
import { ensureDaemon } from "../../client.ts";
import { requireIdentity } from "../identity.ts";
import { printCliRealtimeWarning } from "../warnings.ts";

export async function run(argv: string[]): Promise<void> {
  const [recipient, ...messageParts] = argv;
  const message = messageParts.join(" ").trim();
  if (!recipient || !message) throw new Error("dm requires PEER MESSAGE");
  const client = await ensureDaemon();
  const identity = await requireIdentity(client);
  const response = await sendDm(client, {
    senderPeerId: identity.peer_id,
    recipientPeerId: recipient,
    message,
  });
  printCliRealtimeWarning();
  console.log(JSON.stringify(response.event, null, 2));
}
