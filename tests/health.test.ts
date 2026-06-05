import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDaemon } from "../src/client.ts";

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
    let discovery: {
      baseUrl: string;
      provenance?: { source_root: string; entrypoint_path: string; git_sha: string | null; git_dirty: boolean | null };
    } | null = null;
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
    expect(discovery!.provenance).toMatchObject({
      source_root: process.cwd(),
      entrypoint_path: join(process.cwd(), "src", "daemon.ts"),
    });

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
      provenance: {
        source_root: process.cwd(),
        entrypoint_path: join(process.cwd(), "src", "daemon.ts"),
      },
      counts: { peers: 0, groups: 0, events: 0 },
    });
    const startupLog = await readDaemonLog(home);
    expect(startupLog).toMatchObject({
      event: "daemon_start",
      home,
      baseUrl: discovery!.baseUrl,
      provenance: {
        source_root: process.cwd(),
        entrypoint_path: join(process.cwd(), "src", "daemon.ts"),
      },
    });
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("separate runtime homes get separate daemon logs and discovery files", async () => {
  const firstHome = await mkdtemp(join(tmpdir(), "synchronize-home-a-"));
  const secondHome = await mkdtemp(join(tmpdir(), "synchronize-home-b-"));
  homes.push(firstHome, secondHome);
  const first = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: firstHome, SYNCHRONIZE_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const second = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: secondHome, SYNCHRONIZE_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const firstDiscovery = await waitForDiscovery(firstHome);
    const secondDiscovery = await waitForDiscovery(secondHome);
    expect(firstDiscovery.pid).not.toBe(secondDiscovery.pid);
    expect(firstDiscovery.port).not.toBe(secondDiscovery.port);
    expect(firstDiscovery.dbPath).toBe(join(firstHome, "synchronize.db"));
    expect(secondDiscovery.dbPath).toBe(join(secondHome, "synchronize.db"));

    const firstLog = await readDaemonLog(firstHome);
    const secondLog = await readDaemonLog(secondHome);
    expect(firstLog).toMatchObject({ event: "daemon_start", home: firstHome, pid: firstDiscovery.pid });
    expect(secondLog).toMatchObject({ event: "daemon_start", home: secondHome, pid: secondDiscovery.pid });
  } finally {
    first.kill();
    second.kill();
    await Promise.all([first.exited, second.exited]);
  }
});

test("concurrent CLI startup for one runtime home is serialized by the lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-lock-"));
  homes.push(home);
  let daemonPid: number | null = null;

  try {
    const first = Bun.spawn({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const second = Bun.spawn({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [firstOutput, secondOutput, firstCode, secondCode] = await Promise.all([
      new Response(first.stdout).text(),
      new Response(second.stdout).text(),
      first.exited,
      second.exited,
    ]);
    expect(firstCode).toBe(0);
    expect(secondCode).toBe(0);
    const firstStatus = JSON.parse(firstOutput) as { pid: number; daemon_started_by_cli: boolean };
    const secondStatus = JSON.parse(secondOutput) as { pid: number; daemon_started_by_cli: boolean };
    daemonPid = firstStatus.pid;
    expect(secondStatus.pid).toBe(firstStatus.pid);
    expect([firstStatus.daemon_started_by_cli, secondStatus.daemon_started_by_cli].filter(Boolean)).toHaveLength(1);
  } finally {
    if (daemonPid) await killPid(daemonPid);
  }
  // Per-test deadline must exceed STARTUP_TIMEOUT_MS (5s) so a slow-but-healthy
  // CLI auto-start is observed, not clipped by the test's own clock.
}, 15_000);

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

test("CLI uses SYNCHRONIZE_REMOTE_URL without creating local discovery", async () => {
  const daemonHome = await mkdtemp(join(tmpdir(), "synchronize-remote-daemon-"));
  const clientHome = await mkdtemp(join(tmpdir(), "synchronize-remote-client-"));
  homes.push(daemonHome, clientHome);
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: daemonHome,
      SYNCHRONIZE_PORT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const discovery = await waitForDiscovery(daemonHome);
    const status = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: {
        ...process.env,
        SYNCHRONIZE_HOME: clientHome,
        SYNCHRONIZE_REMOTE_URL: `${discovery.baseUrl}/`,
      },
    });

    expect(status.exitCode).toBe(0);
    const body = JSON.parse(status.stdout.toString()) as { home: string; daemon_started_by_cli: boolean };
    expect(body.home).toBe(daemonHome);
    expect(body.daemon_started_by_cli).toBe(false);
    expect(await Bun.file(join(clientHome, "daemon.json")).exists()).toBe(false);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("unreachable SYNCHRONIZE_REMOTE_URL fails without local daemon autostart", async () => {
  const clientHome = await mkdtemp(join(tmpdir(), "synchronize-remote-unreachable-"));
  homes.push(clientHome);

  const status = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", "status"],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: clientHome,
      SYNCHRONIZE_REMOTE_URL: "http://127.0.0.1:9",
    },
  });

  expect(status.exitCode).not.toBe(0);
  expect(status.stderr.toString()).toContain("SYNCHRONIZE_REMOTE_URL");
  expect(await Bun.file(join(clientHome, "daemon.json")).exists()).toBe(false);
});

