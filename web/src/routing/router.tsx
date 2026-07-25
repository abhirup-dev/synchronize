// The route tree. web/src/routing/address.ts is the spec; this is that spec
// expressed as routes, and the mapping is one-to-one:
//
//   Address union member   ->  route definition
//   path matching          ->  route path + params
//   modifier parsing       ->  validateSearch
//   resolver -> canonical  ->  loader + redirect({ replace: true })
//   BASE                   ->  basepath
//
// LOADERS ARE GATES. A loader answers "is this address real, and is its data
// requested?" and returns identifiers only — never messages or rooms. The router
// caches loader results and does not observe the SSE stream, so a loader that
// returned a payload would render load-time data after back/forward while the
// live snapshot had moved on. Every render reads through useDataSource().
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
  useNavigate,
  useRouterState,
  type RouterHistory,
} from "@tanstack/react-router";
import { ActivityLeaf } from "./leaves/ActivityLeaf.tsx";
import { RoomLeaf } from "./leaves/RoomLeaf.tsx";
import { ThreadLeaf } from "./leaves/ThreadLeaf.tsx";
import { AddressNotFound } from "./AddressNotFound.tsx";
import { AppLayout } from "../shell/AppLayout.tsx";
import { BASE, addressForRoom, findRoomForAddress } from "./address.ts";
import type { DataSource, Room, WebDeepLinkTarget } from "../data/types.ts";

/** The virtual cross-room destination. Not a room, so it has no address of its own. */
export const ACTIVITY_PATH = "/activity";

/** The id the room list and the activity feed use for that virtual destination. */
export const ACTIVITY_ROOM_ID = "activity";

export interface RouterContext {
  ds: DataSource;
}

/** Modifiers: orthogonal to the address, so they live on the root and are inherited. */
export interface AppSearch {
  /** A chrome-less window embedded elsewhere. Fixed for the window's life. */
  view?: "pane";
  /** Message to scroll to and flash. Ephemeral — replaced, never pushed. */
  focus?: string;
}

function validateSearch(raw: Record<string, unknown>): AppSearch {
  // An unrecognised view is dropped rather than thrown: a stray query parameter
  // must not turn a valid address into an error page.
  const view = raw["view"] === "pane" ? ("pane" as const) : undefined;
  const focus = typeof raw["focus"] === "string" && raw["focus"] ? raw["focus"] : undefined;
  return { ...(view ? { view } : {}), ...(focus ? { focus } : {}) };
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  validateSearch,
  component: AppLayout,
  notFoundComponent: AddressNotFound,
});

// ── Rooms ────────────────────────────────────────────────────────────────────

/** What a leaf loader may return: identifiers the surface resolves for itself. */
interface RoomGate {
  roomId: string;
}

interface ThreadGate extends RoomGate {
  /** Web message id of the thread root. */
  threadParentId: string;
}

const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "g/$publicId",
  loaderDeps: ({ search }: { search: AppSearch }) => ({ focus: search.focus }),
  loader: async ({ context, params, deps }): Promise<RoomGate> =>
    gateRoom(context.ds, { kind: "group", publicId: params.publicId }, deps.focus),
  component: RoomLeaf,
});

const dmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "d/$peerId",
  loaderDeps: ({ search }: { search: AppSearch }) => ({ focus: search.focus }),
  loader: async ({ context, params, deps }): Promise<RoomGate> =>
    gateRoom(context.ds, { kind: "dm", peerId: params.peerId }, deps.focus),
  component: RoomLeaf,
});

export const threadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "t/$eventId",
  loader: async ({ context, params }): Promise<ThreadGate> => {
    const target = await resolveOrNotFound(context.ds, params.eventId);
    await context.ds.hydrateDeepLinkTarget(target);
    // The addressed event is the thread: a reply names its root, a root names
    // itself. Either way the pane opens on the root.
    return { roomId: target.roomId, threadParentId: target.threadParentId ?? target.focusMessageId };
  },
  component: ThreadLeaf,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "activity",
  component: ActivityLeaf,
});

