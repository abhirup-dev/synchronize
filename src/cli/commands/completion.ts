import { renderCarapaceSpec } from "../completion/render-carapace.ts";

export async function run(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (subcommand === "carapace") {
    process.stdout.write(renderCarapaceSpec());
    return;
  }
  throw new Error("completion requires a subcommand: carapace");
}
