import { ensureDaemon } from "../../client.ts";
import { requireIdentity } from "../identity.ts";

export async function run(_argv: string[]): Promise<void> {
  const client = await ensureDaemon();
  const identity = await requireIdentity(client);
  console.log(JSON.stringify(identity, null, 2));
}
