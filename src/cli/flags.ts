export interface ParsedFlags {
  flags: Record<string, string>;
  boolFlags: Set<string>;
  rest: string[];
}

export function parseFlags(argv: string[]): ParsedFlags {
  const flags: Record<string, string> = {};
  const boolFlags = new Set<string>();
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      if (arg) rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      boolFlags.add(name);
      continue;
    }
    flags[name] = next;
    index += 1;
  }
  return { flags, boolFlags, rest };
}
