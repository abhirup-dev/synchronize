import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

test("daemon exposes health and authenticated status", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-health-"));
  homes.push(home);
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: home,
      SYNCHRONIZE_PORT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const discoveryPath = join(home, "daemon.json");
    let discovery: { baseUrl: string } | null = null;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        discovery = await Bun.file(discoveryPath).json();
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
    expect(discovery).not.toBeNull();

    const health = await fetch(`${discovery!.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "synchronize", api_version: 1 });

    const status = await fetch(`${discovery!.baseUrl}/status`);
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body).toMatchObject({
      ok: true,
      home,
      token_required: false,
      counts: { peers: 0, groups: 0, events: 0 },
    });
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("protected REST routes require bearer token when LAN bind is enabled", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-token-"));
  homes.push(home);
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: home,
      SYNCHRONIZE_BIND: "0.0.0.0",
      SYNCHRONIZE_TOKEN: "secret",
      SYNCHRONIZE_PORT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const discoveryPath = join(home, "daemon.json");
    let discovery: { port: number } | null = null;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        discovery = await Bun.file(discoveryPath).json();
        const health = await fetch(`http://127.0.0.1:${discovery!.port}/health`).catch(() => null);
        if (health?.ok) break;
      } catch {
        await Bun.sleep(50);
      }
    }
    expect(discovery).not.toBeNull();

    const baseUrl = `http://127.0.0.1:${discovery!.port}`;
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/status`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/status`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const authorized = await fetch(`${baseUrl}/status`, { headers: { authorization: "Bearer secret" } });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ ok: true, token_required: true });
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("CLI-launched daemon stays alive across separate CLI processes", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-cli-daemon-"));
  homes.push(home);
  let daemonPid: number | null = null;

  try {
    const first = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home },
    });
    expect(first.exitCode).toBe(0);
    const firstStatus = JSON.parse(first.stdout.toString()) as { pid: number; daemon_started_by_cli: boolean };
    daemonPid = firstStatus.pid;
    expect(firstStatus.daemon_started_by_cli).toBe(true);

    await Bun.sleep(1_000);

    const second = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home },
    });
    expect(second.exitCode).toBe(0);
    const secondStatus = JSON.parse(second.stdout.toString()) as { pid: number; daemon_started_by_cli: boolean };
    expect(secondStatus.pid).toBe(firstStatus.pid);
    expect(secondStatus.daemon_started_by_cli).toBe(false);
  } finally {
    if (daemonPid) await killPid(daemonPid);
  }
});

async function killPid(pid: number): Promise<void> {
  try {
    process.kill(pid);
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Bun.sleep(50);
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}
