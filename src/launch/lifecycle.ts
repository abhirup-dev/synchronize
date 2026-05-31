export const LAUNCH_STATES = [
  "accepted",
  "spawning",
  "spawned",
  "prompt_waiting",
  "prompt_accepted",
  "registered",
  "reconciling",
  "joined",
  "running",
  "registered_unjoined",
  "stale",
  "failed",
  "stopped",
] as const;

export type LaunchState = (typeof LAUNCH_STATES)[number];

export const TERMINAL_LAUNCH_STATES = ["running", "registered_unjoined", "stale", "failed", "stopped"] as const;

export type TerminalLaunchState = (typeof TERMINAL_LAUNCH_STATES)[number];

export type LaunchWorkKind = "spawn" | "prompt_confirm" | "reconcile" | "probe_stale";

export type RegisteredUnjoinedReason = "alias_collision" | "missing_group" | "join_failed" | "peer_mismatch";
export type StaleReason = "backend_missing" | "registration_timeout" | "prompt_timeout" | "executor_lost";
export type FailedReason = "spawn_failed" | "prompt_failed" | "reconcile_failed" | "max_attempts_exceeded";

export type LaunchLifecycleEvent =
  | { type: "spawn_started" }
  | { type: "spawn_succeeded"; promptRequired: boolean }
  | { type: "prompt_seen" }
  | { type: "prompt_accepted" }
  | { type: "registered" }
  | { type: "reconcile_started" }
  | { type: "join_succeeded" }
  | { type: "join_failed"; reason: RegisteredUnjoinedReason; message?: string }
  | { type: "running_observed" }
  | { type: "stale"; reason: StaleReason; message?: string }
  | { type: "failed"; reason: FailedReason; message?: string }
  | { type: "stopped"; reason?: string };

export type LaunchTransitionResult =
  | {
      ok: true;
      from: LaunchState;
      to: LaunchState;
      event: LaunchLifecycleEvent["type"];
      enqueueWork: LaunchWorkKind[];
      reason?: string;
      message?: string;
    }
  | {
      ok: false;
      from: LaunchState;
      event: LaunchLifecycleEvent["type"];
      error: string;
      enqueueWork: [];
    };

export function isTerminalLaunchState(state: LaunchState): state is TerminalLaunchState {
  return (TERMINAL_LAUNCH_STATES as readonly string[]).includes(state);
}

export function transitionLaunch(state: LaunchState, event: LaunchLifecycleEvent): LaunchTransitionResult {
  if (event.type === "stopped") {
    if (state === "stopped") return invalidTransition(state, event, "launch is already stopped");
    if (state === "failed") return invalidTransition(state, event, "failed launch cannot be stopped");
    return okTransition(state, "stopped", event, []);
  }

  if (isTerminalLaunchState(state)) {
    return invalidTransition(state, event, `terminal launch state ${state} cannot transition on ${event.type}`);
  }

  if (event.type === "failed") {
    if (!["accepted", "spawning", "spawned", "prompt_waiting", "prompt_accepted", "registered", "reconciling"].includes(state)) {
      return invalidTransition(state, event, `launch state ${state} cannot fail on ${event.type}`);
    }
    return okTransition(state, "failed", event, [], event.reason, event.message);
  }

  if (event.type === "stale") {
    if (!["spawned", "prompt_waiting", "prompt_accepted", "registered"].includes(state)) {
      return invalidTransition(state, event, `launch state ${state} cannot become stale`);
    }
    return okTransition(state, "stale", event, [], event.reason, event.message);
  }

  switch (state) {
    case "accepted":
      if (event.type === "spawn_started") return okTransition(state, "spawning", event, []);
      return invalidTransition(state, event);

    case "spawning":
      if (event.type === "spawn_succeeded") {
        return okTransition(state, event.promptRequired ? "prompt_waiting" : "spawned", event, event.promptRequired ? ["prompt_confirm"] : []);
      }
      return invalidTransition(state, event);

    case "spawned":
      if (event.type === "registered") return okTransition(state, "registered", event, ["reconcile"]);
      return invalidTransition(state, event);

    case "prompt_waiting":
      if (event.type === "prompt_seen") return okTransition(state, "prompt_waiting", event, []);
      if (event.type === "prompt_accepted") return okTransition(state, "prompt_accepted", event, []);
      if (event.type === "registered") return okTransition(state, "registered", event, ["reconcile"]);
      return invalidTransition(state, event);

    case "prompt_accepted":
      if (event.type === "registered") return okTransition(state, "registered", event, ["reconcile"]);
      return invalidTransition(state, event);

    case "registered":
      if (event.type === "reconcile_started") return okTransition(state, "reconciling", event, []);
      if (event.type === "running_observed") return okTransition(state, "running", event, []);
      return invalidTransition(state, event);

    case "reconciling":
      if (event.type === "join_succeeded") return okTransition(state, "joined", event, []);
      if (event.type === "join_failed") return okTransition(state, "registered_unjoined", event, [], event.reason, event.message);
      return invalidTransition(state, event);

    case "joined":
      if (event.type === "running_observed") return okTransition(state, "running", event, ["probe_stale"]);
      return invalidTransition(state, event);
  }
}

function okTransition(
  from: LaunchState,
  to: LaunchState,
  event: LaunchLifecycleEvent,
  enqueueWork: LaunchWorkKind[],
  reason?: string,
  message?: string,
): LaunchTransitionResult {
  return {
    ok: true,
    from,
    to,
    event: event.type,
    enqueueWork,
    ...(reason ? { reason } : {}),
    ...(message ? { message } : {}),
  };
}

function invalidTransition(state: LaunchState, event: LaunchLifecycleEvent, error?: string): LaunchTransitionResult {
  return {
    ok: false,
    from: state,
    event: event.type,
    error: error ?? `invalid launch transition from ${state} on ${event.type}`,
    enqueueWork: [],
  };
}
