import { script, ShellCompDirective } from "@bomb.sh/tab";
import { cliSchema, type CliCommandSpec, type CliSchema, type CliValueSpec } from "../schema.ts";
import { completeDynamicProvider } from "./dynamic.ts";
import type { CompletionCandidate, CompletionContext } from "./types.ts";

export const TAB_SHELLS = ["zsh", "bash", "fish", "powershell"] as const;
export type TabShell = (typeof TAB_SHELLS)[number];

interface MatchResult {
  command: CliSchema | CliCommandSpec;
  consumed: number;
}

interface CompletionResult {
  candidates: CompletionCandidate[];
  directive: number;
  prefix?: string;
}

const NO_FILE = ShellCompDirective.ShellCompDirectiveNoFileComp;
const FILTER_DIRS = ShellCompDirective.ShellCompDirectiveFilterDirs;
const DEFAULT = ShellCompDirective.ShellCompDirectiveDefault;

export function isTabShell(raw: string | undefined): raw is TabShell {
  return TAB_SHELLS.includes(raw as TabShell);
}

export function renderTabSetupScript(
  shell: TabShell,
  options: { name?: string; executable?: string } = {},
): string {
  const name = options.name ?? cliSchema.name;
  const executable = options.executable ?? `${cliSchema.name} completion tab`;
  let output = "";
  const originalWrite = process.stdout.write;
  const originalLog = console.log;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  console.log = (...values: unknown[]) => {
    output += `${values.map(String).join(" ")}\n`;
  };
  try {
    script(shell, name, executable);
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
  return output;
}

export async function renderTabCompletions(args: string[], schema: CliSchema = cliSchema): Promise<string> {
  const normalizedArgs = normalizeTabArgs(args);
  return formatCompletionResult(await completeTabArgs(normalizedArgs, schema), completionPrefix(normalizedArgs));
}

async function completeTabArgs(args: string[], schema: CliSchema): Promise<CompletionResult> {
  const current = args.at(-1) ?? "";
  const previous = args.length > 0 ? args.slice(0, -1) : [];
  const match = matchCommand(previous, schema);
  const command = match.command;

  if (isAfterPassthrough(previous, match)) return { candidates: [], directive: DEFAULT };

  const currentFlagValue = parseCurrentFlagValue(current);
  if (currentFlagValue) {
    const flag = findFlag(command, currentFlagValue.name);
    return completeValue(flag?.value, currentFlagValue.partial, completionContext(command, previous, match));
  }

  const previousFlag = previous.at(-1);
  if (previousFlag) {
    const flagName = parseFlagName(previousFlag);
    const flag = flagName ? findFlag(command, flagName) : undefined;
    if (flag && !flag.boolean && !previousFlag.includes("=")) {
      return completeValue(flag.value, current, completionContext(command, previous, match));
    }
  }

  if (current.startsWith("-")) {
    const currentFlagName = parseFlagName(current);
    const currentFlag = currentFlagName ? findFlag(command, currentFlagName) : undefined;
    if (currentFlag && !currentFlag.boolean) {
      const result = await completeValue(currentFlag.value, "", completionContext(command, previous, match));
      return {
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          value: `--${currentFlag.name}=${candidate.value}`,
        })),
        directive: result.directive,
        prefix: current,
      };
    }
    return completeFlags(command, current);
  }

  const subcommands = subcommandsOf(command);
  if (subcommands.length > 0) {
    return {
      candidates: subcommands
        .filter((subcommand) => matchesPrefix(subcommand, current))
        .map((subcommand) => ({ value: subcommand.name, description: subcommand.description })),
      directive: NO_FILE,
    };
  }

  return completePositional(command, previous.slice(match.consumed), current, completionContext(command, previous, match));
}

function matchCommand(tokens: string[], schema: CliSchema): MatchResult {
  let command: CliSchema | CliCommandSpec = schema;
  let consumed = 0;
  while (consumed < tokens.length) {
    const token = tokens[consumed];
    if (!token || token === "--" || token.startsWith("-")) break;
    const next = subcommandsOf(command).find((subcommand) => matchesName(subcommand, token));
    if (!next) break;
    command = next;
    consumed += 1;
  }
  return { command, consumed };
}

function isAfterPassthrough(previous: string[], match: MatchResult): boolean {
  const command = match.command;
  if (!("passthrough" in command) || !command.passthrough) return false;
  return previous.slice(match.consumed).includes(command.passthrough.marker);
}

