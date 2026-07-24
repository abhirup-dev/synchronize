#!/usr/bin/env bun
// Read-only daemon status. Reports what is at the discovered endpoint and exits
// non-zero if it is not usable. Starts nothing, stops nothing, writes nothing —
// recovery is always an explicit verb (`make daemon-relaunch`).
//
//   bun run scripts/daemon-status.ts [--json] [--recover-with <make-target>]
//
// Honours SYNCHRONIZE_HOME, so the same script serves the production and
// isolated dev runtimes; the caller names its own recovery target so the hint
// points at the right one.
import { ENV_TOKEN } from "../src/constants.ts";
import { DAEMON_ERROR_CODES, describeProbe, probeDaemon, type DaemonProbe } from "../src/daemon-probe.ts";
import { readJson } from "../src/fs.ts";
import { getRuntimePaths } from "../src/paths.ts";
import type { Discovery } from "../src/client.ts";

const json = process.argv.includes("--json");
const recoverWith = process.argv[process.argv.indexOf("--recover-with") + 1] ?? "daemon-relaunch";
const paths = getRuntimePaths();
const discovery = await readJson<Discovery>(paths.discoveryPath);
const probe: DaemonProbe = discovery?.baseUrl
  ? await probeDaemon(discovery.baseUrl, { token: process.env[ENV_TOKEN] ?? null, attempts: 2 })
  : { kind: "discovery_missing" };

if (json) {
  console.log(JSON.stringify({ home: paths.home, discovery, probe }, null, 2));
} else {
  console.log(`home       ${paths.home}`);
  console.log(`discovery  ${discovery ? `${discovery.baseUrl} pid=${discovery.pid} started_at=${discovery.startedAt}` : "(absent)"}`);
  console.log(`probe      ${describeProbe(probe)}`);
  if (probe.kind === "healthy" && probe.health.provenance) {
    const p = probe.health.provenance;
    console.log(`source     ${p.source_root} @ ${p.git_sha ?? "unknown"}${p.git_dirty ? " (dirty)" : ""}`);
    console.log(`entrypoint ${p.entrypoint_path}`);
  }
}

if (probe.kind !== "healthy") {
  console.error(`\n${DAEMON_ERROR_CODES[probe.kind]} — not usable. 'make ${recoverWith}' recovers without wiping state.`);
  process.exit(1);
}
