import { cliSchema, type CliCommandSpec, type CliFlagSpec, type CliPositionalSpec } from "./schema.ts";

export function renderHelp(): string {
  const usage = cliSchema.usage.map((line) => `  ${line}`).join("\n");
  const commands = cliSchema.commands.map(renderCommandSummary).join("\n");
  const environment = cliSchema.environment.map((item) => `  ${item.name.padEnd(19)} ${item.description}`).join("\n");
  return `${cliSchema.name}

Usage:
${usage}

Commands:
${commands}

Environment:
${environment}
`;
}

export function renderCommandHelp(path: string[]): string {
  const match = findCommand(path);
  if (!match) {
    const requested = path.length ? ` ${path.join(" ")}` : "";
    return `Unknown help topic:${requested}\n\n${renderHelp()}`;
  }
  const { command, chain } = match;
  const fullName = [cliSchema.name, ...chain.map((item) => item.name)].join(" ");
  const aliases = command.aliases?.length ? `\nAliases: ${command.aliases.join(", ")}` : "";
  const usage = command.usage?.length
    ? `\nUsage:\n${command.usage.map((line) => `  ${line}`).join("\n")}\n`
    : "";
  const positionals = command.positionals?.length
    ? `\nArguments:\n${command.positionals.map(renderPositional).join("\n")}\n`
    : "";
  const flags = command.flags?.length
    ? `\nOptions:\n${command.flags.map(renderFlag).join("\n")}\n`
    : "";
  const subcommands = command.subcommands?.length
    ? `\nSubcommands:\n${command.subcommands.map(renderCommandSummary).join("\n")}\n`
    : "";
  const passthrough = command.passthrough
    ? `\nPassthrough:\n  ${command.passthrough.marker.padEnd(18)} ${command.passthrough.description}\n`
    : "";
  return `${fullName}

${command.description}${aliases}
${usage}${positionals}${flags}${subcommands}${passthrough}`;
}

export function printHelp(path: string[] = []): void {
  console.log(path.length ? renderCommandHelp(path) : renderHelp());
}

function renderCommandSummary(command: CliCommandSpec): string {
  return `  ${command.name.padEnd(10)} ${command.description}`;
}

function renderFlag(flag: CliFlagSpec): string {
  const suffix = flag.boolean ? "" : valueSuffix(flag.name);
  const repeat = flag.repeatable ? " repeatable" : "";
  const required = flag.required ? " required" : "";
  return `  --${`${flag.name}${suffix}`.padEnd(20)} ${flag.description}${required}${repeat}`;
}

function renderPositional(positional: CliPositionalSpec): string {
  const required = positional.required ? " required" : "";
  const variadic = positional.variadic ? " variadic" : "";
  return `  ${positional.name.padEnd(22)} ${positional.description}${required}${variadic}`;
}

function valueSuffix(name: string): string {
  if (name.endsWith("-ms")) return " MS";
  if (name.endsWith("url")) return " URL";
  if (name.endsWith("env")) return " ENV";
  if (name.endsWith("port")) return " PORT";
  if (name.endsWith("id")) return " ID";
  if (name === "repo" || name === "path") return " PATH";
  if (name === "home") return " PATH";
  if (name === "bind") return " HOST";
  if (name === "group") return " GROUP";
  if (name === "reason") return " TEXT";
  if (name === "only" || name === "exclude") return " ALIASES";
  if (name === "model") return " MODEL";
  if (name === "thinking") return " LEVEL";
  if (name === "letta-agent") return " SPEC";
  if (name === "token" || name === "letta-api-key") return " TOKEN";
  if (name === "scenario") return " SCENARIO";
  if (name === "name" || name === "as" || name === "alias" || name === "shell" || name === "format" || name === "strategy") return ` ${name.toUpperCase().replace(/-/g, "_")}`;
  return " VALUE";
}

function findCommand(path: string[]): { command: CliCommandSpec; chain: CliCommandSpec[] } | null {
  let commands = cliSchema.commands;
  const chain: CliCommandSpec[] = [];
  for (const segment of path) {
    const command = commands.find((item) => item.name === segment || item.aliases?.includes(segment));
    if (!command) return null;
    chain.push(command);
    commands = command.subcommands ?? [];
  }
  const command = chain.at(-1);
  return command ? { command, chain } : null;
}
