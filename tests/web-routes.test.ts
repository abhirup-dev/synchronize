// Route-tree behaviour: resolution, canonicalisation, not-found, and the
// loaders-are-gates rule. Driven headlessly with an in-memory history — no DOM,
// no daemon, no Storybook. Storybook covers what the UI does once a route has
// matched; this covers which route matches and what its loader may hand back.
//
// Paths here are route-relative (no /web prefix): the basepath is applied by the
// router and is covered by the address-module tests and scripts/verify-web-dev.ts.
import { expect, test } from "bun:test";
import { createMemoryRouter, isPaneView } from "../web/src/routing/router.tsx";
import { MockDataSource } from "../web/src/data/mock.ts";
import { GROUPS } from "../web/src/data/seed.ts";

const ML_RANKING = GROUPS.find((group) => group.name === "ml-ranking")!.publicId!;
const FIRST_ROOM = GROUPS[0]!.publicId!;

interface Visit {
  /** Where it settled, route-relative. */
  at: string;
  statusCode: number;
  /** Canonical hrefs passed through on the way, in order. */
  hops: string[];
  /** False if any hop would have pushed a history entry. */
  everyHopReplaced: boolean;
  loaderData: unknown;
  loaderValues: unknown[];
  /** The VALIDATED modifiers — what the app reads. location.search is raw. */
  search: Record<string, unknown>;
}

/**
 * Load `path`, following resolver redirects. A headless router records a redirect
 * rather than performing it (only a mounted RouterProvider navigates), so each
 * hop is re-entered explicitly against the same DataSource.
 */
async function visit(path: string): Promise<Visit> {
  const ds = new MockDataSource();
  let router = createMemoryRouter(ds, path);
  await router.load();
  const hops: string[] = [];
  let everyHopReplaced = true;
  for (let hop = 0; hop < 5 && router.state.redirect; hop += 1) {
    const options = router.state.redirect.options;
    if (!options.replace) everyHopReplaced = false;
    const href = options.href!;
    hops.push(href);
    router = createMemoryRouter(ds, href);
    await router.load();
  }
  const matches = [...router.state.matches].reverse();
  return {
    at: router.state.location.pathname + router.state.location.searchStr,
    statusCode: router.state.statusCode,
    hops,
    everyHopReplaced,
    loaderData: matches.find((match) => match.loaderData !== undefined)?.loaderData,
    loaderValues: router.state.matches.flatMap((match) => Object.values((match.loaderData ?? {}) as Record<string, unknown>)),
    search: (router.state.matches.at(-1)?.search ?? {}) as Record<string, unknown>,
  };
}

test("a canonical group address matches and gates on its room", async () => {
  const result = await visit("/web/g/" + ML_RANKING);
  expect(result.at).toBe(`/g/${ML_RANKING}`);
  expect(result.hops).toEqual([]); // canonical: nothing to resolve
  expect(result.loaderData).toEqual({ roomId: "ml-ranking" });
});

test("a canonical DM address addresses by peer id", async () => {
  const result = await visit("/web/d/cortex");
  expect(result.at).toBe("/d/cortex");
  expect(result.loaderData).toEqual({ roomId: "dm-cortex" });
});

test("the event resolver lands on the room address with the message in focus", async () => {
  const result = await visit("/web/e/dc1");
  expect(result.hops).toEqual(["/web/d/cortex?focus=dc1"]);
  expect(result.at).toBe("/d/cortex?focus=dc1");
});

test("an event inside a thread resolves to the thread address, not the room", async () => {
  const result = await visit("/web/e/mld-r14");
  expect(result.hops).toEqual(["/web/t/ml-deepdive?focus=mld-r14"]);
  expect(result.loaderData).toEqual({ roomId: "ml-ranking", threadParentId: "ml-deepdive" });
});

test("the by-name resolver — the only form an agent can construct — canonicalises", async () => {
  const result = await visit("/web/g/by-name/ml-ranking");
  expect(result.at).toBe(`/g/${ML_RANKING}`);
});

test("the legacy room id resolves rather than addressing", async () => {
  const result = await visit("/web/r/ml-ranking");
  expect(result.at).toBe(`/g/${ML_RANKING}`);
});

test("the mount point lands on the first addressable room", async () => {
  expect((await visit("/web/")).at).toBe(`/g/${FIRST_ROOM}`);
});

test("resolvers replace the history entry, so back leaves rather than bouncing", async () => {
  for (const path of ["/web/e/dc1", "/web/r/ml-ranking", "/web/g/by-name/ml-ranking", "/web/"]) {
    const result = await visit(path);
    expect(result.hops.length, path).toBeGreaterThan(0);
    expect(result.everyHopReplaced, path).toBe(true);
  }
});

test("an address from another runtime is not found, never a different room", async () => {
  // The reason ids are opaque: an autoincrement id would have matched something.
  for (const path of ["/web/g/g_minted_elsewhere", "/web/d/peer-that-left", "/web/r/group:1"]) {
    expect((await visit(path)).statusCode, path).toBe(404);
  }
});