// ── Resolvers ────────────────────────────────────────────────────────────────
// Each one resolves, then replaces the history entry with the canonical address,
// so `back` leaves the app rather than bouncing between a pointer and its target.

const eventResolverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "e/$eventId",
  loaderDeps: ({ search }: { search: AppSearch }) => searchOf(search),
  loader: async ({ context, params, deps }) => {
    const target = await resolveOrNotFound(context.ds, params.eventId);
    await context.ds.hydrateDeepLinkTarget(target);
    const view = deps.view;
    if (target.surface === "group-thread" && target.threadParentId) {
      throw redirect({
        to: "/t/$eventId",
        params: { eventId: stripEventPrefix(target.threadParentId) },
        search: { ...(view ? { view } : {}), focus: target.focusMessageId },
        replace: true,
      });
    }
    const rooms = await roomsWhenLoaded(context.ds);
    const room = rooms.find((candidate) => candidate.id === target.roomId);
    throw redirectToRoom(room, { ...(view ? { view } : {}), focus: target.focusMessageId });
  },
});

const groupByNameResolverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "g/by-name/$name",
  loaderDeps: ({ search }: { search: AppSearch }) => searchOf(search),
  loader: async ({ context, params, deps }) => {
    const rooms = await roomsWhenLoaded(context.ds);
    const room = rooms.find((candidate) => candidate.kind === "group" && candidate.name === params.name);
    throw redirectToRoom(room, deps);
  },
});

const roomResolverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "r/$roomId",
  loaderDeps: ({ search }: { search: AppSearch }) => searchOf(search),
  loader: async ({ context, params, deps }) => {
    const rooms = await roomsWhenLoaded(context.ds);
    throw redirectToRoom(rooms.find((candidate) => candidate.id === params.roomId), deps);
  },
});

/** `/web/` itself: land on the first room, or the activity feed when there is none. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loaderDeps: ({ search }: { search: AppSearch }) => searchOf(search),
  loader: async ({ context, deps }) => {
    const rooms = await roomsWhenLoaded(context.ds);
    const first = rooms.find((room) => addressForRoom(room) !== null);
    if (!first) throw redirect({ to: ACTIVITY_PATH, search: deps, replace: true });
    throw redirectToRoom(first, deps);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The modifiers that survive a redirect: the window role, never the focus. */
function searchOf(search: AppSearch): AppSearch {
  return search.view ? { view: search.view } : {};
}

/** Web message ids are "e:123"; an address carries the bare event id. */
export function stripEventPrefix(messageId: string): string {
  return messageId.startsWith("e:") ? messageId.slice(2) : messageId;
}

function redirectToRoom(room: Room | undefined, search: AppSearch): never {
  const address = room ? addressForRoom(room) : null;
  if (address?.kind === "group") {
    throw redirect({ to: "/g/$publicId", params: { publicId: address.publicId }, search, replace: true });
  }
  if (address?.kind === "dm") {
    throw redirect({ to: "/d/$peerId", params: { peerId: address.peerId }, search, replace: true });
  }
  throw notFound();
}

async function resolveOrNotFound(ds: DataSource, eventId: string): Promise<WebDeepLinkTarget> {
  try {
    return await ds.resolveDeepLink(eventId);
  } catch {
    // An id from another runtime, or a deleted event. Not-found is the answer;
    // the opaque-address design exists so it is never a plausible wrong room.
    throw notFound();
  }
}

async function gateRoom(
  ds: DataSource,
  address: Parameters<typeof findRoomForAddress>[0],
  focus: string | undefined,
): Promise<RoomGate> {
  const room = findRoomForAddress(address, await roomsWhenLoaded(ds));
  if (!room) throw notFound();
  // A focus target can be far behind the loaded window, so the around-window
  // hydration has to finish before the surface renders and tries to scroll.
  if (focus) {
    await ds.hydrateDeepLinkTarget({
      roomId: room.id,
      surface: room.kind === "dm" ? "dm" : "group-main",
      focusMessageId: focus,
      threadParentId: null,
      linkId: stripEventPrefix(focus),
      eventId: Number(stripEventPrefix(focus)) || 0,
    });
  }
  return { roomId: room.id };
}

