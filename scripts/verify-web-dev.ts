#!/usr/bin/env bun
// Verifies the worktree dev server's request routing against a running stack.
//
//   make web-dev                                    # in one shell
//   bun run scripts/verify-web-dev.ts <origin>      # in another
//
// <origin> defaults to the Portless URL printed by the launcher. It must be the
// origin a browser would use, because that is what exercises the proxy.
//
// This is a script rather than a bun test because it needs a live Vite server,
// which the test suite has no business booting. The checks it makes are the ones
// that fail silently otherwise:
//
//   * client routes must serve the DEV bundle. If they reach the daemon instead,
//     its SPA fallback answers 200 with the PRODUCTION bundle and dead HMR.
//   * daemon routes NOT named in the dev config must still forward, which is what
//     keeps a new backend route from needing a dev-config change.
//   * request BODIES must cross the proxy — sending a message is the most common
//     write in the app and the easiest one to leave untested, since every other
//     check here is a GET.
//   * SSE must stream on an open connection. Buffering until the response ends
//     looks exactly like "SSE works" to any check that waits for completion, and
//     presents to a user as a frozen chat with no error.
const origin = (process.argv[2] ?? process.env["VITE_URL"] ?? "").replace(/\/$/, "");
if (!origin) {
  console.error("usage: bun run scripts/verify-web-dev.ts <origin>");
  console.error("  e.g. bun run scripts/verify-web-dev.ts https://<branch>.synchronize-dev.localhost:1355");
  process.exit(2);
}

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function classify(path: string): Promise<{ status: number; kind: string }> {
  const r = await fetch(origin + path, { redirect: "manual" });
  const type = (r.headers.get("content-type") ?? "").split(";")[0] ?? "";
  const body = await r.text();
  if (type.includes("html")) {
    return { status: r.status, kind: body.includes("/@vite/client") ? "dev-html" : "prod-html" };
  }
  return { status: r.status, kind: type };
}

console.log(`\n== client routes must serve the dev bundle (${origin}) ==`);
// One per grammar form. A form missing from CLIENT_ROUTE_PREFIXES forwards to the
// daemon instead, and its SPA fallback answers 200 with the production bundle.
for (const path of ["/web/", "/web/g/g_abc", "/web/g/by-name/ops", "/web/d/peer-1", "/web/t/1", "/web/e/1", "/web/r/group:1", "/web/activity", "/web/agents"]) {
  const { status, kind } = await classify(path);
  check(status === 200 && kind === "dev-html", path, `${status} ${kind}`);
}

console.log("\n== daemon routes forward, though the dev config names none of them ==");
for (const path of ["/health", "/status", "/peers", "/groups", "/web/state?limit=1"]) {
  const { status, kind } = await classify(path);
  check(status < 500 && kind === "application/json", path, `${status} ${kind}`);
}

console.log("\n== request bodies cross the proxy ==");
const reg = await fetch(`${origin}/peers/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ session_name: `verify-web-dev-${process.pid}`, tool: "cli", purpose: "dev proxy verification" }),
});
const peer = ((await reg.json()) as { peer?: { peer_id: string } }).peer;
check(reg.ok && Boolean(peer), "POST /peers/register", String(reg.status));

console.log("\n== SSE streams on an open connection ==");
if (!peer) {
  check(false, "skipped: no peer to write as");
} else {
  const groups = (await (await fetch(`${origin}/groups`)).json()) as { groups?: Array<{ name: string }> };
  const group = groups.groups?.[0]?.name;
  if (!group) {
    check(false, "skipped: the runtime has no group to write into");
  } else {
    await fetch(`${origin}/groups/${encodeURIComponent(group)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer_id: peer.peer_id, alias: `verify${process.pid % 1000}` }),
    });

    const stream = await fetch(`${origin}/web/events`, { headers: { accept: "text/event-stream" } });
    check((stream.headers.get("content-type") ?? "").includes("event-stream"), "GET /web/events", String(stream.status));

    // Write only after the stream is open, so the event cannot have been
    // buffered before we started listening.
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const sent = await fetch(`${origin}/groups/${encodeURIComponent(group)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_peer_id: peer.peer_id, message: `dev proxy verification ${Date.now()}` }),
    });
    const eventId = ((await sent.json()) as { event?: { event_id: number } }).event?.event_id;
    check(sent.ok && Boolean(eventId), `POST /groups/${group}/messages`, `${sent.status} event_id=${eventId}`);

    const started = Date.now();
    let seen = false;
    let buffered = "";
    while (Date.now() - started < 8_000) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      if (eventId !== undefined && buffered.includes(String(eventId))) {
        seen = true;
        break;
      }
    }
    await reader.cancel();
    check(seen, "the written event arrives while the stream is still open", `${Date.now() - started}ms`);
  }
}

console.log(failures === 0 ? "\nverify-web-dev OK\n" : `\nverify-web-dev FAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
