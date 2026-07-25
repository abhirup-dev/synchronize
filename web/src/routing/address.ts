// The app's mount point and route grammar. Three categories, deliberately
// distinct — see docs/plans/routing-and-address-model.md.
//
//   ADDRESSES  what a window IS. Canonical, stable, portable.
//     /web/g/:publicId        a group
//     /web/d/:peerId          a direct message
//     /web/t/:eventId         a thread
//
//   RESOLVERS  pointers. They resolve once, then replaceState to the canonical
//              address. Only share affordances emit them.
//     /web/e/:eventId         "this message"
//     /web/g/by-name/:name    the form an agent can construct — bridge_send_group
//                             takes a name, not an id
//     /web/r/:roomId          legacy room id ("group:1", "dm:<peer>")
//     ?event=:id              compatibility form
//
//   MODIFIERS  query parameters, orthogonal to the address.
//     ?view=pane              window role, fixed for the window's life
//     ?focus=:messageId       ephemeral nav state
//
// Addresses are opaque because they get pasted into durable places and read back
// in a different runtime than they were written in. An autoincrement id collides
// by construction — every runtime has a group 1 — so a cross-runtime paste opens
// a different room with no error. An opaque id yields a clean not-found.
//
// Pure by contract — no React, no hooks, no unguarded window access — so it can
// be unit-tested without a DOM and imported by the Vite dev config, which runs
// in Node.

// Every environment mounts the app here, including the dev server. A dev server
// serving the document at "/" instead would let /web/e/abc escape Vite, reach
// the daemon, and get answered by its SPA fallback with the production bundle:
// HTTP 200, dead HMR, no error anywhere.
export const BASE = "/web/";

// The dev server's pass-through list is exactly these plus BASE itself;
// everything else is forwarded to the daemon. Kept here so adding a client route
// cannot forget to teach the dev server about it.
export const CLIENT_ROUTE_PREFIXES: readonly string[] = [
  `${BASE}g/`,
  `${BASE}d/`,
  `${BASE}t/`,
  `${BASE}e/`,
  `${BASE}r/`,
  `${BASE}activity`,
];

/** The subset of `window.location` the parser reads. */
export interface AddressLocation {
  pathname: string;
  search: string;
}

/** A canonical address: what a window is. */
export type Address =
  | { kind: "group"; publicId: string }
  | { kind: "dm"; peerId: string }
  | { kind: "thread"; eventId: string };

/** A pointer that has to be resolved against daemon or loaded state first. */
export type Resolver =
  | { kind: "event"; eventId: string }
  | { kind: "group-by-name"; name: string }
  | { kind: "room"; roomId: string };

export interface Modifiers {
  /** A chrome-less window embedded elsewhere. Set at open, never changes. */
  pane: boolean;
  /** Message to scroll to and flash. Ephemeral: replaceState only. */
  focus: string | null;
}

export interface ParsedLocation {
  address: Address | null;
  resolver: Resolver | null;
  modifiers: Modifiers;
}

/** True when `pathname` is inside the app's mount point. */
export function isAppPath(pathname: string): boolean {
  // Trailing slash stripped because the daemon serves the app at /web, /web/ and
  // /web/index.html alike.
  return pathname.startsWith(BASE.replace(/\/$/, ""));
}

export function parseLocation(loc: AddressLocation): ParsedLocation {
  const query = new URLSearchParams(loc.search);
  const modifiers: Modifiers = { pane: query.get("view") === "pane", focus: query.get("focus") || null };
  const segments = pathSegments(loc.pathname);
  return { ...parsePath(segments), modifiers, ...queryResolver(segments, query) };
}

/** `["g", "abc"]` for `/web/g/abc`; `[]` for anything outside BASE. */
function pathSegments(pathname: string): string[] {
  if (!isAppPath(pathname)) return [];
  return pathname
    .slice(BASE.replace(/\/$/, "").length)
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
}

