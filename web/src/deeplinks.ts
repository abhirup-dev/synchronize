// Tiny URL contract for deep links — no router. Two readable path forms plus a
// debug query form, all resolving to a single event id the DataSource turns into
// a target. Unknown paths return null so the Shell falls back to its first room.
//
//   /web/e/:id   canonical (an event id)
//   /web/t/:id   thread-root alias (same resolution; the pane opens on the root)
//   ?event=:id   compatibility/debug form
import type { WebDeepLinkTarget } from "./data/types.ts";

export function parseDeepLinkId(loc: { pathname: string; search: string } = window.location): string | null {
  const path = loc.pathname.match(/\/web\/(?:e|t)\/([^/?#]+)/);
  if (path?.[1]) return decodeURIComponent(path[1]);
  return new URLSearchParams(loc.search).get("event");
}

export function deepLinkPath(target: WebDeepLinkTarget): string {
  return `/web/e/${encodeURIComponent(target.linkId)}`;
}
