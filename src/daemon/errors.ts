import { HttpError } from "../http.ts";

export function mapSqliteConstraint(error: unknown, code: string, message: string): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("UNIQUE constraint failed") || text.includes("constraint failed")) {
    return new HttpError(409, code, message);
  }
  return error instanceof Error ? error : new Error(text);
}