function completeFlags(command: CliSchema | CliCommandSpec, current: string): CompletionResult {
  const prefix = current.replace(/^-+/, "");
  const candidates = flagsOf(command)
    .filter((flag) => `--${flag.name}`.startsWith(current) || flag.name.startsWith(prefix))
    .map((flag) => ({ value: `--${flag.name}`, description: flag.description }));
  return { candidates, directive: NO_FILE };
}

async function completePositional(
  command: CliSchema | CliCommandSpec,
  previousAfterCommand: string[],
  current: string,
  context: CompletionContext | undefined,
): Promise<CompletionResult> {
  if (!("positionals" in command) || !command.positionals) return { candidates: [], directive: NO_FILE };
  const positionals = command.positionals;
  const index = positionalTokens(previousAfterCommand, command).length;
  const spec = positionals[index] ?? positionals.at(-1);
  if (!spec || (!spec.variadic && index >= positionals.length)) return { candidates: [], directive: NO_FILE };
  return completeValue(spec.value, current, context);
}

async function completeValue(
  value: CliValueSpec | undefined,
  prefix: string,
  context: CompletionContext | undefined,
): Promise<CompletionResult> {
  if (!value) return { candidates: [], directive: NO_FILE };
  if (value.kind === "enum") {
    return {
      candidates: value.values.map((item) => ({ value: item })).filter((item) => item.value.startsWith(prefix)),
      directive: NO_FILE,
    };
  }
  if (value.kind === "file") return { candidates: [], directive: DEFAULT };
  if (value.kind === "directory") return { candidates: [], directive: FILTER_DIRS };
  const candidates = await completeDynamicProvider(value.provider, { ...(context ? { context } : {}) });
  return { candidates: candidates.filter((item) => item.value.startsWith(prefix)), directive: NO_FILE };
}

function positionalTokens(tokens: string[], command: CliSchema | CliCommandSpec): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token === "--") break;
    if (token.startsWith("--")) {
      const flagName = parseFlagName(token);
      const flag = flagName ? findFlag(command, flagName) : undefined;
      if (flag && !flag.boolean && !token.includes("=")) i += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}

function completionContext(command: CliSchema | CliCommandSpec, previous: string[], match: MatchResult): CompletionContext | undefined {
  if (!("name" in command) || command.name !== "media") return undefined;
  const tokens = positionalTokens(previous.slice(match.consumed), command);
  return tokens[0] ? { group: tokens[0] } : undefined;
}

function parseCurrentFlagValue(current: string): { name: string; partial: string } | null {
  const match = current.match(/^--([^=]+)=(.*)$/);
  if (!match) return null;
  return { name: match[1]!, partial: match[2] ?? "" };
}

function normalizeTabArgs(args: string[]): string[] {
  const normalized = [...args];
  while (normalized.length >= 2 && normalized.at(-1) === "" && normalized.at(-2) === "") {
    normalized.splice(normalized.length - 2, 1);
  }
  return normalized;
}

function parseFlagName(token: string): string | null {
  const match = token.match(/^--([^=]+)(?:=.*)?$/);
  return match?.[1] ?? null;
}

function findFlag(command: CliSchema | CliCommandSpec, name: string) {
  return flagsOf(command).find((flag) => flag.name === name);
}

function flagsOf(command: CliSchema | CliCommandSpec) {
  return "flags" in command && command.flags ? command.flags : [];
}

function subcommandsOf(command: CliSchema | CliCommandSpec): CliCommandSpec[] {
  return "environment" in command ? command.commands : command.subcommands ?? [];
}

function matchesName(command: CliCommandSpec, token: string): boolean {
  return command.name === token || (command.aliases ?? []).includes(token);
}

function matchesPrefix(command: CliCommandSpec, token: string): boolean {
  return command.name.startsWith(token) || (command.aliases ?? []).some((alias) => alias.startsWith(token));
}

function completionPrefix(args: string[]): string {
  const current = args.at(-1) ?? "";
  const flagValue = parseCurrentFlagValue(current);
  return flagValue ? flagValue.partial : current;
}

function formatCompletionResult(result: CompletionResult, prefix: string): string {
  const effectivePrefix = result.prefix ?? prefix;
  const seen = new Set<string>();
  const lines = result.candidates
    .filter((candidate) => candidate.value.startsWith(effectivePrefix))
    .filter((candidate) => {
      if (seen.has(candidate.value)) return false;
      seen.add(candidate.value);
      return true;
    })
    .map(formatCandidate);
  lines.push(`:${result.directive}`);
  return `${lines.join("\n")}\n`;
}

function formatCandidate(candidate: CompletionCandidate): string {
  const value = candidate.value.replaceAll("\n", " ");
  if (!candidate.description) return value;
  return `${value}\t${candidate.description.replaceAll("\n", " ")}`;
}
