import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHostArgs } from "../src/cli/commands/host.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

test("parseHostArgs resolves flags and env defaults", () => {
  expect(
    parseHostArgs(["--restart"], {
      SYNCHRONIZE_BIND: "100.126.163.80",
      SYNCHRONIZE_PORT: "58410",
      SYNCHRONIZE_TOKEN: "secret",
      SYNCHRONIZE_HOME: "/tmp/sync",
    }),
  ).toEqual({
    bind: "100.126.163.80",
    port: "58410",
    token: "secret",
    home: "/tmp/sync",
    restart: true,
  });

  expect(parseHostArgs(["--bind", "127.0.0.1", "--token", "secret"], {})).toMatchObject({
    bind: "127.0.0.1",
    port: "58405",
    token: "secret",
    restart: false,
  });
});

test("parseHostArgs rejects missing required values and bad ports", () => {
  expect(() => parseHostArgs(["--token", "secret"], {})).toThrow("host requires --bind");
  expect(() => parseHostArgs(["--bind", "127.0.0.1"], {})).toThrow("host requires --token");
  expect(() => parseHostArgs(["--bind", "127.0.0.1", "--token", "secret", "--port", "abc"], {})).toThrow(
    "host --port must be a non-negative integer",
  );
  expect(() => parseHostArgs(["--bind"], {})).toThrow("host --bind requires a value");
  expect(() => parseHostArgs(["--bind", "127.0.0.1", "--token", "secret", "--bogus"], {})).toThrow(
    "host: unexpected argument '--bogus'",
  );
});

test("host command starts a token-protected daemon and prints remote client env", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-host-"));
  homes.push(home);
  let pid: number | null = null;

  try {
    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        "src/cli.ts",
        "host",
        "--home",
        home,
        "--bind",
        "127.0.0.1",
        "--port",
        "0",
        "--token",
        "secret",
      ],
    });
    expect(proc.exitCode).toBe(0);
    const body = JSON.parse(proc.stdout.toString()) as {
      pid: number;
      host: string;
      port: number;
      base_url: string;
      token_required: boolean;
      daemon_started_by_cli: boolean;
      remote_env: { SYNCHRONIZE_REMOTE_URL: string; SYNCHRONIZE_TOKEN: string };
    };
    pid = body.pid;
    expect(body).toMatchObject({
      host: "127.0.0.1",
      token_required: true,
      daemon_started_by_cli: true,
      remote_env: {
        SYNCHRONIZE_REMOTE_URL: body.base_url,
        SYNCHRONIZE_TOKEN: "<shared-token>",
      },
    });

    expect((await fetch(`${body.base_url}/status`)).status).toBe(401);
    const authed = await fetch(`${body.base_url}/status`, { headers: { authorization: "Bearer secret" } });
    expect(authed.status).toBe(200);
    expect(await authed.json()).toMatchObject({ home, token_required: true });
  } finally {
    if (pid) await killPid(pid);
  }
}, 15_000);

test("host command ignores inherited SYNCHRONIZE_REMOTE_URL while starting the local host daemon", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-host-ignore-remote-"));
  homes.push(home);
  let pid: number | null = null;

  try {
    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        "src/cli.ts",
        "host",
        "--home",
        home,
        "--bind",
        "127.0.0.1",
        "--port",
        "0",
        "--token",
        "secret",
      ],
      env: {
        ...process.env,
        SYNCHRONIZE_REMOTE_URL: "http://127.0.0.1:9",
      },
    });
    expect(proc.exitCode).toBe(0);
    const body = JSON.parse(proc.stdout.toString()) as { pid: number; base_url: string; token_required: boolean };
    pid = body.pid;
    expect(body.token_required).toBe(true);
    expect(body.base_url).not.toBe("http://127.0.0.1:9");
  } finally {
    if (pid) await killPid(pid);
  }
}, 15_000);

test("host command refuses to reuse an incompatible daemon without --restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-host-mismatch-"));
  homes.push(home);
  let pid: number | null = null;

  try {
    const initial = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    });
    expect(initial.exitCode).toBe(0);
    pid = (JSON.parse(initial.stdout.toString()) as { pid: number }).pid;

    const host = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        "src/cli.ts",
        "host",
        "--home",
        home,
        "--bind",
        "127.0.0.1",
        "--port",
        "0",
        "--token",
        "secret",
      ],
    });
    expect(host.exitCode).not.toBe(0);
    expect(host.stderr.toString()).toContain("rerun with --restart");
    expect(isAlive(pid)).toBe(true);
  } finally {
    if (pid) await killPid(pid);
  }
}, 15_000);

test("host command restarts an incompatible daemon when --restart is explicit", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-host-restart-"));
  homes.push(home);
  let oldPid: number | null = null;
  let newPid: number | null = null;

  try {
    const initial = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    });
    expect(initial.exitCode).toBe(0);
    oldPid = (JSON.parse(initial.stdout.toString()) as { pid: number }).pid;

    const restarted = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        "src/cli.ts",
        "host",
        "--home",
        home,
        "--bind",
        "127.0.0.1",
        "--port",
        "0",
        "--token",
        "secret",
        "--restart",
      ],
    });
    expect(restarted.exitCode).toBe(0);
    const body = JSON.parse(restarted.stdout.toString()) as { pid: number; base_url: string; token_required: boolean };
    newPid = body.pid;
    expect(newPid).not.toBe(oldPid);
    expect(body.token_required).toBe(true);
    expect(isAlive(oldPid)).toBe(false);
    expect((await fetch(`${body.base_url}/status`)).status).toBe(401);
    expect((await fetch(`${body.base_url}/status`, { headers: { authorization: "Bearer secret" } })).status).toBe(200);
  } finally {
    if (oldPid && isAlive(oldPid)) await killPid(oldPid);
    if (newPid && isAlive(newPid)) await killPid(newPid);
  }
}, 15_000);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killPid(pid: number): Promise<void> {
  try {
    process.kill(pid);
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Bun.sleep(50);
    if (!isAlive(pid)) return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}