test("an unresolvable event is not found rather than pending forever", async () => {
  expect((await visit("/web/e/does-not-exist")).statusCode).toBe(404);
});

test("the view modifier survives a resolver redirect", async () => {
  expect((await visit("/web/r/ml-ranking?view=pane")).at).toBe(`/g/${ML_RANKING}?view=pane`);
});

test("an invalid view value selects no window role, and is not an error either", async () => {
  const result = await visit(`/web/g/${ML_RANKING}?view=split`);
  expect(result.statusCode).toBe(200);
  expect(isPaneView(result.search as { view?: string })).toBe(false);
  expect(isPaneView({ view: "pane" })).toBe(true);
});

test("focus is a modifier: it reaches the surface through search, not the gate", async () => {
  const result = await visit(`/web/g/${ML_RANKING}?focus=ml-deepdive`);
  expect(result.at).toBe(`/g/${ML_RANKING}?focus=ml-deepdive`);
  expect(result.loaderData).toEqual({ roomId: "ml-ranking" });
});

test("a board nests inside the room address and the room gate runs once", async () => {
  const result = await visit(`/web/g/${ML_RANKING}/board/tasks`);
  expect(result.at).toBe(`/g/${ML_RANKING}/board/tasks`);
  // One gate for the room, shared by whichever surface is nested inside it.
  expect(result.loaderData).toEqual({ roomId: "ml-ranking" });
  expect(result.loaderValues.filter((value) => value === "ml-ranking")).toHaveLength(1);
});

test("an unknown board under a real room is not found", async () => {
  expect((await visit(`/web/g/${ML_RANKING}/board/no-such-board`)).statusCode).toBe(404);
});

test("agent surfaces are addressable by peer id", async () => {
  expect((await visit("/web/agents")).statusCode).toBe(200);
  expect((await visit("/web/agents/cortex")).at).toBe("/agents/cortex");
  expect((await visit("/web/agents/cortex/archive")).at).toBe("/agents/cortex/archive");
});

test("no loader returns a renderable payload", async () => {
  // The rule cache ownership depends on: the router does not observe SSE, so
  // anything a loader returned and a component rendered would go stale on
  // back/forward while the live snapshot moved on.
  for (const path of [`/web/g/${ML_RANKING}`, "/web/d/cortex", "/web/t/ml-deepdive", "/web/activity"]) {
    for (const value of (await visit(path)).loaderValues) {
      expect(typeof value, `${path} loader returned a non-identifier`).toBe("string");
    }
  }
});

test("re-entering a route re-runs its gate instead of serving a cached result", async () => {
  const ds = new MockDataSource();
  const router = createMemoryRouter(ds, `/web/g/${ML_RANKING}`);
  await router.load();
  const gate = () => [...router.state.matches].reverse().find((match) => (match.loaderData as { roomId?: string })?.roomId)?.loaderData;
  await router.navigate({ to: "/d/$peerId", params: { peerId: "cortex" } });
  await router.load();
  expect(gate()).toEqual({ roomId: "dm-cortex" });
  await router.navigate({ to: "/g/$publicId", params: { publicId: ML_RANKING } });
  await router.load();
  expect(gate()).toEqual({ roomId: "ml-ranking" });
});

test("a room with no canonical address stays reachable at its legacy id", async () => {
  // A runtime that predates the public_id migration serves groups with no
  // address. Not-found is right for an id that names nothing; it is wrong for a
  // room sitting in the sidebar, which would make the whole app unusable.
  const ds = new MockDataSource();
  // The production shape: groups with no public_id and no DM rooms at all, so
  // nothing in the workspace has a canonical address.
  const stripped = ds.rooms().get()
    .filter((room) => room.kind === "group")
    .map((room) => {
      const { publicId: _dropped, ...rest } = room;
      return rest;
    });
  (ds.rooms() as unknown as { set(value: unknown): void }).set(stripped);

  const router = createMemoryRouter(ds, "/web/r/ml-ranking");
  await router.load();
  expect(router.state.statusCode).toBe(200);
  expect(router.state.location.pathname).toBe("/r/ml-ranking");
  expect([...router.state.matches].reverse().find((m) => (m.loaderData as { roomId?: string })?.roomId)?.loaderData)
    .toEqual({ roomId: "ml-ranking" });

  // And the mount point lands there rather than stranding on the activity feed.
  const index = createMemoryRouter(ds, "/web/");
  await index.load();
  expect(index.state.redirect?.options.href).toBe("/web/r/checkout-revamp");
});

test("the legacy id still canonicalises when the room does have an address", async () => {
  const result = await visit("/web/r/ml-ranking");
  expect(result.at).toBe(`/g/${ML_RANKING}`);
});

test("a legacy id naming no room is still not-found", async () => {
  expect((await visit("/web/r/no-such-room")).statusCode).toBe(404);
});