test("SYNCHRONIZE_HEALTH_TIMEOUT_MS controls remote daemon health validation", async () => {
  const clientHome = await mkdtemp(join(tmpdir(), "synchronize-remote-timeout-"));
  homes.push(clientHome);
  const originalHome = process.env.SYNCHRONIZE_HOME;
  const originalRemoteUrl = process.env.SYNCHRONIZE_REMOTE_URL;
  const originalHealthTimeout = process.env.SYNCHRONIZE_HEALTH_TIMEOUT_MS;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        await Bun.sleep(200);
        return Response.json({ ok: true, service: "synchronize", api_version: 1 });
      }
      if (url.pathname === "/status") {
        return Response.json({ ok: true, home: "remote-home" });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    process.env.SYNCHRONIZE_HOME = clientHome;
    process.env.SYNCHRONIZE_REMOTE_URL = server.url.toString();
    process.env.SYNCHRONIZE_HEALTH_TIMEOUT_MS = "50";
    await expect(ensureDaemon()).rejects.toThrow("SYNCHRONIZE_REMOTE_URL");

    process.env.SYNCHRONIZE_HEALTH_TIMEOUT_MS = "1000";
    const client = await ensureDaemon();
    expect(client.baseUrl).toBe(server.url.toString().replace(/\/$/, ""));
    expect(client.started).toBe(false);
    expect(await Bun.file(join(clientHome, "daemon.json")).exists()).toBe(false);
  } finally {
    restoreEnv("SYNCHRONIZE_HOME", originalHome);
    restoreEnv("SYNCHRONIZE_REMOTE_URL", originalRemoteUrl);
    restoreEnv("SYNCHRONIZE_HEALTH_TIMEOUT_MS", originalHealthTimeout);
    server.stop(true);
  }
});

test("CLI-launched daemon stays alive across separate CLI processes", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-cli-daemon-"));
  homes.push(home);
  let daemonPid: number | null = null;

  try {
    const first = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    });
    expect(first.exitCode).toBe(0);
    const firstStatus = JSON.parse(first.stdout.toString()) as { pid: number; daemon_started_by_cli: boolean };
    daemonPid = firstStatus.pid;
    expect(firstStatus.daemon_started_by_cli).toBe(true);

    await Bun.sleep(1_000);

    const second = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "status"],
      env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    });
    expect(second.exitCode).toBe(0);
    const secondStatus = JSON.parse(second.stdout.toString()) as { pid: number; daemon_started_by_cli: boolean };
    expect(secondStatus.pid).toBe(firstStatus.pid);
    expect(secondStatus.daemon_started_by_cli).toBe(false);
  } finally {
    if (daemonPid) await killPid(daemonPid);
  }
  // Per-test deadline must exceed STARTUP_TIMEOUT_MS (5s) so a slow-but-healthy
  // CLI auto-start is observed, not clipped by the test's own clock.
}, 15_000);

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

async function waitForDiscovery(home: string): Promise<{
  pid: number;
  port: number;
  baseUrl: string;
  dbPath: string;
  provenance: { source_root: string; entrypoint_path: string; git_sha: string | null; git_dirty: boolean | null };
}> {
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = await Bun.file(discoveryPath).json();
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) return discovery;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error(`daemon did not write healthy discovery file for ${home}`);
}

async function readDaemonLog(home: string): Promise<Record<string, unknown>> {
  const logPath = join(home, "daemon.log");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(logPath, "utf8");
      const line = raw.trim().split("\n").filter(Boolean).at(-1);
      if (line) return JSON.parse(line) as Record<string, unknown>;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error(`daemon did not append startup log for ${home}`);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
