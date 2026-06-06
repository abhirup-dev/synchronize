import { cliSchema, type CliCommandSpec } from "./schema.ts";

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

export function printHelp(): void {
  console.log(renderHelp());
}

function renderCommandSummary(command: CliCommandSpec): string {
  return `  ${command.name.padEnd(10)} ${command.description}`;
}
