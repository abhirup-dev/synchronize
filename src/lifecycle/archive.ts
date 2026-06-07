// Pure archive/resume lifecycle reducer.
//
// Shaped exactly like src/launch/lifecycle.ts: a side-effect-free reducer that
// every archive/resume flow drives. It computes the next lifecycle_state and a
// list of side-effect TOKENS; the daemon applier is responsible for actually
// performing them (and for gating reap_backend on AOE vs non-AOE — see below).
//
// MODEL (two orthogonal axes — see docs/plans/resumable-archived-sessions.md §5):
//   PRESENCE  (lease_expires_at)   — online/offline, moved by heartbeat/activity
//   LIFECYCLE (this machine)       — active | archived
// Deletion is a THIRD orthogonal axis (the existing `deleted_at` tombstone) and
// is intentionally NOT a state here: `delete_requested` only emits an event and
// leaves lifecycle_state unchanged; the daemon's existing soft-delete owns the
// `deleted_at` write. Adding a `deleted` state would contradict the two-state
// contract every consumer relies on.
//
// DELIBERATE ABSENCES:
//   * No `heartbeat`/`activity` event. That absence is what structurally
//     enforces D1 — heartbeats move PRESENCE only, never lifecycle. The
//     lease-touch path stays entirely outside this module.
//   * `reap_backend` is ALWAYS emitted when archiving, AOE-managed or not. The
//     daemon applier decides whether to actually reap (execute for AOE, skip for
//     a non-AOE session it does not own — Flow B/D). Keep that decision out of
//     the pure machine.

export const ARCHIVE_STATES = ["active", "archived"] as const;

export type ArchiveState = (typeof ARCHIVE_STATES)[number];

export type ArchiveSideEffect = "reap_backend" | "reserve_alias" | "renew_lease" | "emit_event";

export type ArchiveEvent =
  | { type: "archive_requested"; reason?: string }
  | { type: "lease_expired" }
  | { type: "reaped" }
  | { type: "resume_requested" }
  | { type: "registered" }
  | { type: "force_killed" }
  | { type: "delete_requested"; reason?: string };

export type ArchiveEventType = ArchiveEvent["type"];

export type ArchiveTransitionResult =
  | {
      ok: true;
      from: ArchiveState;
      to: ArchiveState;
      event: ArchiveEventType;
      sideEffects: ArchiveSideEffect[];
      reason?: string;
    }
  | {
      ok: false;
      from: ArchiveState;
      event: ArchiveEventType;
      error: string;
      sideEffects: [];
    };

export function transitionArchive(state: ArchiveState, event: ArchiveEvent): ArchiveTransitionResult {
  // delete_requested is accepted from any state but never changes lifecycle_state
  // (deletion is the existing soft-delete's job — see header). It is recorded so
  // callers can audit/emit, then they invoke the existing soft-delete path.
  if (event.type === "delete_requested") {
    return ok(state, state, event, ["emit_event"], event.reason);
  }

  switch (state) {
    case "active":
      switch (event.type) {
        case "archive_requested":
          return ok(state, "archived", event, ["reap_backend", "reserve_alias", "emit_event"], event.reason);
        case "lease_expired":
          // Auto-archive: the caller has already confirmed auto-archive is ON for
          // this peer/group before sending lease_expired into the machine.
          return ok(state, "archived", event, ["reap_backend", "reserve_alias", "emit_event"]);
        case "registered":
          // A re-register of an already-active peer is a lifecycle no-op. The
          // daemon should only call the machine on register in the archived
          // resurrection case; this branch keeps that path safe regardless.
          return ok(state, "active", event, []);
        default:
          return invalid(state, event);
      }

    case "archived":
      switch (event.type) {
        case "registered":
          // D4/D8 resurrection: re-registration of an archived identity revives
          // it and resets the lease (fresh TTL on resume).
          return ok(state, "active", event, ["renew_lease", "emit_event"]);
        case "resume_requested":
          // Intent only: the actual revive happens on `registered`. The spawn
          // side-effect is enqueued via the existing launch_work queue by the
          // caller, not represented as a side-effect token here.
          return ok(state, "archived", event, ["emit_event"]);
        case "force_killed":
          // A live-but-archived zombie was killed; it is now resume-eligible.
          return ok(state, "archived", event, ["emit_event"]);
        case "reaped":
          // Idempotent confirmation that the backend session is gone.
          return ok(state, "archived", event, []);
        case "archive_requested":
        case "lease_expired":
          // Already archived: idempotent no-op.
          return ok(state, "archived", event, []);
        default:
          return invalid(state, event);
      }
  }
}

function ok(
  from: ArchiveState,
  to: ArchiveState,
  event: ArchiveEvent,
  sideEffects: ArchiveSideEffect[],
  reason?: string,
): ArchiveTransitionResult {
  return {
    ok: true,
    from,
    to,
    event: event.type,
    sideEffects,
    ...(reason ? { reason } : {}),
  };
}

function invalid(state: ArchiveState, event: ArchiveEvent, error?: string): ArchiveTransitionResult {
  return {
    ok: false,
    from: state,
    event: event.type,
    error: error ?? `invalid archive transition from ${state} on ${event.type}`,
    sideEffects: [],
  };
}
