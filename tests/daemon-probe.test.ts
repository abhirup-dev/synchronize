// Boundary coverage for the daemon probe: every failure mode gets its own
// variant, and the absent-vs-occupied split is asserted directly because that is
// the distinction autostart policy hangs on.
import { afterAll, expect, test } from "bun:test";
import { API_VERSION } from "../src/constants.ts";
import { isDaemonAbsent, probeDaemon } from "../src/daemon-probe.ts";
import { cleanupDaemonHomes, startDaemon } from "./support/daemon.ts";

afterAll(cleanupDaemonHomes);

/** A stub HTTP server on a free port; returns its base URL and a stopper. */
function serve(handler: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  return { baseUrl: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

test("a real daemon probes healthy and carries /health provenance", async () => {
  const d = await startDaemon();
  try {
    const probe = await probeDaemon(d.baseUrl);
    expect(probe.kind).toBe("healthy");
    if (probe.kind !== "healthy") return;
    expect(probe.health.service).toBe("synchronize");
    expect(probe.health.api_version).toBe(API_VERSION);
    expect(probe.health.pid).toBeGreaterThan(0);
    expect(isDaemonAbsent(probe)).toBe(false);
  } finally {
    await d.stop();
  }
});

test("nothing listening is unreachable AND absent, so autostart is allowed", async () => {
  // Bind a port, then release it, so the port is real but certain to be closed.
  const { baseUrl, stop } = serve(() => new Response("ok"));
  stop();
  const probe = await probeDaemon(baseUrl);
  expect(probe.kind).toBe("unreachable");
  if (probe.kind !== "unreachable") return;
  expect(probe.connectionRefused).toBe(true);
  expect(isDaemonAbsent(probe)).toBe(true);
});

test("a hung daemon times out and is NOT absent — the duplicate-spawn bug", async () => {
  // The exact shape that used to spawn a second daemon onto the first: something
  // holds the endpoint but never answers.
  const { baseUrl, stop } = serve(async () => {
    await Bun.sleep(10_000);
    return new Response("too late");
  });
  try {
    const probe = await probeDaemon(baseUrl, { timeoutMs: 120, attempts: 2 });
    expect(probe.kind).toBe("timed_out");
    if (probe.kind !== "timed_out") return;
    expect(probe.attempts).toBe(2);
    expect(isDaemonAbsent(probe)).toBe(false);
  } finally {
    stop();
  }
});

test("timeouts are retried; a daemon that is merely slow still reads healthy", async () => {
  let calls = 0;
  const { baseUrl, stop } = serve(async () => {
    calls += 1;
    if (calls === 1) await Bun.sleep(400); // miss the first, tight window
    return Response.json({ ok: true, service: "synchronize", api_version: API_VERSION, pid: 1, started_at: "", capabilities: [] });
  });
  try {
    const probe = await probeDaemon(baseUrl, { timeoutMs: 150, attempts: 3 });
    expect(probe.kind).toBe("healthy");
    expect(calls).toBeGreaterThan(1);
  } finally {
    stop();
  }
});

test("401 and 403 report auth_required, not absent", async () => {
  for (const status of [401, 403]) {
    const { baseUrl, stop } = serve(() => new Response("no", { status }));
    try {
      const probe = await probeDaemon(baseUrl);
      expect(probe.kind).toBe("auth_required");
      expect(isDaemonAbsent(probe)).toBe(false);
    } finally {
      stop();
    }
  }
});

test("a wrong service or wrong api_version reports incompatible", async () => {
  const cases: Array<[string, unknown, unknown]> = [
    ["wrong service", { ok: true, service: "something-else", api_version: API_VERSION }, "something-else"],
    ["wrong version", { ok: true, service: "synchronize", api_version: API_VERSION + 1 }, API_VERSION + 1],
    ["empty body", {}, null],
  ];
  for (const [label, body, expectedActual] of cases) {
    const { baseUrl, stop } = serve(() => Response.json(body));
    try {
      const probe = await probeDaemon(baseUrl);
      expect(probe.kind, label).toBe("incompatible");
      if (probe.kind !== "incompatible") continue;
      expect(probe.expected).toBe(API_VERSION);
      expect(probe.actual).toBe(expectedActual);
      expect(isDaemonAbsent(probe)).toBe(false);
    } finally {
      stop();
    }
  }
});

test("a 5xx endpoint is unreachable but NOT refused, so autostart is refused", async () => {
  const { baseUrl, stop } = serve(() => new Response("boom", { status: 500 }));
  try {
    const probe = await probeDaemon(baseUrl);
    expect(probe.kind).toBe("unreachable");
    if (probe.kind !== "unreachable") return;
    expect(probe.connectionRefused).toBe(false);
    expect(isDaemonAbsent(probe)).toBe(false);
  } finally {
    stop();
  }
});

test("non-JSON on /health reports incompatible rather than healthy", async () => {
  const { baseUrl, stop } = serve(() => new Response("<html>not a daemon</html>", { headers: { "content-type": "text/html" } }));
  try {
    expect((await probeDaemon(baseUrl)).kind).toBe("incompatible");
  } finally {
    stop();
  }
});

test("the probe mutates nothing: a missing home stays missing", async () => {
  const home = `${import.meta.dir}/../.probe-should-never-create-this`;
  process.env["SYNCHRONIZE_HOME"] = home;
  try {
    const probe = await probeDaemon("http://127.0.0.1:1/");
    expect(probe.kind).toBe("unreachable");
    expect(await Bun.file(home).exists()).toBe(false);
  } finally {
    delete process.env["SYNCHRONIZE_HOME"];
  }
});
