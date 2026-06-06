import { afterEach, expect, test } from "bun:test";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { createGroup, joinGroup, listGroups, listMyGroups } from "../src/api/groups.ts";
import { cleanupDaemonHomes, startDaemon } from "./support/daemon.ts";

afterEach(cleanupDaemonHomes);

test("GET /groups?member returns only the peer's active groups with alias + joined_at", async () => {
  const daemon = await startDaemon();
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "sess-mine-1",
      sessionName: "alice",
    });
    const peerId = binding.peer_id;

    await createGroup(daemon.client, { name: "alpha", creatorPeerId: peerId });
    await createGroup(daemon.client, { name: "beta" }); // peer is NOT a member of beta
    await joinGroup(daemon.client, { name: "alpha", peerId, alias: "alice" });

    const all = await listGroups(daemon.client);
    expect(all.groups.map((g) => g.name).sort()).toEqual(["alpha", "beta"]);

    const mine = await listMyGroups(daemon.client, peerId);
    expect(mine.groups).toHaveLength(1);
    expect(mine.groups[0]?.name).toBe("alpha");
    expect(mine.groups[0]?.alias).toBe("alice");
    expect(typeof mine.groups[0]?.joined_at).toBe("string");
  } finally {
    await daemon.stop();
  }
});
