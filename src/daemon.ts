import { main } from "./daemon/server.ts";

export { main, reconcileLaunch } from "./daemon/server.ts";
export { deactivateStoppedLaunchPeer, upsertPeer } from "./daemon/repo/peers.ts";
export type { DaemonContext } from "./daemon/server.ts";

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
