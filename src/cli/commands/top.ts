import { getSummary } from "../../api/status.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { renderSummary } from "../render/summary.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const client = await ensureDaemon();
  const intervalSeconds = args.flags.interval ? Number.parseFloat(args.flags.interval) : 1;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("--interval must be a positive number of seconds");
  }

  if (args.boolFlags.has("json")) {
    const summary = await getSummary(client);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (args.boolFlags.has("once") || !process.stdout.isTTY) {
    const summary = await getSummary(client);
    console.log(renderSummary(summary));
    return;
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write("\x1b[?25l");
  try {
    while (!stopped) {
      const summary = await getSummary(client);
      process.stdout.write("\x1b[H\x1b[2J");
      process.stdout.write(renderSummary(summary));
      process.stdout.write("\n\nPress Ctrl-C to quit.");
      await Bun.sleep(intervalSeconds * 1000);
    }
  } finally {
    process.stdout.write("\x1b[?25h\n");
  }
}
