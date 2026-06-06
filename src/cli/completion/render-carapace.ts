import { cliSchema, type CliCommandSpec, type CliFlagSpec, type CliSchema, type CliValueSpec } from "../schema.ts";

interface CarapaceCommand {
  name: string;
  aliases?: string[];
  description?: string;
  flags?: Record<string, string>;
  completion?: {
    flag?: Record<string, string[]>;
    positional?: string[][];
    positionalany?: string[];
    dashany?: string[];
  };
  commands?: CarapaceCommand[];
}

export function renderCarapaceSpec(schema: CliSchema = cliSchema): string {
  return `${JSON.stringify(toCarapaceCommand(schema), null, 2)}\n`;
}

function toCarapaceCommand(command: CliSchema | CliCommandSpec): CarapaceCommand {
  const flags = "flags" in command && command.flags ? renderFlags(command.flags) : undefined;
  const flagCompletion = "flags" in command && command.flags ? renderFlagCompletions(command.flags) : undefined;
  const positional = "positionals" in command && command.positionals ? command.positionals.map((item) => renderValue(item.value)) : undefined;
  const dashany = "passthrough" in command && command.passthrough ? ["$files"] : undefined;
  const subcommands = getSubcommands(command);
  const completion = compactCompletion({
    ...(flagCompletion && Object.keys(flagCompletion).length > 0 ? { flag: flagCompletion } : {}),
    ...(positional && positional.some((item) => item.length > 0) ? { positional } : {}),
    ...(dashany ? { dashany } : {}),
  });
  return compactCommand({
    name: command.name,
    ...("aliases" in command && command.aliases ? { aliases: command.aliases } : {}),
    description: command.description,
    ...(flags && Object.keys(flags).length > 0 ? { flags } : {}),
    ...(completion ? { completion } : {}),
    ...(subcommands ? { commands: subcommands.map(toCarapaceCommand) } : {}),
  });
}

function getSubcommands(command: CliSchema | CliCommandSpec): CliCommandSpec[] | undefined {
  return isCliSchema(command) ? command.commands : command.subcommands;
}

function isCliSchema(command: CliSchema | CliCommandSpec): command is CliSchema {
  return "environment" in command;
}

function renderFlags(flags: CliFlagSpec[]): Record<string, string> {
  const rendered: Record<string, string> = {};
  for (const flag of flags) {
    rendered[renderFlagKey(flag)] = flag.description;
  }
  return rendered;
}

function renderFlagCompletions(flags: CliFlagSpec[]): Record<string, string[]> {
  const rendered: Record<string, string[]> = {};
  for (const flag of flags) {
    const values = renderValue(flag.value);
    if (values.length > 0) rendered[flag.name] = values;
  }
  return rendered;
}

function renderFlagKey(flag: CliFlagSpec): string {
  const suffix = flag.boolean ? "" : "=";
  return `--${flag.name}${suffix}`;
}

function renderValue(value: CliValueSpec | undefined): string[] {
  if (!value) return [];
  if (value.kind === "enum") return value.values;
  if (value.kind === "file") return ["$files"];
  if (value.kind === "directory") return ["$directories"];
  return [`$(synchronize completion complete ${value.provider} --format carapace)`];
}

function compactCommand(command: CarapaceCommand): CarapaceCommand {
  const compacted: CarapaceCommand = {
    name: command.name,
    ...(command.aliases && command.aliases.length > 0 ? { aliases: command.aliases } : {}),
    ...(command.description ? { description: command.description } : {}),
    ...(command.flags ? { flags: command.flags } : {}),
    ...(command.completion ? { completion: command.completion } : {}),
    ...(command.commands && command.commands.length > 0 ? { commands: command.commands } : {}),
  };
  return compacted;
}

function compactCompletion(completion: CarapaceCommand["completion"]): CarapaceCommand["completion"] | undefined {
  if (!completion) return undefined;
  if (
    !completion.flag &&
    !completion.positional &&
    !completion.positionalany &&
    !completion.dashany
  ) {
    return undefined;
  }
  return completion;
}
