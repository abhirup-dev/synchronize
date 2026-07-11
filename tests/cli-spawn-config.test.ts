import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { registerPeer } from "../src/api/peers.ts";
import { run as runSpawn } from "../src/cli/commands/spawn.ts";
import { cleanupDaemonHomes, startDaemon, type TestDaemon } from "./support/daemon.ts";

const realHome = process.env.SYNCHRONIZE_HOME;
let daemon: TestDaemon | null = null;

beforeEach(() => {
  daemon = null;
});

afterEach(async () => {
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
  if (realHome === undefined) delete process.env.SYNCHRONIZE_HOME;
  else process.env.SYNCHRONIZE_HOME = realHome;
});

afterAll(async () => {
  await cleanupDaemonHomes();
});

test("configured remote Letta spawn refuses an already-running peer with the same session name", async () => {
  daemon = await startDaemon();
  process.env.SYNCHRONIZE_HOME = daemon.home;
  await writeFile(
    join(daemon.home, "config.toml"),
    `
[remote.vpsme]
ssh_host = "vpsme"
runtime_path = "~/synchronize-letta-test"
expose = "ssh-reverse"
remote_port = 58455

[letta.server.vps]
remote = "vpsme"
base_url = "http://127.0.0.1:8283"

[agent.rocky]
tool = "letta"
server = "vps"
session_name = "rocky"
agent_id = "agent-123"
conversation_id = "default"
poll_ms = 1000
`,
  );
  const { peer } = await registerPeer(daemon.client, { sessionName: "rocky", tool: "letta" });

  await expect(runSpawn(["letta", "--name", "rocky"])).rejects.toThrow(
    `configured letta agent 'rocky' is already running as 'rocky' (peer ${peer.peer_id})`,
  );
});
