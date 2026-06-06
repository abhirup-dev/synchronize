import { main } from "./daemon/server.ts";

export { deactivateStoppedLaunchPeer, main, reconcileLaunch, upsertPeer } from "./daemon/server.ts";
export type { DaemonContext } from "./daemon/server.ts";

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
