import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATUS_TIMEOUT_MS = 5_000;

export async function ensureSynchronizeCliReady(): Promise<string> {
  const candidates = await resolveCliCandidates();
  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    const status = spawnSync(candidate, ["status"], {
      env: process.env,
      stdio: "ignore",
      timeout: STATUS_TIMEOUT_MS,
    });
    if (status.status === 0) return candidate;
  }
  throw new Error("no working synchronize CLI found; checked SYNCHRONIZE_CLI, configured repo binary, and PATH");
}

async function resolveCliCandidates(): Promise<string[]> {
  return uniqueNonEmpty([
    process.env.SYNCHRONIZE_CLI,
    process.env.SYNCHRONIZE_CONFIGURED_CLI ?? configuredCliPath(),
    await findOnPath("synchronize"),
  ]);
}

function configuredCliPath(): string {
  const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  return join(repoRoot, "bin", "synchronize");
}

async function findOnPath(command: string): Promise<string | undefined> {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
