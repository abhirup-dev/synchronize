import { expect, test } from "bun:test";
import { ALL_HARNESS_SCENARIOS, buildHarnessPlan, buildProvisionPlan, buildSyncPlan, renderRemoteConfig } from "../src/remote/plan.ts";
import { parseConfig } from "../src/config.ts";

// Pure unit tests for the remote command plans — they assert the exact ssh/rsync
// invocations BEFORE any remote machine is touched (the value of plan/execute
// separation + --dry-run).

test("provision plan verifies tools against an augmented PATH", () => {
  const plan = buildProvisionPlan({ sshHost: "vpsme" });
  const verify = plan[0]!;
  expect(verify.argv[0]).toBe("ssh");
  expect(verify.argv[1]).toBe("vpsme");
  // Resolves tools against ~/.local/bin so a tool only there still counts.
  expect(verify.argv[2]).toContain('export PATH="$HOME/.local/bin:$PATH"');
  for (const tool of ["bun", "aoe", "pi", "claude", "uv"]) {
    expect(verify.argv[2]).toContain(`command -v ${tool}`);
  }
});

test("sync plan: dirs → rsync → install → write config → verify", () => {
  const plan = buildSyncPlan({
    sshHost: "vpsme",
    remotePath: "~/synchronize-runtime",
    localRoot: "/repo/",
    hubUrl: "http://100.126.163.80:58412",
    token: "shared-token",
  });
  expect(plan.map((s) => s.name)).toEqual([
    "ensure remote dirs",
    "rsync runtime",
    "bun install (remote)",
    "write remote config.toml",
    "verify hub reachable from remote",
  ]);
  // rsync excludes heavy/irrelevant dirs and uses a trailing-slash source.
  const rsync = plan.find((s) => s.name === "rsync runtime")!;
  expect(rsync.argv[0]).toBe("rsync");
  expect(rsync.argv).toContain("--exclude");
  expect(rsync.argv).toContain("node_modules");
  expect(rsync.argv).toContain(".git");
  expect(rsync.argv.at(-2)).toBe("/repo/"); // trailing slash normalized
  expect(rsync.argv.at(-1)).toBe("vpsme:~/synchronize-runtime/");
  // verify step is optional (hub may be down at sync time).
  expect(plan.find((s) => s.name === "verify hub reachable from remote")?.optional).toBe(true);
});

test("tilde remote paths stay shell-expandable (not quoted into a literal ~ dir)", () => {
  const plan = buildSyncPlan({ sshHost: "h", remotePath: "~/synchronize-runtime", localRoot: "/repo", hubUrl: "http://h:1" });
  const mkdir = plan.find((s) => s.name === "ensure remote dirs")!;
  // ~/ left unquoted so the remote shell expands it; the rest is quoted.
  expect(mkdir.argv[2]).toContain("mkdir -p ~/'synchronize-runtime'");
  expect(mkdir.argv[2]).not.toContain("'~/synchronize-runtime'"); // the bug we fixed
});

test("sync plan: --skip-install omits the bun install step", () => {
  const plan = buildSyncPlan({
    sshHost: "h",
    remotePath: "/r",
    localRoot: "/repo",
    hubUrl: "http://h:1",
    skipInstall: true,
  });
  expect(plan.map((s) => s.name)).not.toContain("bun install (remote)");
});

test("remote config.toml points at the hub with a literal token", () => {
  const toml = renderRemoteConfig({ hubUrl: "http://100.126.163.80:58412", token: "shared-token" });
  const config = parseConfig(toml);
  expect(config.active).toBe("hub");
  expect(config.remotes.hub).toEqual({ url: "http://100.126.163.80:58412", token: "shared-token" });
});

test("remote config.toml can use token_env instead of a literal", () => {
  const toml = renderRemoteConfig({ hubUrl: "http://h:1", tokenEnv: "SYNCHRONIZE_TOKEN" });
  const config = parseConfig(toml);
  expect(config.remotes.hub).toEqual({ url: "http://h:1", tokenEnv: "SYNCHRONIZE_TOKEN" });
});

test("harness plan: one ssh step per scenario, pointed at the hub with timeouts", () => {
  const plan = buildHarnessPlan({
    sshHost: "vpsme",
    remotePath: "~/synchronize-runtime",
    hubUrl: "http://100.126.163.80:58412",
    token: "tok",
    scenarios: ["cli-dm", "pi-thread-baton"],
  });
  expect(plan).toHaveLength(2);
  const cli = plan[0]!.argv[2]!;
  expect(plan[0]!.argv[0]).toBe("ssh");
  expect(cli).toContain("uv run scripts/integration_tmux.py");
  expect(cli).toContain("'--remote-url' 'http://100.126.163.80:58412'");
  expect(cli).toContain("'--remote-token' 'tok'");
  expect(cli).toContain("cd ~/'synchronize-runtime'");
  // Pi thread-baton gets its longer command timeout.
  expect(plan[1]!.argv[2]).toContain("scripts/integration_thread_baton_pi.py");
  expect(plan[1]!.argv[2]).toContain("'--command-timeout' '240'");
});

test("harness plan: --all covers every known scenario; extraArgs appended", () => {
  const plan = buildHarnessPlan({
    sshHost: "h",
    remotePath: "/r",
    hubUrl: "http://h:1",
    scenarios: ALL_HARNESS_SCENARIOS,
    extraArgs: ["--keep"],
  });
  expect(plan).toHaveLength(6);
  expect(plan.every((s) => s.argv[2]!.includes("--keep"))).toBe(true);
});

test("harness plan: unknown scenario throws with the known list", () => {
  expect(() => buildHarnessPlan({ sshHost: "h", remotePath: "/r", hubUrl: "http://h:1", scenarios: ["nope"] })).toThrow(/unknown harness scenario/);
});

test("write-config step carries the toml as stdin (no fragile heredoc quoting)", () => {
  const plan = buildSyncPlan({ sshHost: "h", remotePath: "/r", localRoot: "/repo", hubUrl: "http://h:1", token: "t" });
  const writeStep = plan.find((s) => s.name === "write remote config.toml")!;
  expect(writeStep.argv).toContain("ssh");
  expect(writeStep.stdin).toBeDefined();
  expect(parseConfig(writeStep.stdin!).remotes.hub?.url).toBe("http://h:1");
});
