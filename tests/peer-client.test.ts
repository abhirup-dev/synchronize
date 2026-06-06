import { afterEach, expect, test } from "bun:test";
import { hostname } from "node:os";
import { registerPeer as registerApiPeer } from "../src/api/peers.ts";
import { registerPeer as registerPiPeer } from "../extensions/pi-synchronize/src/client.ts";
import type { ClientConfig } from "../src/client.ts";
import type { PiSyncClient } from "../extensions/pi-synchronize/src/client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("shared API registerPeer sends the client hostname as machine_id by default", async () => {
  const body = await captureRegisterBody(() =>
    registerApiPeer(apiClient(), {
      sessionName: "remote-cli",
      tool: "cli",
    }),
  );

  expect(body).toMatchObject({
    session_name: "remote-cli",
    tool: "cli",
    machine_id: hostname(),
  });
});

test("shared API registerPeer preserves explicit machine_id overrides", async () => {
  const body = await captureRegisterBody(() =>
    registerApiPeer(apiClient(), {
      sessionName: "remote-cli",
      tool: "cli",
      machineId: "vps",
    }),
  );

  expect(body.machine_id).toBe("vps");
});

test("Pi extension registerPeer sends the client hostname as machine_id by default", async () => {
  const body = await captureRegisterBody(() =>
    registerPiPeer(piClient(), {
      sessionName: "remote-pi",
      tool: "pi",
      purpose: "agent",
    }),
  );

  expect(body).toMatchObject({
    session_name: "remote-pi",
    tool: "pi",
    purpose: "agent",
    machine_id: hostname(),
  });
});

test("Pi extension registerPeer preserves explicit machine_id overrides", async () => {
  const body = await captureRegisterBody(() =>
    registerPiPeer(piClient(), {
      sessionName: "remote-pi",
      tool: "pi",
      machineId: "vps",
    }),
  );

  expect(body.machine_id).toBe("vps");
});

async function captureRegisterBody(call: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        peer: {
          peer_id: "peer-1",
          tool: captured.tool,
          session_name: captured.session_name,
          purpose: captured.purpose ?? null,
          machine_id: captured.machine_id,
          lease_expires_at: new Date().toISOString(),
          last_cursor: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          activity_state: null,
          last_activity_at: null,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  await call();
  if (!captured) throw new Error("fetch was not called");
  return captured;
}

function apiClient(): ClientConfig {
  return {
    baseUrl: "http://daemon.test",
    token: null,
    paths: {} as ClientConfig["paths"],
    started: false,
  };
}

function piClient(): PiSyncClient {
  return {
    baseUrl: "http://daemon.test",
    token: null,
  };
}
