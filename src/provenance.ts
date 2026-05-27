import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { API_VERSION } from "./constants.ts";

export interface DaemonProvenance {
  api_version: number;
  entrypoint_path: string;
  source_root: string;
  git_sha: string | null;
  git_dirty: boolean | null;
}

export function collectDaemonProvenance(): DaemonProvenance {
  const entrypointPath = fileURLToPath(new URL("./daemon.ts", import.meta.url));
  const sourceRoot = dirname(dirname(entrypointPath));
  return {
    api_version: API_VERSION,
    entrypoint_path: entrypointPath,
    source_root: sourceRoot,
    git_sha: resolveGitSha(sourceRoot),
    git_dirty: resolveGitDirty(sourceRoot),
  };
}

function resolveGitSha(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return sha === "" ? null : sha;
}

function resolveGitDirty(cwd: string): boolean | null {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() !== "";
}
