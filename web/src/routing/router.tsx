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
  createMemoryHistory,
  useNavigate,
  useRouterState,
  type RouterHistory,
} from "@tanstack/react-router";
import { ActivityLeaf } from "./leaves/ActivityLeaf.tsx";
import { AgentArchiveLeaf, AgentLeaf, AgentsLeaf } from "./leaves/AgentLeaves.tsx";
import { ArtifactsLeaf, BoardLeaf, ChatLeaf, RoomLayout } from "./leaves/RoomLeaf.tsx";
import { ThreadLeaf } from "./leaves/ThreadLeaf.tsx";
import { AddressNotFound } from "./AddressNotFound.tsx";
import { AppLayout } from "../shell/AppLayout.tsx";
import { BASE, addressForRoom, findRoomForAddress, serializeAddress, serializeLocation, type Address } from "./address.ts";
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
  // Unrecognised values are dropped rather than thrown, and the router stays
  // non-strict about unknown keys: a stray query parameter must not turn a valid
  // address into an error page. Router-level strictness rejects the whole
  // location, which is the wrong trade for something like a UTM tag.
  const view = raw["view"] === "pane" ? ("pane" as const) : undefined;
  const focus = typeof raw["focus"] === "string" && raw["focus"] ? raw["focus"] : undefined;
  return { ...(view ? { view } : {}), ...(focus ? { focus } : {}) };
}

/**
 * Whether a location selects the pane window role — the single runtime check.
 * Non-strict search means an unrecognised value survives in the search object,
 * so reading `view` is not the same as validating it, and a value that merely
 * looks like a modifier must select no role.
 */
export function isPaneView(search: { view?: string }): boolean {
  return search.view === "pane";
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

// A room address is a LAYOUT, not a leaf: the room gate loads once and the
// surface inside it — chat, a board, artifacts — is a nested child. This is the
// convention any future per-room surface follows; adding one is a child route,
// not another branch inside the room component.
const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "g/$publicId",
  loaderDeps: ({ search }: { search: AppSearch }) => ({ focus: search.focus }),
  loader: async ({ context, params, deps }): Promise<RoomGate> =>
    gateRoom(context.ds, { kind: "group", publicId: params.publicId }, deps.focus),
  component: RoomLayout,
});

const dmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "d/$peerId",
  loaderDeps: ({ search }: { search: AppSearch }) => ({ focus: search.focus }),
  loader: async ({ context, params, deps }): Promise<RoomGate> =>
    gateRoom(context.ds, { kind: "dm", peerId: params.peerId }, deps.focus),
  component: RoomLayout,
});

/** The only board a room has today: its kanban. */
export const DEFAULT_BOARD_ID = "tasks";

/** The three surfaces a room address can show, under either room parent. */
function roomSurfaceRoutes(parent: typeof groupRoute | typeof dmRoute) {
  return [
    createRoute({ getParentRoute: () => parent, path: "/", component: ChatLeaf }),
    createRoute({
      getParentRoute: () => parent,
      path: "board/$boardId",
      // A pure guard: the room gate above already resolved everything the board
      // needs, so this returns nothing rather than restating it.
      loader: ({ params }) => {
        if (params.boardId !== DEFAULT_BOARD_ID) throw notFound();
      },
      component: BoardLeaf,
    }),
    createRoute({ getParentRoute: () => parent, path: "artifacts", component: ArtifactsLeaf }),
  ];
}

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

// ── Agents ───────────────────────────────────────────────────────────────────
// Addressed by peer_id, the same opaque id a DM uses. No gate: the agent list is
// live, and an agent that archives while its page is open should not turn the
// surface into a not-found.

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "agents",
  component: AgentsLeaf,
});

const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "agents/$peerId",
  component: AgentLeaf,
});

// A sibling rather than a child: the console is the whole surface, so there is no
// parent chrome for it to render inside. Nesting is exercised where it earns its
// keep — a room layout with a surface inside it.
const agentArchiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "agents/$peerId/archive",
  component: AgentArchiveLeaf,
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
  agentsRoute,
  agentRoute,
  agentArchiveRoute,
  groupByNameResolverRoute,
  groupRoute.addChildren(roomSurfaceRoutes(groupRoute)),
  dmRoute.addChildren(roomSurfaceRoutes(dmRoute)),
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

/**
 * A router detached from the address bar, started at `initialPath`. Used where
 * there is no address bar to own: a Storybook iframe served from /iframe.html,
 * and the headless route tests.
 */
export function createMemoryRouter(ds: DataSource, initialPath: string) {
  return createAppRouter(ds, createMemoryHistory({ initialEntries: [initialPath] }));
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

/** Which surface inside the current room address is showing. */
export function useRoomTab(): "chat" | "board" | "artifacts" {
  return useRouterState({
    select: (state) => {
      const ids = state.matches.map((match) => match.routeId);
      if (ids.some((id) => id.endsWith("/board/$boardId"))) return "board" as const;
      if (ids.some((id) => id.endsWith("/artifacts"))) return "artifacts" as const;
      return "chat" as const;
    },
  });
}

/**
 * Switch surface within the room the caller is already in. The address is derived
 * from the room, so the tab strip never spells a path.
 */
export function useNavigateRoomTab(): (tab: "chat" | "board" | "artifacts", room: Room) => void {
  const navigate = useNavigate();
  return (tab, room) => {
    const address = addressForRoom(room);
    if (address?.kind === "group") {
      const to = ({ chat: "/g/$publicId", board: "/g/$publicId/board/$boardId", artifacts: "/g/$publicId/artifacts" } as const)[tab];
      void navigate({ to, params: { publicId: address.publicId, boardId: DEFAULT_BOARD_ID }, search: (prev) => searchOf(prev) });
      return;
    }
    if (address?.kind === "dm") {
      const to = ({ chat: "/d/$peerId", board: "/d/$peerId/board/$boardId", artifacts: "/d/$peerId/artifacts" } as const)[tab];
      void navigate({ to, params: { peerId: address.peerId, boardId: DEFAULT_BOARD_ID }, search: (prev) => searchOf(prev) });
    }
  };
}

/**
 * Drop ?focus= — always with replace, never push.
 *
 * The distinction the history discipline rests on: ?view is a window role and
 * part of the address, so it participates in history; ?focus changes every time
 * the user looks at a different message, so pushing it would make back crawl
 * through scroll positions instead of leaving the room in one step.
 */
export function useClearFocus(): () => void {
  const navigate = useNavigate();
  return () => void navigate({ to: ".", search: (prev) => searchOf(prev), replace: true });
}

/**
 * Open an address in its own chrome-less window, named after the address, so a
 * second open focuses the existing window instead of duplicating it. The browser
 * does that for free with a named target — no window registry, no presence
 * protocol, no daemon state.
 */
export function openInPane(address: Address): Window | null {
  const href = serializeLocation(address, { pane: true });
  return window.open(href, `sync:${serializeAddress(address)}`);
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
