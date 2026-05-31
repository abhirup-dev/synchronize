import { expect, test } from "bun:test";
import { transitionLaunch } from "../src/launch/lifecycle.ts";

test("launch transition reducer follows the nominal claude path", () => {
  const spawnStarted = transitionLaunch("accepted", { type: "spawn_started" });
  expect(spawnStarted).toMatchObject({ ok: true, from: "accepted", to: "spawning", enqueueWork: [] });

  const spawned = transitionLaunch("spawning", { type: "spawn_succeeded", promptRequired: true });
  expect(spawned).toMatchObject({ ok: true, to: "prompt_waiting", enqueueWork: ["prompt_confirm"] });

  const promptSeen = transitionLaunch("prompt_waiting", { type: "prompt_seen" });
  expect(promptSeen).toMatchObject({ ok: true, to: "prompt_waiting", enqueueWork: [] });

  const promptAccepted = transitionLaunch("prompt_waiting", { type: "prompt_accepted" });
  expect(promptAccepted).toMatchObject({ ok: true, to: "prompt_accepted", enqueueWork: [] });

  const registered = transitionLaunch("prompt_accepted", { type: "registered" });
  expect(registered).toMatchObject({ ok: true, to: "registered", enqueueWork: ["reconcile"] });

  const reconciling = transitionLaunch("registered", { type: "reconcile_started" });
  expect(reconciling).toMatchObject({ ok: true, to: "reconciling", enqueueWork: [] });

  const joined = transitionLaunch("reconciling", { type: "join_succeeded" });
  expect(joined).toMatchObject({ ok: true, to: "joined", enqueueWork: [] });

  const running = transitionLaunch("joined", { type: "running_observed" });
  expect(running).toMatchObject({ ok: true, to: "running", enqueueWork: ["probe_stale"] });
});

test("launch transition reducer follows the no-prompt path", () => {
  const spawned = transitionLaunch("spawning", { type: "spawn_succeeded", promptRequired: false });
  expect(spawned).toMatchObject({ ok: true, to: "spawned", enqueueWork: [] });

  const registered = transitionLaunch("spawned", { type: "registered" });
  expect(registered).toMatchObject({ ok: true, to: "registered", enqueueWork: ["reconcile"] });
});

test("launch transition reducer records registered_unjoined with reason", () => {
  const failedJoin = transitionLaunch("reconciling", {
    type: "join_failed",
    reason: "alias_collision",
    message: "alias already active",
  });
  expect(failedJoin).toMatchObject({
    ok: true,
    from: "reconciling",
    to: "registered_unjoined",
    reason: "alias_collision",
    message: "alias already active",
    enqueueWork: [],
  });
});

test("launch transition reducer handles stale, failed, and stopped paths", () => {
  expect(transitionLaunch("prompt_waiting", { type: "stale", reason: "prompt_timeout" })).toMatchObject({
    ok: true,
    to: "stale",
    reason: "prompt_timeout",
  });
  expect(transitionLaunch("spawning", { type: "failed", reason: "spawn_failed", message: "aoe add failed" })).toMatchObject({
    ok: true,
    to: "failed",
    reason: "spawn_failed",
    message: "aoe add failed",
  });
  expect(transitionLaunch("registered", { type: "stopped" })).toMatchObject({ ok: true, to: "stopped" });
});

test("launch transition reducer rejects invalid and terminal transitions explicitly", () => {
  expect(transitionLaunch("accepted", { type: "registered" })).toMatchObject({
    ok: false,
    from: "accepted",
    event: "registered",
    enqueueWork: [],
  });
  expect(transitionLaunch("running", { type: "registered" })).toMatchObject({
    ok: false,
    from: "running",
    error: "terminal launch state running cannot transition on registered",
  });
});

test("launch transition reducer does not allow stale before backend evidence exists", () => {
  expect(transitionLaunch("accepted", { type: "stale", reason: "backend_missing" })).toMatchObject({
    ok: false,
    from: "accepted",
    event: "stale",
  });
  expect(transitionLaunch("reconciling", { type: "stale", reason: "executor_lost" })).toMatchObject({
    ok: false,
    from: "reconciling",
    event: "stale",
  });
});

test("launch transition reducer rejects stop from terminal failed state", () => {
  expect(transitionLaunch("failed", { type: "stopped" })).toMatchObject({
    ok: false,
    from: "failed",
    event: "stopped",
  });
});
