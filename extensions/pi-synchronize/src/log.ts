const enabled = process.env.SYNCHRONIZE_PI_DEBUG === "1";

export function log(message: string): void {
  if (enabled) console.error(`[synchronize-pi] ${message}`);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
