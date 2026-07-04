import { afterAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { startTestDaemon } from "./helpers/daemon.ts";
import { listAgentSessions, registerAgentSession, setAgentModel } from "../src/api/agent-sessions.ts";

// setAgentModel updates the model on an agent-session binding (glass revamp
// Phase 5 — the agent-profile model picker's daemon backing). Integration-style
// against a real daemon over the REST surface.

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

test("setAgentModel updates the binding's model and reads back", async () => {
  const daemon = await startTestDaemon();
  homes.push(daemon.home);
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-setmodel-1",
      sessionName: "atlas",
      tool: "claude",
      model: "claude-sonnet-4-6",
    });
    expect(binding.model).toBe("claude-sonnet-4-6");

    const updated = await setAgentModel(daemon.client, { peerId: binding.peer_id, model: "claude-opus-4-8" });
    expect(updated.binding.model).toBe("claude-opus-4-8");

    // Persisted: a fresh read shows the new model.
    const { bindings } = await listAgentSessions(daemon.client, { peerId: binding.peer_id });
    expect(bindings[0]?.model).toBe("claude-opus-4-8");

    // host_tool/host_session_id form resolves the same binding.
    const viaHost = await setAgentModel(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-setmodel-1",
      model: "claude-haiku-4-5-20251001",
    });
    expect(viaHost.binding.model).toBe("claude-haiku-4-5-20251001");
  } finally {
    await daemon.stop();
  }
});

test("setAgentModel rejects an empty model (400) and an unknown peer (404)", async () => {
  const daemon = await startTestDaemon();
  homes.push(daemon.home);
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-setmodel-2",
      sessionName: "cortex",
      tool: "claude",
      model: "gpt-5.5",
    });

    await expect(setAgentModel(daemon.client, { peerId: binding.peer_id, model: "" })).rejects.toThrow();
    await expect(setAgentModel(daemon.client, { peerId: "no-such-peer", model: "claude-opus-4-8" })).rejects.toThrow();
  } finally {
    await daemon.stop();
  }
});
