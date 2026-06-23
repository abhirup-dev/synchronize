import { completeDynamicProvider } from "../completion/dynamic.ts";
import type { CompletionContext, DynamicCompletionProvider } from "../completion/types.ts";
import { installTabCompletion } from "../completion/install.ts";
import { isTabShell, renderTabCompletions, renderTabSetupScript } from "../completion/render-tab.ts";
import { parseFlags } from "../flags.ts";

export async function run(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "tab") {
    const [tabSubcommand, ...tabRest] = rest;
    if (tabSubcommand === "complete") {
      const separator = tabRest.indexOf("--");
      const args = separator >= 0 ? tabRest.slice(separator + 1) : tabRest;
      process.stdout.write(await renderTabCompletions(args));
      return;
    }
    if (!isTabShell(tabSubcommand)) throw new Error("completion tab requires a shell: zsh | bash | fish | powershell");
    process.stdout.write(renderTabSetupScript(tabSubcommand));
    return;
  }
  if (subcommand === "complete") {
    const [providerRaw, ...flagArgs] = rest;
    const provider = parseProvider(providerRaw);
    const args = parseFlags(flagArgs);
    const context = args.flags.context ? parseContext(args.flags.context) : undefined;
    const candidates = await completeDynamicProvider(provider, { ...(context ? { context } : {}) });
    if (args.flags.format === "tab") {
      process.stdout.write(formatTabCandidates(candidates));
      return;
    }
    if (args.flags.format && args.flags.format !== "json") {
      throw new Error("--format must be json or tab");
    }
    process.stdout.write(`${JSON.stringify(candidates)}\n`);
    return;
  }
  if (subcommand === "install") {
    const args = parseFlags(rest);
    if (!isTabShell(args.flags.shell)) throw new Error("completion install requires --shell zsh | bash | fish | powershell");
    const result = await installTabCompletion(args.flags.shell);
    console.log(`Installed Tab completion script: ${result.path}`);
    console.log(`Shell setup: ${result.sourceHint}`);
    return;
  }
  throw new Error("completion requires a subcommand: tab | complete | install");
}

function formatTabCandidates(candidates: Array<{ value: string; description?: string }>): string {
  const lines = candidates.map((candidate) => candidate.description ? `${candidate.value}\t${candidate.description}` : candidate.value);
  lines.push(":4");
  return `${lines.join("\n")}\n`;
}

function parseProvider(raw: string | undefined): DynamicCompletionProvider {
  if (
    raw === "group-names" ||
    raw === "peer-ids" ||
    raw === "session-ids" ||
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
