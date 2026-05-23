import type { Event } from "../../api/types.ts";
import { log } from "../util.ts";

// Wire `mentions_json` is a JSON-encoded string array of peer ids (sender
// already excluded by the daemon). Parsing it at the MCP boundary saves every
// consumer the JSON.parse + nullish-handling rigmarole. Surface as an empty
// array when null so consumers can branch on `.mentions.length` instead of
// `.mentions ?? []`. Drop the raw field to keep the response lean.
export type McpEvent = Omit<Event, "mentions_json"> & { mentions: string[] };

export function formatEventForMcp(event: Event): McpEvent {
  const { mentions_json, ...rest } = event;
  let mentions: string[] = [];
  if (mentions_json !== null) {
    try {
      const parsed = JSON.parse(mentions_json);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        mentions = parsed;
      } else {
        log(`mentions_json for event ${event.event_id} was malformed; treating as empty`);
      }
    } catch (error) {
      log(`mentions_json for event ${event.event_id} failed to parse: ${(error as Error).message}`);
    }
  }
  return { ...rest, mentions };
}
