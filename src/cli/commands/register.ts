import { registerPeer } from "../../api/peers.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { resolveCliRegisterPeerId, writeIdentity } from "../identity.ts";
import { printCliRealtimeWarning } from "../warnings.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const name = args.flags.name;
  if (!name) throw new Error("register requires --name NAME");
  const client = await ensureDaemon();
  const peerId = await resolveCliRegisterPeerId(client, name);
  const response = await registerPeer(client, {
    sessionName: name,
    tool: "cli",
    ...(peerId ? { peerId } : {}),
    ...(args.flags.purpose ? { purpose: args.flags.purpose } : {}),
  });
  await writeIdentity(client, {
    peer_id: response.peer.peer_id,
    session_name: response.peer.session_name,
  });
  printCliRealtimeWarning();
  console.log(JSON.stringify(response.peer, null, 2));
}
