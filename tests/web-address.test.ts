// Grammar coverage for web/src/routing/address.ts — pure in, pure out, so no
// daemon, DOM or cleanup. Composed deep-link flows (Shell + real History API)
// live in web/src/components/DeepLinks.stories.tsx; the split keeps grammar
// changes from needing a browser to prove.
import { expect, test } from "bun:test";
import {
  BASE,
  CLIENT_ROUTE_PREFIXES,
  findRoomForAddress,
  isAppPath,
  messageAddressUrl,
  parseLocation,
  serializeAddress,
  serializeLocation,
  type Address,
} from "../web/src/routing/address.ts";

function at(pathname: string, search = ""): { pathname: string; search: string } {
  return { pathname, search };
}

test("BASE is the mount point and every client prefix sits under it", () => {
  expect(BASE).toBe("/web/");
  for (const prefix of CLIENT_ROUTE_PREFIXES) {
    expect(prefix.startsWith(BASE)).toBe(true);
  }
});

test("every path form in the grammar has a dev-server pass-through prefix", () => {
  // Without this, a new client route forwards to the daemon in dev and is
  // answered by its SPA fallback: 200, production bundle, dead HMR.
  for (const path of ["/web/g/g_abc", "/web/d/peer-1", "/web/t/9", "/web/e/9", "/web/r/group:1"]) {
    expect(CLIENT_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))).toBe(true);
  }
});

test("canonical addresses parse to their own variants", () => {
  expect(parseLocation(at("/web/g/g_4c1e7a90b2d3")).address).toEqual({ kind: "group", publicId: "g_4c1e7a90b2d3" });
  expect(parseLocation(at("/web/d/peer-uuid")).address).toEqual({ kind: "dm", peerId: "peer-uuid" });
  expect(parseLocation(at("/web/t/1234")).address).toEqual({ kind: "thread", eventId: "1234" });
});

test("an address carries no resolver, and a resolver carries no address", () => {
  const address = parseLocation(at("/web/g/g_abc"));
  expect(address.resolver).toBeNull();
  const resolver = parseLocation(at("/web/e/42"));
  expect(resolver.address).toBeNull();
  expect(resolver.resolver).toEqual({ kind: "event", eventId: "42" });
});

test("resolver forms parse to their own variants", () => {
  expect(parseLocation(at("/web/e/42")).resolver).toEqual({ kind: "event", eventId: "42" });
  expect(parseLocation(at("/web/g/by-name/checkout-revamp")).resolver).toEqual({
    kind: "group-by-name",
    name: "checkout-revamp",
  });
  expect(parseLocation(at("/web/r/group:1")).resolver).toEqual({ kind: "room", roomId: "group:1" });
  expect(parseLocation(at("/web/", "?event=99")).resolver).toEqual({ kind: "event", eventId: "99" });
});

test("by-name wins over the bare group form", () => {
  // Read as a public id, "by-name" would yield "no group has that id" — the
  // wrong answer to a resolvable request.
  const parsed = parseLocation(at("/web/g/by-name/ops"));
  expect(parsed.address).toBeNull();
  expect(parsed.resolver).toEqual({ kind: "group-by-name", name: "ops" });
  // A group literally addressed as "by-name" with nothing after it is not a route.
  expect(parseLocation(at("/web/g/by-name")).resolver).toBeNull();
  expect(parseLocation(at("/web/g/by-name")).address).toBeNull();
});

test("?event= applies only when the path says nothing", () => {
  expect(parseLocation(at("/web/e/path", "?event=query")).resolver).toEqual({ kind: "event", eventId: "path" });
  expect(parseLocation(at("/web/g/g_abc", "?event=query")).resolver).toBeNull();
  // Present-but-empty is absent, not an empty-id target.
  expect(parseLocation(at("/web/", "?event=")).resolver).toBeNull();
});

test("modifiers parse independently of the address", () => {
  const parsed = parseLocation(at("/web/g/g_abc", "?view=pane&focus=e:42"));
  expect(parsed.address).toEqual({ kind: "group", publicId: "g_abc" });
  expect(parsed.modifiers).toEqual({ pane: true, focus: "e:42" });
  expect(parseLocation(at("/web/g/g_abc")).modifiers).toEqual({ pane: false, focus: null });
  // Only "pane" turns the modifier on; an unknown value is not a window role.
  expect(parseLocation(at("/web/g/g_abc", "?view=split")).modifiers.pane).toBe(false);
});

test("paths outside the grammar parse to nothing", () => {
  for (const path of ["/web/", "/web/g/", "/web/e/", "/groups/ops", "/web/x/1"]) {
    const parsed = parseLocation(at(path));
    expect(parsed.address, path).toBeNull();
    expect(parsed.resolver, path).toBeNull();
  }
});

test("ids are percent-decoded and round-trip through serialize", () => {
  const cases: Address[] = [
    { kind: "group", publicId: "g_with/slash" },
    { kind: "dm", peerId: "peer with space" },
    { kind: "thread", eventId: "e:1?x=2" },
  ];
  for (const address of cases) {
    expect(parseLocation(at(serializeAddress(address))).address).toEqual(address);
  }
});

test("serializeLocation round-trips modifiers and drops the defaults", () => {
  const address: Address = { kind: "group", publicId: "g_abc" };
  expect(serializeLocation(address)).toBe("/web/g/g_abc");
  expect(serializeLocation(address, { pane: false, focus: null })).toBe("/web/g/g_abc");
  const url = serializeLocation(address, { pane: true, focus: "e:42" });
  expect(url).toBe("/web/g/g_abc?view=pane&focus=e%3A42");
  const parsed = parseLocation(at("/web/g/g_abc", "?view=pane&focus=e%3A42"));
  expect(parsed.address).toEqual(address);
  expect(parsed.modifiers).toEqual({ pane: true, focus: "e:42" });
});

test("isAppPath covers the bare mount point, the slashed form, and index.html", () => {
  // The daemon serves the app at all three, so all three are app paths.
  for (const path of ["/web", "/web/", "/web/index.html", "/web/g/g_abc"]) expect(isAppPath(path)).toBe(true);
  for (const path of ["/", "/groups/ops"]) expect(isAppPath(path)).toBe(false);
});

test("findRoomForAddress matches by opaque id and returns null otherwise", () => {
  const rooms = [
    { kind: "group", id: "group:1", publicId: "g_abc" },
    { kind: "group", id: "group:2", publicId: "g_def" },
    { kind: "dm", id: "dm:p1", peerId: "p1" },
  ];
  expect(findRoomForAddress({ kind: "group", publicId: "g_def" }, rooms)?.id).toBe("group:2");
  expect(findRoomForAddress({ kind: "dm", peerId: "p1" }, rooms)?.id).toBe("dm:p1");
  // An address minted in another runtime: not-found, never a positional match.
  expect(findRoomForAddress({ kind: "group", publicId: "g_from_dev" }, rooms)).toBeNull();
  // A thread resolves through the daemon, not the room list.
  expect(findRoomForAddress({ kind: "thread", eventId: "1" }, rooms)).toBeNull();
});

test("messageAddressUrl builds an absolute resolver link and strips the e: prefix", () => {
  expect(messageAddressUrl("e:42", "https://synchronize.localhost:1355")).toBe(
    "https://synchronize.localhost:1355/web/e/42",
  );
  expect(messageAddressUrl("mock-1", "http://127.0.0.1:58405")).toBe("http://127.0.0.1:58405/web/e/mock-1");
});
