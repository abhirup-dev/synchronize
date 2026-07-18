// React glue for the DataSource layer. App.tsx wires up one DataSource and
// wraps the tree in <DataSourceProvider>. Every component reads via the
// typed hooks below — they never touch the adapter object directly.

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { DataSource, Snapshot } from "./types.ts";

const Ctx = createContext<DataSource | null>(null);

export function DataSourceProvider({ value, children }: { value: DataSource; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDataSource(): DataSource {
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
export function useTasks(roomId: string)    { return useSnapshot(useDataSource().tasks(roomId)); }
export function useArtifacts(roomId: string) { return useSnapshot(useDataSource().artifacts(roomId)); }
export function useThreadSummary(parentMessageId: string) { return useSnapshot(useDataSource().threadSummary(parentMessageId)); }
export function useSkillCatalog() { return useSnapshot(useDataSource().skillCatalog()); }
export function useLaunchProfiles() { return useSnapshot(useDataSource().launchProfiles()); }
export function useActivity() { return useSnapshot(useDataSource().activity()); }
export function useActivityAwaitingCount() { return useSnapshot(useDataSource().activityAwaitingCount()); }
export function useArchivedSessions() { return useSnapshot(useDataSource().archivedSessions()); }

export function useAckActivity() {
  const ds = useDataSource();
  return ds.ackActivity.bind(ds);
}

export function useAckActivityEvents() {
  const ds = useDataSource();
  return ds.ackActivityEvents.bind(ds);
}

export function useAckAllActivity() {
  const ds = useDataSource();
  return ds.ackAllActivity.bind(ds);
}

export function useLoadMoreActivity() {
  const ds = useDataSource();
  return ds.loadMoreActivity.bind(ds);
}

export function useSendMessage() {
  const ds = useDataSource();
  return ds.sendMessage.bind(ds);
}

export function useStageAttachment() {
  const ds = useDataSource();
  return ds.stageAttachment.bind(ds);
}

export function useRemoveDraftAttachment() {
  const ds = useDataSource();
  return ds.removeDraftAttachment.bind(ds);
}

export function useReactToMessage() {
  const ds = useDataSource();
  return ds.reactToMessage.bind(ds);
}

export function useSpawnAgent() {
  const ds = useDataSource();
  return ds.spawnAgent.bind(ds);
}

export function useArchiveCommands() {
  const ds = useDataSource();
  return {
    archiveSessionPreview: ds.archiveSessionPreview.bind(ds),
    archiveGroupPreview: ds.archiveGroupPreview.bind(ds),
    confirmArchiveSession: ds.confirmArchiveSession.bind(ds),
    confirmArchiveGroup: ds.confirmArchiveGroup.bind(ds),
    resumeSessionPreview: ds.resumeSessionPreview.bind(ds),
    resumeGroupPreview: ds.resumeGroupPreview.bind(ds),
    confirmResumeSession: ds.confirmResumeSession.bind(ds),
    confirmResumeGroup: ds.confirmResumeGroup.bind(ds),
  };
}

export function useSetAgentColor() {
  const ds = useDataSource();
  return ds.setAgentColor.bind(ds);
}

export function useSetAgentModel() {
  const ds = useDataSource();
  return ds.setAgentModel.bind(ds);
}
