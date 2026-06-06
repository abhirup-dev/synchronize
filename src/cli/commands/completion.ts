import { renderCarapaceSpec } from "../completion/render-carapace.ts";
import { completeDynamicProvider } from "../completion/dynamic.ts";
import type { CompletionContext, DynamicCompletionProvider } from "../completion/types.ts";
import { installCarapaceCompletion } from "../completion/install.ts";
import { parseFlags } from "../flags.ts";

export async function run(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "carapace") {
    process.stdout.write(renderCarapaceSpec());
    return;
  }
  if (subcommand === "complete") {
    const [providerRaw, ...flagArgs] = rest;
    const provider = parseProvider(providerRaw);
    const args = parseFlags(flagArgs);
    const context = args.flags.context ? parseContext(args.flags.context) : undefined;
    const candidates = await completeDynamicProvider(provider, { ...(context ? { context } : {}) });
    if (args.flags.format === "carapace") {
      process.stdout.write(candidates.map(formatCarapaceCandidate).join("\n"));
      if (candidates.length > 0) process.stdout.write("\n");
      return;
    }
    if (args.flags.format && args.flags.format !== "json") {
      throw new Error("--format must be json or carapace");
    }
    process.stdout.write(`${JSON.stringify(candidates)}\n`);
    return;
  }
  if (subcommand === "install") {
    const args = parseFlags(rest);
    if (args.flags.shell !== "carapace") {
      throw new Error("completion install requires --shell carapace");
    }
    const result = await installCarapaceCompletion();
    console.log(`Installed Carapace spec: ${result.path}`);
    return;
  }
  throw new Error("completion requires a subcommand: carapace | complete | install");
}

function formatCarapaceCandidate(candidate: { value: string; description?: string }): string {
  return candidate.description ? `${candidate.value}\t${candidate.description}` : candidate.value;
}

function parseProvider(raw: string | undefined): DynamicCompletionProvider {
  if (
    raw === "group-names" ||
    raw === "peer-ids" ||
    raw === "session-names" ||
    raw === "media-ids" ||
    raw === "thread-root-event-ids"
  ) {
    return raw;
  }
  throw new Error("completion complete requires a valid provider");
}

function parseContext(raw: string): CompletionContext {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--context must be a JSON object");
  }
  const context: CompletionContext = {};
  const group = (parsed as { group?: unknown }).group;
  if (group !== undefined) {
    if (typeof group !== "string") throw new Error("--context.group must be a string");
    context.group = group;
  }
  return context;
}
