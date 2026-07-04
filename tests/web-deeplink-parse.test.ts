import { expect, test } from "bun:test";
// Pure-function coverage for the web deep-link URL contract (web/src/deeplinks.ts).
// Server-side resolution semantics live in web-deeplinks.test.ts; browser-level
// Shell behavior lives in web/src/components/DeepLinks.stories.tsx.
import { deepLinkPath, parseDeepLink, roomDeepLinkPath, threadDeepLinkPath } from "../web/src/deeplinks.ts";

const loc = (pathname: string, search = "") => ({ pathname, search });

test("parseDeepLink handles event, thread, room, and query forms", () => {
  expect(parseDeepLink(loc("/web/e/42"))).toEqual({ kind: "event", id: "42", form: "e", view: "shell" });
  expect(parseDeepLink(loc("/web/t/42"))).toEqual({ kind: "event", id: "42", form: "t", view: "shell" });
  expect(parseDeepLink(loc("/web/r/group:7"))).toEqual({ kind: "room", roomId: "group:7", view: "shell" });
  expect(parseDeepLink(loc("/web/", "?event=42"))).toEqual({ kind: "event", id: "42", form: "e", view: "shell" });
  expect(parseDeepLink(loc("/web/"))).toBeNull();
  expect(parseDeepLink(loc("/web/settings"))).toBeNull();
});

test("parseDeepLink reads ?view=pane on every form and decodes path segments", () => {
  expect(parseDeepLink(loc("/web/r/dm%3Apeer-1", "?view=pane"))).toEqual({ kind: "room", roomId: "dm:peer-1", view: "pane" });
  expect(parseDeepLink(loc("/web/e/42", "?view=pane"))).toEqual({ kind: "event", id: "42", form: "e", view: "pane" });
  expect(parseDeepLink(loc("/web/t/42", "?view=bogus"))?.view).toBe("shell");
});

test("path builders round-trip through the parser and preserve view", () => {
  expect(roomDeepLinkPath("group:7", "pane")).toBe("/web/r/group%3A7?view=pane");
  expect(parseDeepLink(loc("/web/r/group%3A7", "?view=pane"))).toEqual({ kind: "room", roomId: "group:7", view: "pane" });
  // threadDeepLinkPath strips the web message-id "e:" prefix like messageDeepLinkPath.
  expect(threadDeepLinkPath("e:42", "pane")).toBe("/web/t/42?view=pane");
  expect(threadDeepLinkPath("mock-id")).toBe("/web/t/mock-id");
  const target = { roomId: "group:7", surface: "group-main" as const, focusMessageId: "e:42", threadParentId: null, linkId: "42", eventId: 42 };
  expect(deepLinkPath(target)).toBe("/web/e/42");
  expect(deepLinkPath(target, "pane")).toBe("/web/e/42?view=pane");
});
