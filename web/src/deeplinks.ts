// Tiny URL contract for deep links — no router. Three readable path forms plus a
// debug query form. Event links resolve to a single event id the DataSource
// turns into a target; room links resolve client-side against the rooms already
// loaded from /web/state. Unknown paths return null so the Shell falls back to
// its first room.
//
//   /web/e/:id       canonical (an event id)
//   /web/t/:id       thread alias (a reply opens its thread; a root opens the
//                    thread ON that root — see the App-side surface override)
//   /web/r/:roomId   room ("group:1" / "dm:peer-id" — the client room id)
//   ?event=:id       compatibility/debug form
//
// Any form additionally takes `?view=pane`: mount only the room/thread surface
// (no sidebar/nav chrome) — the popout contract browser tabs and future desktop
// in-app tabs share. See docs/plans/web-multi-tab-popout-v0.md.
import type { WebDeepLinkTarget } from "./data/types.ts";

export type DeepLinkView = "shell" | "pane";

export type ParsedDeepLink =
  | { kind: "event"; id: string; form: "e" | "t"; view: DeepLinkView }
  | { kind: "room"; roomId: string; view: DeepLinkView };

export function parseDeepLink(loc: { pathname: string; search: string } = window.location): ParsedDeepLink | null {
  const params = new URLSearchParams(loc.search);
  const view: DeepLinkView = params.get("view") === "pane" ? "pane" : "shell";
  const room = loc.pathname.match(/\/web\/r\/([^/?#]+)/);
  if (room?.[1]) return { kind: "room", roomId: decodeURIComponent(room[1]), view };
  const path = loc.pathname.match(/\/web\/(e|t)\/([^/?#]+)/);
  if (path?.[1] && path[2]) return { kind: "event", id: decodeURIComponent(path[2]), form: path[1] as "e" | "t", view };
  const event = params.get("event");
  return event ? { kind: "event", id: event, form: "e", view } : null;
}

function withView(path: string, view: DeepLinkView = "shell"): string {
  return view === "pane" ? `${path}?view=pane` : path;
}

export function deepLinkPath(target: WebDeepLinkTarget, view: DeepLinkView = "shell"): string {
  return withView(`/web/e/${encodeURIComponent(target.linkId)}`, view);
}

export function roomDeepLinkPath(roomId: string, view: DeepLinkView = "shell"): string {
  return withView(`/web/r/${encodeURIComponent(roomId)}`, view);
}

function stripEventPrefix(messageId: string): string {
  return messageId.startsWith("e:") ? messageId.slice(2) : messageId;
}

export function threadDeepLinkPath(parentMessageId: string, view: DeepLinkView = "shell"): string {
  return withView(`/web/t/${encodeURIComponent(stripEventPrefix(parentMessageId))}`, view);
}

export function messageDeepLinkPath(messageId: string): string {
  return `/web/e/${encodeURIComponent(stripEventPrefix(messageId))}`;
}

export function messageDeepLinkUrl(messageId: string, origin: string = window.location.origin): string {
  return new URL(messageDeepLinkPath(messageId), origin).toString();
}
