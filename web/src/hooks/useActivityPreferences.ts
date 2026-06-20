import { useEffect, useState } from "react";

// Persisted Activity view preferences (grouped-vs-timeline, live-only). These
// are local view state, not daemon state, and survive reload/route changes.
// Stored as plain strings (format preserved from the original ActivityView).
const ACTIVITY_VIEW_MODE_KEY = "synchronize.activity.viewMode";
const ACTIVITY_LIVE_ONLY_KEY = "synchronize.activity.liveOnly";

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private/restricted browser contexts can deny storage; Activity still works
    // with in-memory React state for the current route in that case.
  }
}

export interface ActivityPreferences {
  cluster: boolean;
  setCluster: React.Dispatch<React.SetStateAction<boolean>>;
  aliveOnly: boolean;
  setAliveOnly: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Extracted from ActivityView so the component owns rendering, not persistence
 *  plumbing (sync-imeu.1.21). */
export function useActivityPreferences(): ActivityPreferences {
  const [cluster, setCluster] = useState(() => read(ACTIVITY_VIEW_MODE_KEY) !== "timeline");
  const [aliveOnly, setAliveOnly] = useState(() => read(ACTIVITY_LIVE_ONLY_KEY) === "1");
  useEffect(() => {
    write(ACTIVITY_VIEW_MODE_KEY, cluster ? "grouped" : "timeline");
  }, [cluster]);
  useEffect(() => {
    write(ACTIVITY_LIVE_ONLY_KEY, aliveOnly ? "1" : "0");
  }, [aliveOnly]);
  return { cluster, setCluster, aliveOnly, setAliveOnly };
}
