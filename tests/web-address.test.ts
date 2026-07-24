// Grammar coverage for web/src/routing/address.ts — pure in, pure out, so no
// daemon, DOM or cleanup. Composed deep-link flows (Shell + real History API)
// live in web/src/components/DeepLinks.stories.tsx; the split keeps grammar
// changes from needing a browser to prove.
import { expect, test } from "bun:test";
import {
  BASE,
  CLIENT_ROUTE_PREFIXES,
  isAppPath,
  messageAddressUrl,
  parseAddress,
  serializeAddress,
} from "../web/src/routing/address.ts";

function at(pathname: string, search = ""): { pathname: string; search: string } {
  return { pathname, search };
}

test("BASE is the mount point and every client prefix sits under it", () => {
  expect(BASE).toBe("/web/");
  expect(CLIENT_ROUTE_PREFIXES.length).toBeGreaterThan(0);
  for (const prefix of CLIENT_ROUTE_PREFIXES) {
    expect(prefix.startsWith(BASE)).toBe(true);
  }
});

test("parses the canonical /web/e/:id form", () => {
  expect(parseAddress(at("/web/e/1234"))).toEqual({ kind: "event", linkId: "1234" });
});

test("parses the /web/t/:id thread alias to the same shape", () => {
  expect(parseAddress(at("/web/t/1234"))).toEqual({ kind: "event", linkId: "1234" });
});

test("parses the ?event= compatibility form", () => {
  expect(parseAddress(at("/", "?event=99"))).toEqual({ kind: "event", linkId: "99" });
  // A path match wins over the query form when both are present.
  expect(parseAddress(at("/web/e/path", "?event=query"))).toEqual({ kind: "event", linkId: "path" });
});

test("returns null for paths outside the grammar", () => {
  expect(parseAddress(at("/web/"))).toBeNull();
  expect(parseAddress(at("/web/e/"))).toBeNull();
  expect(parseAddress(at("/groups/ops"))).toBeNull();
  expect(parseAddress(at("/web/x/1"))).toBeNull();
  // Present-but-empty ?event= is absent, not an empty-id target.
  expect(parseAddress(at("/", "?event="))).toBeNull();
});

test("path ids are percent-decoded and round-trip through serialize", () => {
  const encoded = encodeURIComponent("e:with/slash?and=amp");
  const parsed = parseAddress(at(`/web/e/${encoded}`));
  // The regex stops at the first "/", so a slash inside an id must arrive encoded
  // and must survive decoding intact.
  expect(parsed).toEqual({ kind: "event", linkId: "e:with/slash?and=amp" });
  expect(parseAddress(at(serializeAddress(parsed!)))).toEqual(parsed);
});

test("serialize always emits the canonical e/ form, never the t/ alias", () => {
  expect(serializeAddress({ kind: "event", linkId: "77" })).toBe("/web/e/77");
  const fromAlias = parseAddress(at("/web/t/77"))!;
  expect(serializeAddress(fromAlias)).toBe("/web/e/77");
});

test("isAppPath covers the bare mount point, the slashed form, and index.html", () => {
  // The daemon serves the app at all three, so all three are app paths.
  expect(isAppPath("/web")).toBe(true);
  expect(isAppPath("/web/")).toBe(true);
  expect(isAppPath("/web/index.html")).toBe(true);
  expect(isAppPath("/web/e/1")).toBe(true);
  expect(isAppPath("/")).toBe(false);
  expect(isAppPath("/groups/ops")).toBe(false);
});

test("messageAddressUrl builds an absolute link and strips the e: prefix", () => {
  expect(messageAddressUrl("e:42", "https://synchronize.localhost:1355")).toBe(
    "https://synchronize.localhost:1355/web/e/42",
  );
  // Ids that are not prefixed are used verbatim.
  expect(messageAddressUrl("mock-1", "http://127.0.0.1:58405")).toBe("http://127.0.0.1:58405/web/e/mock-1");
});
