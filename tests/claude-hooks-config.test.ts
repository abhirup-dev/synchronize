import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "synchronize-claude-hooks-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function installHook(settingsPath: string): Promise<string> {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "scripts/claude-hooks-config.ts", settingsPath],
  });
  expect(result.exitCode).toBe(0);
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
  };
  return settings.hooks.SessionStart[0]!.hooks[0]!.command;
}

test("Claude hook config installs a resilient preflight command", async () => {
  await withTempDir(async (dir) => {
    const settingsPath = join(dir, "settings.json");
    const command = await installHook(settingsPath);

    expect(command).toContain("SYNCHRONIZE_CONFIGURED_CLI=");
    expect(command).toContain("SYNCHRONIZE_HOOK_ENABLE");
    expect(command).toContain("status");
    expect(command).toContain("hook claude-session");
    expect(command).not.toBe("synchronize hook claude-session");
  });
});

test("installs the activity presence hooks alongside SessionStart", async () => {
  await withTempDir(async (dir) => {
    const settingsPath = join(dir, "settings.json");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "scripts/claude-hooks-config.ts", settingsPath],
    });
    expect(result.exitCode).toBe(0);
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const cmd = (event: string) => settings.hooks[event]![0]!.hooks[0]!.command;
    expect(cmd("SessionStart")).toContain("hook claude-session");
    expect(cmd("UserPromptSubmit")).toContain("hook activity --state working");
    expect(cmd("PreToolUse")).toContain("hook activity --state working");
    expect(cmd("Stop")).toContain("hook activity --state idle");

    // Remove cleans up every installed hook event.
    const removed = Bun.spawnSync({
      cmd: [process.execPath, "run", "scripts/claude-hooks-config.ts", "--remove", settingsPath],
    });
    expect(removed.exitCode).toBe(0);
    const after = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: Record<string, unknown[]>;
    };
    for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"]) {
      expect(after.hooks[event] ?? []).toHaveLength(0);
    }
  });
});

test("Claude activity hook posts the host-session form for the given state", async () => {
  await withTempDir(async (dir) => {
    const fakeCli = join(dir, "synchronize");
    const logPath = join(dir, "calls.log");
    await writeFile(
      fakeCli,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$SYNC_LOG"',
        '[ "$1" = "status" ] && exit 0',
        '[ "$1" = "hook" ] && [ "$2" = "activity" ] && cat >/dev/null && exit 0',
        "exit 9",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCli, 0o755);
    // Reproduce the installed Stop command and run it with a session payload.
    const settingsPath = join(dir, "settings.json");
    Bun.spawnSync({ cmd: [process.execPath, "run", "scripts/claude-hooks-config.ts", settingsPath] });
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.Stop![0]!.hooks[0]!.command;

    const result = Bun.spawnSync({
      cmd: ["sh", "-c", `printf '%s' '{"session_id":"claude-x"}' | ${command}`],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_HOOK_ENABLE: "1",
        SYNCHRONIZE_CLI: fakeCli,
        SYNC_LOG: logPath,
      },
    });
    expect(result.exitCode).toBe(0);
    expect(await readFile(logPath, "utf8")).toBe("status\nhook activity --state idle\n");
  });
});

test("Claude hook preflight exits quietly unless enabled", async () => {
  await withTempDir(async (dir) => {
    const settingsPath = join(dir, "settings.json");
    const command = await installHook(settingsPath);

    const result = Bun.spawnSync({
      cmd: ["sh", "-c", command],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_CLI: join(dir, "missing-synchronize"),
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
  });
});

test("Claude hook preflight runs status before session ingestion", async () => {
  await withTempDir(async (dir) => {
    const settingsPath = join(dir, "settings.json");
    const command = await installHook(settingsPath);
    const fakeCli = join(dir, "synchronize");
    const logPath = join(dir, "calls.log");
    await writeFile(
      fakeCli,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$SYNC_LOG"',
        '[ "$1" = "status" ] && exit 0',
        '[ "$1 $2" = "hook claude-session" ] && cat >/dev/null && exit 0',
        "exit 9",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCli, 0o755);

    const result = Bun.spawnSync({
      cmd: ["sh", "-c", `printf '%s' '{"session_id":"claude-session"}' | ${command}`],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_HOOK_ENABLE: "1",
        SYNCHRONIZE_CLI: fakeCli,
        SYNC_LOG: logPath,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(logPath, "utf8")).toBe("status\nhook claude-session\n");
  });
});
