import * as archive from "./commands/archive.ts";
import * as dm from "./commands/dm.ts";
import * as group from "./commands/group.ts";
import * as host from "./commands/host.ts";
import * as hook from "./commands/hook.ts";
import * as inbox from "./commands/inbox.ts";
import * as launch from "./commands/launch.ts";
import * as media from "./commands/media.ts";
import * as completion from "./commands/completion.ts";
import * as peers from "./commands/peers.ts";
import * as query from "./commands/query.ts";
import * as register from "./commands/register.ts";
import * as resume from "./commands/resume.ts";
import * as remote from "./commands/remote.ts";
import * as spawn from "./commands/spawn.ts";
import * as status from "./commands/status.ts";
import * as threads from "./commands/threads.ts";
import * as top from "./commands/top.ts";
import * as whoami from "./commands/whoami.ts";
import { printHelp } from "./help.ts";

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "help") {
    printHelp(rest);
    return;
  }
  const helpIndex = rest.findIndex((arg) => arg === "--help" || arg === "-h" || arg === "help");
  const passthroughIndex = rest.indexOf("--");
  if (helpIndex >= 0 && (passthroughIndex < 0 || helpIndex < passthroughIndex)) {
    printHelp([command, ...rest.slice(0, helpIndex)]);
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
    case "archive":
      await archive.run(rest);
      return;
    case "resume":
      await resume.run(rest);
      return;
    case "host":
      await host.run(rest);
      return;
    case "hook":
      await hook.run(rest);
      return;
    case "launch":
      await launch.run(rest);
      return;
    case "spawn":
      await spawn.run(rest);
      return;
    case "media":
      await media.run(rest);
      return;
    case "query":
      await query.run(rest);
      return;
    case "threads":
      await threads.run(rest);
      return;
    case "remote":
      await remote.run(rest);
      return;
    case "completion":
      await completion.run(rest);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(2);
  }
}
