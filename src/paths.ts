import { homedir } from "node:os";
import { join } from "node:path";
import {
  CLI_IDENTITY_FILE,
  DB_FILE,
  DISCOVERY_FILE,
  ENV_HOME,
  LOCK_DIR,
  LOG_FILE,
  MEDIA_DIR,
} from "./constants.ts";

export interface RuntimePaths {
  home: string;
  dbPath: string;
  mediaPath: string;
  discoveryPath: string;
  lockPath: string;
  logPath: string;
  cliIdentityPath: string;
}

export function getRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const home = env[ENV_HOME] ?? join(homedir(), ".synchronize");
  return {
    home,
    dbPath: join(home, DB_FILE),
    mediaPath: join(home, MEDIA_DIR),
    discoveryPath: join(home, DISCOVERY_FILE),
    lockPath: join(home, LOCK_DIR),
    logPath: join(home, LOG_FILE),
    cliIdentityPath: join(home, CLI_IDENTITY_FILE),
  };
}
