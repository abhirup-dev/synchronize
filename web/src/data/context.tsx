// React glue for the DataSource layer. App.tsx wires up one DataSource and
// wraps the tree in <DataSourceProvider>. Every component reads via the
// typed hooks below — they never touch the adapter object directly.

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { DataSource, Snapshot } from "./types.ts";

const Ctx = createContext<DataSource | null>(null);

export function DataSourceProvider({ value, children }: { value: DataSource; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useDataSource(): DataSource {
  const ds = useContext(Ctx);
  if (!ds) throw new Error("DataSourceProvider missing in tree");
  return ds;
}

function useSnapshot<T>(snap: Snapshot<T>): T {
  return useSyncExternalStore(snap.subscribe, snap.get, snap.get);
}

export function useAgents() { return useSnapshot(useDataSource().agents()); }
export function useRooms()  { return useSnapshot(useDataSource().rooms()); }
export function useMe()      { return useSnapshot(useDataSource().me()); }
export function useMessages(roomId: string) { return useSnapshot(useDataSource().messages(roomId)); }
export function useThreadReplies(parentId: string) { return useSnapshot(useDataSource().threadReplies(parentId)); }
export function useTimeline(roomId: string) { return useSnapshot(useDataSource().timeline(roomId)); }
export function useTasks(roomId: string)    { return useSnapshot(useDataSource().tasks(roomId)); }
export function useArtifacts(roomId: string) { return useSnapshot(useDataSource().artifacts(roomId)); }

export function useSendMessage() {
  const ds = useDataSource();
  return ds.sendMessage.bind(ds);
}
