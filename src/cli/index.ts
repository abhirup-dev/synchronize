import * as dm from "./commands/dm.ts";
import * as group from "./commands/group.ts";
import * as inbox from "./commands/inbox.ts";
import * as media from "./commands/media.ts";
import * as peers from "./commands/peers.ts";
import * as register from "./commands/register.ts";
import * as status from "./commands/status.ts";
import * as top from "./commands/top.ts";
import * as whoami from "./commands/whoami.ts";
import { printHelp } from "./help.ts";

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "status":
      await status.run(rest);
      return;
    case "top":
    case "summary":
      await top.run(rest);
      return;
    case "register":
      await register.run(rest);
      return;
    case "whoami":
      await whoami.run(rest);
      return;
    case "peers":
      await peers.run(rest);
      return;
    case "dm":
      await dm.run(rest);
      return;
    case "inbox":
      await inbox.run(rest);
      return;
    case "group":
      await group.run(rest);
      return;
    case "media":
      await media.run(rest);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(2);
  }
}
