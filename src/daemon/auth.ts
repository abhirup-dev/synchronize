import {
  DEFAULT_PORT,
  ENV_BIND,
  ENV_PORT,
  ENV_TOKEN,
} from "../constants.ts";
import type { DaemonConfig } from "../config.ts";
import { HttpError } from "../http.ts";

interface AuthContext {
  token: string | null;
}

// Bind host/port come from the resolved daemon config (env > config.toml >
// default), but the strict SYNCHRONIZE_PORT parse is preserved here: a malformed
// env port must still throw rather than silently fall back. `daemon.bind`/
// `daemon.port` already fold in env+toml; the explicit env[ENV_PORT] check only
// exists to keep that hard validation error.
export function resolveBind(env: NodeJS.ProcessEnv, daemon: DaemonConfig): { host: string; port: number } {
  const host = daemon.bind;
  const rawPort = env[ENV_PORT];
  const port = rawPort ? Number.parseInt(rawPort, 10) : daemon.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${ENV_PORT} must be an integer from 0 to 65535`);
  }
  return { host, port };
}

export function assertLanModeIsProtected(host: string, token: string | null): void {
  const localhost = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!localhost && !token) {
    throw new Error(`${ENV_TOKEN} is required when ${ENV_BIND} is not localhost`);
  }
}

export function requireAuth(request: Request, ctx: AuthContext): void {
  if (!ctx.token) return;
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${ctx.token}`) {
    throw new HttpError(401, "unauthorized", "A valid bearer token is required");
  }
}
