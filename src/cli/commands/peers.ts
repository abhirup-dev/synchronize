import { listPeers } from "../../api/peers.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const client = await ensureDaemon();
  const response = await listPeers(client, args.flags.group ? { group: args.flags.group } : {});
  console.log(JSON.stringify(response.peers, null, 2));
}
