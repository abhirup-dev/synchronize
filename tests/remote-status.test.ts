import { expect, test } from "bun:test";
import { evaluateDoctor, renderDoctor, renderStatusReport, type DoctorInput } from "../src/remote/status.ts";
import type { Peer, StatusResponse } from "../src/api/types.ts";

function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    ok: true,
    pid: 1,
    host: "100.126.163.80",
    port: 58412,
    base_url: "http://100.126.163.80:58412",
    started_at: "2026-06-07T00:00:00.000Z",
    machine: "mac-hub",
    token_required: true,
    home: "/tmp/h",
    db_path: "/tmp/h/db",
    media_path: "/tmp/h/media",
    provenance: { api_version: 1, entrypoint_path: "x", source_root: "x", git_sha: "abcdef1234", git_dirty: false },
    counts: { peers: 3, groups: 2, events: 10 },
    ...overrides,
  };
}

function peer(p: Partial<Peer>): Peer {
  return { peer_id: "p", tool: "claude", session_name: "s", purpose: null, lease_expires_at: "", presence: "online", ...p };
}

test("renderStatusReport groups the roster by machine and marks the hub", () => {
  const peers = [
    peer({ session_name: "worker-a", machine_id: "mac-hub", tool: "claude", presence: "working" }),
    peer({ session_name: "worker-b", machine_id: "vps", tool: "pi", presence: "idle" }),
    peer({ session_name: "worker-c", machine_id: "vps", tool: "claude", presence: "offline" }),
  ];
  const out = renderStatusReport({ source: { remoteUrl: null, profileName: null }, status: status(), peers, localApiVersion: 1 }).join("\n");
  expect(out).toContain("hub: mac-hub  http://100.126.163.80:58412");
  expect(out).toContain("peers 3 · groups 2 · events 10");
  expect(out).toContain("3 peers across 2 machines");
  expect(out).toContain("▸ mac-hub (hub)");
  expect(out).toContain("▸ vps");
  expect(out).toContain("worker-b  [pi]  idle");
});

test("renderStatusReport flags an api-version mismatch between client and hub", () => {
  const out = renderStatusReport({ source: { remoteUrl: "http://h:1", profileName: "hub" }, status: status(), peers: [], localApiVersion: 2 }).join("\n");
  expect(out).toContain("⚠ client api v2 ≠ hub api v1");
  expect(out).toContain("remote profile 'hub'");
  expect(out).toContain("roster: (no peers registered)");
});

test("evaluateDoctor: local mode short-circuits to a single ok", () => {
  const checks = evaluateDoctor({ profileName: null, remoteUrl: null, reachable: null, authOk: null, hubApiVersion: null, localApiVersion: 1 });
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ status: "ok", label: "mode" });
});

test("evaluateDoctor: healthy remote yields all-ok checks", () => {
  const input: DoctorInput = { profileName: "hub", remoteUrl: "http://h:1", reachable: true, authOk: true, hubApiVersion: 1, localApiVersion: 1 };
  const checks = evaluateDoctor(input);
  expect(checks.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok"]);
  expect(renderDoctor(checks).join("\n")).toContain("✓ api version: v1 (matches client)");
});

test("evaluateDoctor: unreachable hub fails and skips downstream checks", () => {
  const checks = evaluateDoctor({ profileName: "hub", remoteUrl: "http://h:1", reachable: false, authOk: null, hubApiVersion: null, localApiVersion: 1 });
  expect(checks.find((c) => c.label === "hub reachable")?.status).toBe("fail");
  expect(checks.some((c) => c.label === "auth")).toBe(false); // skipped when unreachable
});

test("evaluateDoctor: bad token fails auth; version skew warns", () => {
  const checks = evaluateDoctor({ profileName: "hub", remoteUrl: "http://h:1", reachable: true, authOk: false, hubApiVersion: 2, localApiVersion: 1 });
  expect(checks.find((c) => c.label === "auth")?.status).toBe("fail");
  expect(checks.find((c) => c.label === "api version")?.status).toBe("warn");
});
