import { ZodError } from "zod";
import { ApiError } from "../client.ts";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

export function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function log(message: string): void {
  console.error(`[synchronize-mcp] ${message}`);
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ErrorPayload {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export function errorPayload(error: unknown): ErrorPayload {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof ZodError) {
    return { code: "invalid_argument", message: error.message, details: { issues: error.issues } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "internal_error", message };
}

// Wrap every bridge_* handler so thrown ApiErrors (HTTP + client validation)
// and ZodErrors (schema mismatches) surface as MCP isError results whose text
// content is a JSON envelope { error: { code, message, status?, details? } }.
// Callers can JSON.parse the text and branch on `code` deterministically.
export function wrap<Args>(
  handler: (args: Args) => Promise<ToolResult>,
): (args: Args) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: errorPayload(error) }, null, 2) }],
        isError: true,
      };
    }
  };
}

// Convenience: throw an ApiError shaped like an HTTP 400 from client-side
// validation paths so consumers see the same `code` discipline as wire errors.
export function invalidArgument(message: string): never {
  throw new ApiError(400, "invalid_argument", message);
}
