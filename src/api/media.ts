import { requestJson, type ClientConfig } from "../client.ts";
import type { Event, MediaItem } from "./types.ts";

export function shareMedia(
  client: ClientConfig,
  input: { group: string; sharedByPeerId: string; path: string; description?: string },
): Promise<{ media: MediaItem; event: Event }> {
  return requestJson<{ media: MediaItem; event: Event }>(client, `/groups/${encodeURIComponent(input.group)}/media`, {
    method: "POST",
    body: JSON.stringify({
      shared_by_peer_id: input.sharedByPeerId,
      path: input.path,
      description: input.description,
    }),
  });
}

export function listMedia(
  client: ClientConfig,
  input: { group: string; query?: string },
): Promise<{ media: MediaItem[] }> {
  const query = input.query ? `?query=${encodeURIComponent(input.query)}` : "";
  return requestJson<{ media: MediaItem[] }>(client, `/groups/${encodeURIComponent(input.group)}/media${query}`);
}

export function getMedia(client: ClientConfig, mediaId: string): Promise<{ media: MediaItem }> {
  return requestJson<{ media: MediaItem }>(client, `/media/${encodeURIComponent(mediaId)}`);
}
