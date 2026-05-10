export function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function log(message: string): void {
  console.error(`[synchronize-mcp] ${message}`);
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
