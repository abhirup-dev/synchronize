// The app's mount point and route grammar:
//
//   /web/e/:id   canonical (an event id)
//   /web/t/:id   thread-root alias (same resolution; the pane opens on the root)
//   ?event=:id   compatibility/debug form
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
export const CLIENT_ROUTE_PREFIXES: readonly string[] = [`${BASE}e/`, `${BASE}t/`];

/** The subset of `window.location` the parser reads. */
export interface AddressLocation {
  pathname: string;
  search: string;
}

/** A parsed client address. One variant today; the router adds more. */
export interface Address {
  kind: "event";
  /** Opaque link id — an event id in daemon mode, a fixture id under mock. */
  linkId: string;
}

/** True when `pathname` is inside the app's mount point. */
export function isAppPath(pathname: string): boolean {
  // Trailing slash stripped because the daemon serves the app at /web, /web/ and
  // /web/index.html alike.
  return pathname.startsWith(BASE.replace(/\/$/, ""));
}

export function parseAddress(loc: AddressLocation): Address | null {
  const path = loc.pathname.match(new RegExp(`${escapeRegExp(BASE)}(?:e|t)/([^/?#]+)`));
  if (path?.[1]) return { kind: "event", linkId: decodeURIComponent(path[1]) };
  const query = new URLSearchParams(loc.search).get("event");
  return query ? { kind: "event", linkId: query } : null;
}

export function serializeAddress(address: Address): string {
  return `${BASE}e/${encodeURIComponent(address.linkId)}`;
}

/**
 * Absolute, pasteable URL for a message. `origin` is where a human's browser
 * should go, which is not the runtime the DataSource reads: a worktree UI shares
 * links to its own origin, because that is the address a recipient can open.
 */
export function messageAddressUrl(messageId: string, origin: string): string {
  const linkId = messageId.startsWith("e:") ? messageId.slice(2) : messageId;
  return new URL(serializeAddress({ kind: "event", linkId }), origin).toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
