import { useEffect, useState } from "react";

// Persisted Activity view preferences (grouped-vs-timeline, live-only). These
// are local view state, not daemon state, and survive reload/route changes.
// Stored as plain strings (format preserved from the original ActivityView).
const ACTIVITY_VIEW_MODE_KEY = "synchronize.activity.viewMode";
const ACTIVITY_LIVE_ONLY_KEY = "synchronize.activity.liveOnly";
export type ActivityViewMode = "grouped" | "timeline";

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
  viewMode: ActivityViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ActivityViewMode>>;
  aliveOnly: boolean;
  setAliveOnly: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Extracted from ActivityView so the component owns rendering, not persistence
 *  plumbing (sync-imeu.1.21). */
export function useActivityPreferences(): ActivityPreferences {
  const [viewMode, setViewMode] = useState<ActivityViewMode>(() => read(ACTIVITY_VIEW_MODE_KEY) === "timeline" ? "timeline" : "grouped");
  const [aliveOnly, setAliveOnly] = useState(() => read(ACTIVITY_LIVE_ONLY_KEY) === "1");
  useEffect(() => {
    write(ACTIVITY_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);
  useEffect(() => {
    write(ACTIVITY_LIVE_ONLY_KEY, aliveOnly ? "1" : "0");
  }, [aliveOnly]);
  return { viewMode, setViewMode, aliveOnly, setAliveOnly };
}
