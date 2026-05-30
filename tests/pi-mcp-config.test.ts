import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface PiMcpConfig {
  mcpServers: {
    synchronize: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "synchronize-pi-mcp-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function installPiMcpConfig(configPath: string): Promise<PiMcpConfig["mcpServers"]["synchronize"]> {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "scripts/pi-mcp-config.ts", configPath],
  });
  expect(result.exitCode).toBe(0);
  const config = JSON.parse(await readFile(configPath, "utf8")) as PiMcpConfig;
  return config.mcpServers.synchronize;
}

test("Pi MCP config installs a resilient preflight command", async () => {
  await withTempDir(async (dir) => {
    const entry = await installPiMcpConfig(join(dir, "mcp.json"));

    expect(entry.command).toBe("sh");
    expect(entry.args?.[0]).toBe("-c");
    expect(entry.args?.[1]).toContain("SYNCHRONIZE_CONFIGURED_CLI=");
    expect(entry.args?.[1]).toContain("SYNCHRONIZE_CONFIGURED_MCP=");
    expect(entry.args?.[1]).toContain("status");
    expect(entry.args?.[1]).toContain("exec \"$mcp\"");
    expect(entry.env).toEqual({ SYNCHRONIZE_MCP_MODE: "codex" });
  });
});

test("Pi MCP preflight validates CLI status before executing MCP adapter", async () => {
  await withTempDir(async (dir) => {
    const entry = await installPiMcpConfig(join(dir, "mcp.json"));
    const fakeCli = join(dir, "synchronize");
    const fakeMcp = join(dir, "synchronize-mcp");
    const logPath = join(dir, "calls.log");

    await writeFile(
      fakeCli,
      [
        "#!/bin/sh",
        'printf "cli:%s\\n" "$*" >> "$SYNC_LOG"',
        '[ "$1" = "status" ] && exit 0',
        "exit 9",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCli, 0o755);

    await writeFile(
      fakeMcp,
      [
        "#!/bin/sh",
        'printf "mcp:%s\\n" "$SYNCHRONIZE_MCP_MODE" >> "$SYNC_LOG"',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeMcp, 0o755);

    const result = Bun.spawnSync({
      cmd: [entry.command, ...(entry.args ?? [])],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_CLI: fakeCli,
        SYNCHRONIZE_MCP: fakeMcp,
        SYNCHRONIZE_MCP_MODE: entry.env?.SYNCHRONIZE_MCP_MODE ?? "",
        SYNC_LOG: logPath,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(logPath, "utf8")).toBe("cli:status\nmcp:codex\n");
  });
});

test("Pi MCP preflight fails quietly when status cannot validate a CLI", async () => {
  await withTempDir(async (dir) => {
    const entry = await installPiMcpConfig(join(dir, "mcp.json"));
    const fakeCli = join(dir, "synchronize");
    const logPath = join(dir, "calls.log");

    await writeFile(
      fakeCli,
      [
        "#!/bin/sh",
        'printf "cli:%s\\n" "$*" >> "$SYNC_LOG"',
        "exit 9",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCli, 0o755);

    const result = Bun.spawnSync({
      cmd: [entry.command, ...(entry.args ?? [])],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_CLI: fakeCli,
        SYNCHRONIZE_MCP: join(dir, "missing-synchronize-mcp"),
        SYNCHRONIZE_MCP_MODE: entry.env?.SYNCHRONIZE_MCP_MODE ?? "",
        SYNC_LOG: logPath,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe("");
    expect(await readFile(logPath, "utf8")).toBe("cli:status\n");
  });
});