/**
 * The room list, once it has one entry or the wait times out. Every address
 * resolves against it, so resolving before the first snapshot lands would report
 * a real address as not-found. The timeout is the empty-daemon case: "no rooms
 * yet" is a legitimate steady state, not a slow load.
 */
const ROOMS_WAIT_MS = 4_000;

function roomsWhenLoaded(ds: DataSource): Promise<Room[]> {
  const snapshot = ds.rooms();
  if (snapshot.get().length > 0) return Promise.resolve(snapshot.get());
  return new Promise((resolve) => {
    const settle = (rooms: Room[]) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(rooms);
    };
    const timer = setTimeout(() => settle(snapshot.get()), ROOMS_WAIT_MS);
    const unsubscribe = snapshot.subscribe(() => {
      if (snapshot.get().length > 0) settle(snapshot.get());
    });
  });
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const routeTree = rootRoute.addChildren([
  indexRoute,
  activityRoute,
  groupByNameResolverRoute,
  groupRoute,
  dmRoute,
  threadRoute,
  eventResolverRoute,
  roomResolverRoute,
]);

/**
 * @param history omit to drive the real address bar. A caller mounting the app
 *   somewhere that is not under BASE — a Storybook iframe — passes an in-memory
 *   history instead, since a browser history rooted at /iframe.html matches no
 *   route at all.
 */
export function createAppRouter(ds: DataSource, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { ds },
    ...(history ? { history } : {}),
    basepath: BASE.replace(/\/$/, ""),
    defaultNotFoundComponent: AddressNotFound,
    // Loader results are identifiers, not data, and rendering reads the live
    // DataSource — so there is nothing worth caching and re-serving here. Zero
    // staleness means a re-entered route re-gates rather than trusting a
    // snapshot the SSE stream has since moved past.
    defaultStaleTime: 0,
    defaultPreloadStaleTime: 0,
    defaultGcTime: 0,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

// ── Route state, read by the chrome ──────────────────────────────────────────

/**
 * The room the deepest matched leaf is showing, or null on a destination with no
 * room (the activity feed, a not-found address). Every room-bearing leaf loader
 * returns a roomId, so the chrome needs no per-route knowledge.
 */
export function useActiveRoomId(): string | null {
  return useRouterState({
    select: (state) => {
      for (const match of [...state.matches].reverse()) {
        const roomId = (match.loaderData as RoomGate | undefined)?.roomId;
        if (roomId) return roomId;
      }
      return null;
    },
  });
}

export function useIsActivityRoute(): boolean {
  return useRouterState({ select: (state) => state.matches.some((match) => match.routeId === activityRoute.id) });
}

export function useIsThreadRoute(): boolean {
  return useRouterState({ select: (state) => state.matches.some((match) => match.routeId === threadRoute.id) });
}

/** Navigation to a room by its web room id — the id the room list and the
 *  activity feed hand around. The address is derived here so no caller spells one. */
export function useNavigateToRoom(): (roomId: string, focus?: string) => void {
  const navigate = useNavigate();
  return (roomId, focus) => {
    if (roomId === ACTIVITY_ROOM_ID) {
      void navigate({ to: ACTIVITY_PATH, search: (prev) => searchOf(prev) });
      return;
    }
    void navigate({
      to: "/r/$roomId",
      params: { roomId },
      search: (prev) => ({ ...searchOf(prev), ...(focus ? { focus } : {}) }),
    });
  };
}

/** Open the thread rooted at a web message id. */
export function useNavigateToThread(): (parentMessageId: string) => void {
  const navigate = useNavigate();
  return (parentMessageId) => {
    void navigate({
      to: "/t/$eventId",
      params: { eventId: stripEventPrefix(parentMessageId) },
      search: (prev) => searchOf(prev),
    });
  };
}

export { Outlet };
