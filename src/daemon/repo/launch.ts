import { Database } from "bun:sqlite";

import { transitionLaunch, type LaunchLifecycleEvent } from "../../launch/lifecycle.ts";
import {
  appendLaunchEvent,
  updateLaunchState,
  type LaunchIntentRow,
} from "../../launch/store.ts";

export function applyLaunchTransition(ctx: { db: Database }, launch: LaunchIntentRow, event: LaunchLifecycleEvent): LaunchIntentRow {
  const transition = transitionLaunch(launch.state, event);
  const now = new Date().toISOString();
  if (!transition.ok) {
    appendLaunchEvent(ctx.db, {
      launchId: launch.launch_id,
      kind: `launch.invalid.${event.type}`,
      fromState: launch.state,
      toState: launch.state,
      payload: { error: transition.error },
      createdAt: now,
    });
    return launch;
  }
  return updateLaunchState(ctx.db, {
    launchId: launch.launch_id,
    fromState: transition.from,
    state: transition.to,
    eventKind: event.type,
    payload: {
      ...(transition.reason ? { reason: transition.reason } : {}),
      ...(transition.message ? { message: transition.message } : {}),
    },
    failureCode: event.type === "failed" ? event.reason : null,
    failureMessage: "message" in event ? event.message ?? null : null,
    now,
  });
}
