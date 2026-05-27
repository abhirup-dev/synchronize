import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { resolveMcpRegisterPeerId } from "../src/mcp/lifecycle.ts";
import { ensurePeer } from "../src/mcp/state.ts";
import { ENV_LAUNCH_ID, ENV_PEER_ID } from "../src/constants.ts";
import type { ClientConfig } from "../src/client.ts";
import type { AdapterState } from "../src/mcp/state.ts";

const previousPeerId = process.env[ENV_PEER_ID];
const previousLaunchId = process.env[ENV_LAUNCH_ID];
const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

afterEach(() => {
  if (previousPeerId === undefined) delete process.env[ENV_PEER_ID];
  else process.env[ENV_PEER_ID] = previousPeerId;
  if (previousLaunchId === undefined) delete process.env[ENV_LAUNCH_ID];
  else process.env[ENV_LAUNCH_ID] = previousLaunchId;
});

test("resolveMcpRegisterPeerId honors SYNCHRONIZE_PEER_ID from env", async () => {
  process.env[ENV_PEER_ID] = "peer-from-env-abc";
  const state: AdapterState = {
    client: null,
    peer: null,
    notifier: null,
    subscription: null,
    heartbeat: null,
  };
  // Stub client — must not be reached because env short-circuits the lookup.
  const client = { baseUrl: "http://unreachable.invalid", token: null } as unknown as ClientConfig;
  const peerId = await resolveMcpRegisterPeerId(client, state, "any-session", "pi");
  expect(peerId).toBe("peer-from-env-abc");
});

test("resolveMcpRegisterPeerId does not reuse Claude or Pi peers by session name alone", async () => {
  delete process.env[ENV_PEER_ID];
  const state: AdapterState = {
    client: null,
    peer: null,
    notifier: null,
    subscription: null,
    heartbeat: null,
  };
  const client = { baseUrl: "http://unreachable.invalid", token: null } as unknown as ClientConfig;

  await expect(resolveMcpRegisterPeerId(client, state, "shared-name", "claude")).resolves.toBeUndefined();
  await expect(resolveMcpRegisterPeerId(client, state, "shared-name", "pi")).resolves.toBeUndefined();
});

test("ensurePeer attaches an env-bound agent session when adapter state is empty", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-env-bound-peer-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const launchId = "launch-env-bound-peer";
    const registered = await registerAgentSession(daemon.client, {
      hostTool: "pi",
      hostSessionId: "pi-native-session",
      sessionName: "gamma",
      tool: "pi",
      launchId,
    });
    delete process.env[ENV_PEER_ID];
    process.env[ENV_LAUNCH_ID] = launchId;
    const state: AdapterState = {
      client: null,
      peer: null,
      notifier: null,
      subscription: null,
      heartbeat: null,
    };

    const peer = await ensurePeer(state, daemon.client);

    expect(peer.peer_id).toBe(registered.binding.peer_id);
    expect(state.peer?.session_name).toBe("gamma");
  } finally {
    await daemon.stop();
  }
});

async function startDaemon(home: string): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          client: { baseUrl: discovery.baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
          stop: async () => {
            proc.kill();
            await proc.exited;
          },
        };
      }
    } catch {
      await Bun.sleep(50);
    }
  }
  proc.kill();
  await proc.exited;
  throw new Error("daemon did not start");
}