function parsePath(segments: string[]): { address: Address | null; resolver: Resolver | null } {
  const none = { address: null, resolver: null };
  const [head, first, second] = segments;
  if (!head || !first) return none;
  switch (head) {
    case "g":
      // by-name is checked first: as a bare segment it would otherwise be read
      // as a public id, and "no group has that id" is the wrong answer.
      if (first === "by-name") return second ? { address: null, resolver: { kind: "group-by-name", name: second } } : none;
      return { address: { kind: "group", publicId: first }, resolver: null };
    case "d":
      return { address: { kind: "dm", peerId: first }, resolver: null };
    case "t":
      return { address: { kind: "thread", eventId: first }, resolver: null };
    case "e":
      return { address: null, resolver: { kind: "event", eventId: first } };
    case "r":
      return { address: null, resolver: { kind: "room", roomId: first } };
    default:
      return none;
  }
}

/** `?event=` only applies when the path itself said nothing. */
function queryResolver(segments: string[], query: URLSearchParams): { resolver?: Resolver } {
  if (segments.length > 0) return {};
  const eventId = query.get("event");
  return eventId ? { resolver: { kind: "event", eventId } } : {};
}

export function serializeAddress(address: Address): string {
  switch (address.kind) {
    case "group":
      return `${BASE}g/${encodeURIComponent(address.publicId)}`;
    case "dm":
      return `${BASE}d/${encodeURIComponent(address.peerId)}`;
    case "thread":
      return `${BASE}t/${encodeURIComponent(address.eventId)}`;
  }
}

/**
 * The address bar for an address plus its modifiers. `pane` is part of the
 * address; `focus` rides along so a canonicalising replaceState does not drop
 * the message the user was sent to.
 */
export function serializeLocation(address: Address, modifiers: Partial<Modifiers> = {}): string {
  const query = new URLSearchParams();
  if (modifiers.pane) query.set("view", "pane");
  if (modifiers.focus) query.set("focus", modifiers.focus);
  const search = query.toString();
  return search ? `${serializeAddress(address)}?${search}` : serializeAddress(address);
}

/**
 * Absolute, pasteable URL for a message — a share affordance, hence the resolver
 * form: "this message" is the intent, and the recipient's client resolves it to
 * whichever room and thread it lives in.
 *
 * `origin` is where a human's browser should go, which is not the runtime the
 * DataSource reads: a worktree UI shares links to its own origin, because that is
 * the address a recipient can open.
 */
export function messageAddressUrl(messageId: string, origin: string): string {
  const eventId = messageId.startsWith("e:") ? messageId.slice(2) : messageId;
  return new URL(`${BASE}e/${encodeURIComponent(eventId)}`, origin).toString();
}

/**
 * The room a group or DM address names, or null when no loaded room matches.
 *
 * Pure: the caller supplies the room list. Null is the load-bearing answer —
 * an address minted in another runtime must produce not-found, never the room
 * that happens to sit at the same position here. A thread address always
 * returns null because an event id resolves through the daemon, not the room
 * list.
 */
export function findRoomForAddress<T extends { publicId?: string; peerId?: string; kind: string }>(
  address: Address,
  rooms: readonly T[],
): T | null {
  switch (address.kind) {
    case "group":
      return rooms.find((room) => room.kind === "group" && room.publicId === address.publicId) ?? null;
    case "dm":
      return rooms.find((room) => room.kind === "dm" && room.peerId === address.peerId) ?? null;
    case "thread":
      return null;
  }
}

/**
 * The canonical address of a loaded room — the inverse of findRoomForAddress.
 * Null when the room has no address: a group predating the public_id backfill,
 * or a synthetic destination like the activity feed.
 */
export function addressForRoom(room: { kind: string; publicId?: string; peerId?: string }): Address | null {
  if (room.kind === "group" && room.publicId) return { kind: "group", publicId: room.publicId };
  if (room.kind === "dm" && room.peerId) return { kind: "dm", peerId: room.peerId };
  return null;
}

/** Decode a path segment, tolerating a stray `%` rather than throwing. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
