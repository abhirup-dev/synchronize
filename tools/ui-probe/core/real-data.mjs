import { readFileSync } from "node:fs";

export function loadStateFromEnv() {
  const statePath = process.env.UI_PROBE_STATE_JSON;
  if (!statePath) throw new Error("UI_PROBE_STATE_JSON is required");
  return JSON.parse(readFileSync(statePath, "utf8"));
}

export function snippet(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 48);
}

export function topThreadRoots(state, groupId) {
  return state.events
    .filter((event) =>
      event.type === "group_message" &&
      event.group_id === groupId &&
      event.parent_event_id === null &&
      event.reply_count > 1 &&
      Boolean(event.body?.trim()),
    )
    .sort((a, b) => b.event_id - a.event_id)
    .slice(0, 5);
}

export function groupWithTopThreads(state, minRoots = 2) {
  return state.groups.find((candidate) => topThreadRoots(state, candidate.group_id).length >= minRoots);
}

export function activityThreadWithReaction(state) {
  return state.events.findLast((event) =>
    event.type === "group_message" &&
    (event.reply_count > 0 || event.parent_event_id !== null) &&
    event.reactions?.length > 0 &&
    Boolean(event.body?.trim()),
  );
}
