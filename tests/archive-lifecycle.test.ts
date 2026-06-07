import { expect, test } from "bun:test";
import {
  ARCHIVE_STATES,
  transitionArchive,
  type ArchiveEvent,
  type ArchiveSideEffect,
  type ArchiveState,
} from "../src/lifecycle/archive.ts";

// Full 2x7 transition table. Each cell is either an expected {to, sideEffects}
// for a legal transition, or `null` for an illegal one (ok=false).
type Cell = { to: ArchiveState; sideEffects: ArchiveSideEffect[] } | null;

const EVENTS: ArchiveEvent["type"][] = [
  "archive_requested",
  "lease_expired",
  "reaped",
  "resume_requested",
  "registered",
  "force_killed",
  "delete_requested",
];

const TABLE: Record<ArchiveState, Record<ArchiveEvent["type"], Cell>> = {
  active: {
    archive_requested: { to: "archived", sideEffects: ["reap_backend", "reserve_alias", "emit_event"] },
    lease_expired: { to: "archived", sideEffects: ["reap_backend", "reserve_alias", "emit_event"] },
    reaped: null,
    resume_requested: null,
    registered: { to: "active", sideEffects: [] },
    force_killed: null,
    delete_requested: { to: "active", sideEffects: ["emit_event"] },
  },
  archived: {
    archive_requested: { to: "archived", sideEffects: [] },
    lease_expired: { to: "archived", sideEffects: [] },
    reaped: { to: "archived", sideEffects: [] },
    resume_requested: { to: "archived", sideEffects: ["emit_event"] },
    registered: { to: "active", sideEffects: ["renew_lease", "emit_event"] },
    force_killed: { to: "archived", sideEffects: ["emit_event"] },
    delete_requested: { to: "archived", sideEffects: ["emit_event"] },
  },
};

test("transitionArchive covers every (state, event) pair per the frozen table", () => {
  for (const state of ARCHIVE_STATES) {
    for (const type of EVENTS) {
      const expected = TABLE[state][type];
      const result = transitionArchive(state, { type } as ArchiveEvent);
      if (expected === null) {
        expect(result).toMatchObject({ ok: false, from: state, event: type, sideEffects: [] });
        expect(result.ok).toBe(false);
      } else {
        expect(result).toMatchObject({
          ok: true,
          from: state,
          to: expected.to,
          event: type,
          sideEffects: expected.sideEffects,
        });
      }
    }
  }
});

test("archive from active emits reap_backend regardless of backend (applier gates it)", () => {
  const result = transitionArchive("active", { type: "archive_requested", reason: "operator checkpoint" });
  expect(result).toMatchObject({ ok: true, to: "archived", reason: "operator checkpoint" });
  expect(result.ok && result.sideEffects).toContain("reap_backend");
});

test("auto-archive (lease_expired) from active mirrors explicit archive side-effects", () => {
  const result = transitionArchive("active", { type: "lease_expired" });
  expect(result).toMatchObject({
    ok: true,
    to: "archived",
    sideEffects: ["reap_backend", "reserve_alias", "emit_event"],
  });
});

test("registered on archived is the resurrection edge with a fresh lease (D4/D8)", () => {
  const result = transitionArchive("archived", { type: "registered" });
  expect(result).toMatchObject({ ok: true, from: "archived", to: "active", sideEffects: ["renew_lease", "emit_event"] });
});

test("registered on active is a lifecycle no-op (no resurrection, no side-effects)", () => {
  const result = transitionArchive("active", { type: "registered" });
  expect(result).toMatchObject({ ok: true, from: "active", to: "active", sideEffects: [] });
});

test("resume_requested is intent-only and never flips state by itself", () => {
  expect(transitionArchive("archived", { type: "resume_requested" })).toMatchObject({
    ok: true,
    to: "archived",
    sideEffects: ["emit_event"],
  });
  // illegal from active
  expect(transitionArchive("active", { type: "resume_requested" }).ok).toBe(false);
});

test("force_killed only applies to an archived (live zombie) peer", () => {
  expect(transitionArchive("archived", { type: "force_killed" })).toMatchObject({ ok: true, to: "archived" });
  expect(transitionArchive("active", { type: "force_killed" }).ok).toBe(false);
});

test("idempotent re-archive and reap confirmations do not change state or emit work", () => {
  expect(transitionArchive("archived", { type: "archive_requested" })).toMatchObject({
    ok: true,
    to: "archived",
    sideEffects: [],
  });
  expect(transitionArchive("archived", { type: "lease_expired" })).toMatchObject({
    ok: true,
    to: "archived",
    sideEffects: [],
  });
  expect(transitionArchive("archived", { type: "reaped" })).toMatchObject({
    ok: true,
    to: "archived",
    sideEffects: [],
  });
});

test("delete_requested never changes lifecycle_state (deletion is the soft-delete's job)", () => {
  for (const state of ARCHIVE_STATES) {
    const result = transitionArchive(state, { type: "delete_requested", reason: "operator delete" });
    expect(result).toMatchObject({ ok: true, from: state, to: state, sideEffects: ["emit_event"], reason: "operator delete" });
  }
});

test("invalid transitions report ok=false without mutating", () => {
  const result = transitionArchive("active", { type: "reaped" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.from).toBe("active");
    expect(result.event).toBe("reaped");
    expect(result.error).toContain("invalid archive transition");
    expect(result.sideEffects).toEqual([]);
  }
});
