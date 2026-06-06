import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from "../constants.ts";
import { HttpError } from "../http.ts";
import type { ThreadFormat } from "../api/types.ts";

export type GroupHistoryView = "flat" | "threads" | "events";

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_request", `${key} is required`);
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function optionalFormString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) {
    throw new HttpError(400, "invalid_request", `${key} must be an integer`);
  }
  return value as number;
}

export function requirePositiveInteger(body: Record<string, unknown>, key: string): number {
  const value = optionalInteger(body, key);
  if (value === undefined || value < 1) {
    throw new HttpError(400, "invalid_request", `${key} must be a positive integer`);
  }
  return value;
}

export type ReactionOp = "add" | "remove" | "toggle";

export function optionalReactionOp(body: Record<string, unknown>): ReactionOp {
  const value = body["op"];
  if (value === undefined || value === null) return "add";
  if (value === "add" || value === "remove" || value === "toggle") return value;
  throw new HttpError(400, "invalid_request", "op must be add, remove, or toggle");
}

export function requireEmoji(value: string): string {
  if (value.length > 32 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) {
    throw new HttpError(400, "invalid_emoji", "emoji must be a short emoji or emoji alias");
  }
  return value;
}

export function optionalSqlParams(body: Record<string, unknown>, key: string): Array<string | number | boolean | null> | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((item) => item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean")
  ) {
    throw new HttpError(400, "invalid_request", `${key} must be an array of strings, numbers, booleans, or nulls`);
  }
  return value as Array<string | number | boolean | null>;
}

export function optionalObjectJson(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `${key} must be an object`);
  }
  return JSON.stringify(value);
}

export function optionalIntegerArray(body: Record<string, unknown>, key: string): number[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new HttpError(400, "invalid_request", `${key} must be an array of positive integers`);
  }
  return value as number[];
}

export function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new HttpError(400, "invalid_request", `${key} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

export function requireLocalCallbackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "invalid_callback_url", "callback_url must be a valid URL");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    throw new HttpError(400, "invalid_callback_url", "callback_url must be an http localhost URL");
  }
  return url.toString();
}

export function requireGroupName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) {
    throw new HttpError(
      400,
      "invalid_group_name",
      "Group name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens",
    );
  }
  return name;
}

export function requireLaunchPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    throw new HttpError(400, "invalid_group_path", "Group path must be an absolute path");
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_PAGE_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "invalid_request", "limit must be a positive integer");
  }
  return Math.min(value, MAX_PAGE_LIMIT);
}

export function parseThreadFormat(raw: string | null): ThreadFormat {
  if (raw === null || raw === "") return "summary";
  if (raw === "summary" || raw === "status" || raw === "events" || raw === "transcript") return raw;
  if (raw === "json") {
    throw new HttpError(400, "invalid_request", "format=json was removed; use format=events");
  }
  throw new HttpError(400, "invalid_request", "format must be summary, status, events, or transcript");
}

export function parseGroupHistoryView(raw: string | null, hasEventIds: boolean): GroupHistoryView {
  if ((raw === null || raw === "") && hasEventIds) return "events";
  if (raw === null || raw === "") return "flat";
  if (raw === "flat" || raw === "threads" || raw === "events") return raw;
  throw new HttpError(400, "invalid_request", "view must be flat, threads, or events");
}

export function parseEventIdsParam(raw: string | null): number[] {
  if (raw === null || raw.trim() === "") {
    throw new HttpError(400, "invalid_request", "event_ids is required when view=events");
  }
  return raw.split(",").map((part) => {
    const value = Number.parseInt(part.trim(), 10);
    if (!Number.isInteger(value) || value < 1) {
      throw new HttpError(400, "invalid_request", "event_ids must contain positive integer event ids");
    }
    return value;
  });
}

export function parseCursor(raw: string | null): number {
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "invalid_request", "cursor must be a non-negative integer");
  }
  return value;
}
