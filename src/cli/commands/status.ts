import { getStatus } from "../../api/status.ts";
import { ensureDaemon } from "../../client.ts";

export async function run(_argv: string[]): Promise<void> {
  const client = await ensureDaemon();
  const status = await getStatus(client);
  console.log(JSON.stringify({ ...status, daemon_started_by_cli: client.started }, null, 2));
}
