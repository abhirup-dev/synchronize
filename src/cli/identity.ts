import { findReusablePeer } from "../api/status.ts";
import type { ensureDaemon } from "../client.ts";
import { readJson, writeJson } from "../fs.ts";

export interface CliIdentity {
  peer_id: string;
  session_name: string;
}

type Client = Awaited<ReturnType<typeof ensureDaemon>>;

export async function writeIdentity(client: Client, identity: CliIdentity): Promise<void> {
  await writeJson(client.paths.cliIdentityPath, identity);
}

export async function resolveCliRegisterPeerId(client: Client, sessionName: string): Promise<string | undefined> {
  const identity = await readJson<CliIdentity>(client.paths.cliIdentityPath);
  if (identity?.peer_id && identity.session_name === sessionName) return identity.peer_id;
  return findReusablePeer(client, { sessionName, tool: "cli" });
}

export async function requireIdentity(client: Client, expectedSessionName?: string): Promise<CliIdentity> {
  const identity = await readJson<CliIdentity>(client.paths.cliIdentityPath);
  if (!identity?.peer_id) {
    throw new Error("No CLI peer is registered. Run: synchronize register --name NAME");
  }
  if (expectedSessionName && identity.session_name !== expectedSessionName) {
    throw new Error(
      `CLI peer mismatch: expected session '${expectedSessionName}' but current CLI peer is '${identity.session_name}'. ` +
        `Run 'synchronize register --name ${expectedSessionName}' or use the matching --as value.`,
    );
  }
  return identity;
}
