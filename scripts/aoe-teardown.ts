#!/usr/bin/env bun
// Delete the AOE profile owned by this synchronize runtime, so wiping the
// runtime home also drops the AOE-backed agent sessions it launched.
// Resilient: a no-op when `aoe` is not installed or the profile doesn't exist.
import { getRuntimePaths } from "../src/paths.ts";
import { aoeProfileName } from "../src/launch/service.ts";

const { home } = getRuntimePaths();
const profile = aoeProfileName(home);

const hasAoe = Bun.spawnSync(["sh", "-c", "command -v aoe"]).exitCode === 0;
if (!hasAoe) {
  console.log(`[aoe-teardown] aoe not installed; skipping (home=${home})`);
  process.exit(0);
}

// `aoe profile delete` removes all sessions in the profile; confirm with y.
Bun.spawnSync(["sh", "-c", `printf 'y\\n' | aoe profile delete ${profile}`], { stdout: "ignore", stderr: "ignore" });
console.log(`[aoe-teardown] deleted AOE profile '${profile}' (home=${home})`);
