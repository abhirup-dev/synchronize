import { requestJson, type ClientConfig } from "../client.ts";
import type { EventQueryResponse, SqlParam } from "./types.ts";

export function queryEvents(
  client: ClientConfig,
  input: { sql: string; params?: SqlParam[]; limit?: number },
): Promise<EventQueryResponse> {
  return requestJson<EventQueryResponse>(client, "/query/events", {
    method: "POST",
    body: JSON.stringify({
      sql: input.sql,
      ...(input.params !== undefined ? { params: input.params } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
  });
}
