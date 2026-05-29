import { expect, test } from "bun:test";
import { AoeBackend, buildCmdOverride, parseAoeList, type CommandResult } from "../src/launch/backend.ts";

function recorder(results: Record<string, CommandResult> = {}) {
  const calls: string[][] = [];
  const ok: CommandResult = { exitCode: 0, stdout: "", stderr: "" };
  const run = async (cmd: string[]): Promise<CommandResult> => {
    calls.push(cmd);
    const key = cmd.join(" ");
    for (const [match, res] of Object.entries(results)) {
      if (key.includes(match)) return res;
    }
    return ok;
  };
  return { calls, run };
}

test("buildCmdOverride wraps env + command and quotes spaced values", () => {
  const s = buildCmdOverride({ SYNCHRONIZE_HOME: "/tmp/h", X: "a b" }, ["claude", "--model", "opus"]);
  expect(s.startsWith("env ")).toBe(true);
  expect(s).toContain("SYNCHRONIZE_HOME=/tmp/h");
  expect(s).toContain("'X=a b'");
  expect(s.endsWith("claude --model opus")).toBe(true);
});

test("spawn issues profile create, group create, add, and session start in order", async () => {
  const { calls, run } = recorder();
  const backend = new AoeBackend({ profile: "synchronize-test", run });
  await backend.spawn({
    title: "alice-12345678",
    tool: "claude",
    command: ["claude", "--dangerously-skip-permissions"],
    env: { SYNCHRONIZE_LAUNCH_ID: "lid" },
    cwd: "/repo",
    group: "alpha",
  });
  const joined = calls.map((c) => c.join(" "));
  expect(joined[0]).toBe("aoe profile create synchronize-test");
  expect(joined.some((c) => c === "aoe -p synchronize-test group create alpha")).toBe(true);
  const addIdx = joined.findIndex((c) => c.includes(" add --title alice-12345678"));
  const startIdx = joined.findIndex((c) => c.includes("session start alice-12345678"));
  expect(addIdx).toBeGreaterThan(-1);
  expect(startIdx).toBeGreaterThan(addIdx);
  // add carries the tool, cosmetic group, cwd, and the env-wrapped override.
  const addCall = calls[addIdx]!;
  expect(addCall).toContain("--cmd");
  expect(addCall).toContain("claude");
  expect(addCall).toContain("-g");
  expect(addCall).toContain("alpha");
  expect(addCall).toContain("/repo");
  const overrideIdx = addCall.indexOf("--cmd-override");
  expect(addCall[overrideIdx + 1]).toContain("SYNCHRONIZE_LAUNCH_ID=lid");
});

test("spawn never uses --launch (would fail headless)", async () => {
  const { calls, run } = recorder();
  const backend = new AoeBackend({ profile: "p", run });
  await backend.spawn({ title: "t", tool: "pi", command: ["pi"], env: {}, cwd: "/r" });
  for (const call of calls) {
    expect(call).not.toContain("--launch");
    expect(call).not.toContain("-l");
  }
});

test("standalone spawn (no group) skips group create and -g", async () => {
  const { calls, run } = recorder();
  const backend = new AoeBackend({ profile: "p", run });
  await backend.spawn({ title: "solo-abcd1234", tool: "pi", command: ["pi"], env: {}, cwd: "/r" });
  const joined = calls.map((c) => c.join(" "));
  expect(joined.some((c) => c.includes("group create"))).toBe(false);
  const addCall = calls.find((c) => c.includes("add"))!;
  expect(addCall).not.toContain("-g");
});

test("spawn throws with backend detail when add fails", async () => {
  const { run } = recorder({ " add ": { exitCode: 1, stdout: "", stderr: "boom" } });
  const backend = new AoeBackend({ profile: "p", run });
  await expect(
    backend.spawn({ title: "t", tool: "claude", command: ["claude"], env: {}, cwd: "/r" }),
  ).rejects.toThrow(/aoe add failed.*boom/);
});

test("when session start fails, spawn rolls back the added session and throws", async () => {
  const { calls, run } = recorder({ "session start": { exitCode: 1, stdout: "", stderr: "start boom" } });
  const backend = new AoeBackend({ profile: "p", run });
  await expect(
    backend.spawn({ title: "t-deadbeef", tool: "claude", command: ["claude"], env: {}, cwd: "/r" }),
  ).rejects.toThrow(/aoe session start failed.*start boom/);
  // the added-but-unstarted session is removed so its title isn't orphaned
  expect(calls.some((c) => c.join(" ") === "aoe -p p remove --force t-deadbeef")).toBe(true);
});

test("stop removes by title with --force", async () => {
  const { calls, run } = recorder();
  const backend = new AoeBackend({ profile: "p", run });
  await backend.stop("alice-12345678");
  expect(calls.at(-1)).toEqual(["aoe", "-p", "p", "remove", "--force", "alice-12345678"]);
});

test("list parses the aoe --json array shape", async () => {
  const json = JSON.stringify([
    { id: "8690621c44d7439b", title: "shapeprobe", path: "/private/tmp", group: "demo", tool: "claude", command: "x" },
  ]);
  const { run } = recorder({ "list --json": { exitCode: 0, stdout: json, stderr: "" } });
  const backend = new AoeBackend({ profile: "p", run });
  const sessions = await backend.list();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ title: "shapeprobe", id: "8690621c44d7439b", group: "demo", tool: "claude" });
});

test("parseAoeList tolerates empty/garbage and {sessions:[]} wrapper", () => {
  expect(parseAoeList("")).toEqual([]);
  expect(parseAoeList("not json")).toEqual([]);
  expect(parseAoeList(JSON.stringify({ sessions: [{ title: "w" }] }))).toEqual([{ title: "w" }]);
});

test("ensureReady runs profile create once across calls", async () => {
  const { calls, run } = recorder();
  const backend = new AoeBackend({ profile: "p", run });
  await backend.ensureReady();
  await backend.ensureReady();
  const creates = calls.filter((c) => c.join(" ") === "aoe profile create p");
  expect(creates).toHaveLength(1);
});
