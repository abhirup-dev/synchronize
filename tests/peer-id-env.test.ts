import { afterEach, expect, test } from "bun:test";
import { resolveMcpRegisterPeerId } from "../src/mcp/lifecycle.ts";
import { ENV_PEER_ID } from "../src/constants.ts";
import type { ClientConfig } from "../src/client.ts";
import type { AdapterState } from "../src/mcp/state.ts";

const previous = process.env[ENV_PEER_ID];

afterEach(() => {
  if (previous === undefined) delete process.env[ENV_PEER_ID];
  else process.env[ENV_PEER_ID] = previous;
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
