// Worktree UI dev server. Invoked as `vite --config vite.dev.config.ts`.
//
// The filename matters: @storybook/react-vite auto-merges a root vite.config.ts
// if one exists, which would apply `base` to Storybook and register Tailwind
// twice. Storybook builds its own config in .storybook/main.ts and must keep
// doing so, so this config stays off the default name.
//
// This server owns source, HMR, and request routing. It owns no daemon — it
// neither starts, stops, nor selects one; the launcher resolves the runtime and
// passes it in.
import { defineConfig, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BASE, CLIENT_ROUTE_PREFIXES } from "./src/routing/address.ts";

const DAEMON_URL = (process.env["SYNCHRONIZE_DAEMON_URL"] ?? "http://127.0.0.1:58405").replace(/\/$/, "");
const PORT = Number(process.env["PORT"] ?? 5173);

export default defineConfig({
  root: __dirname,
  // Must match production. Client routes live under /web/, so Vite's
  // htmlFallback has to own that namespace: serving the document at "/" instead
  // lets a refresh of /web/e/abc escape Vite, reach the daemon, and come back as
  // the production bundle at HTTP 200 with dead HMR.
  base: BASE,
  plugins: [react(), tailwindcss(), forwardToDaemon(DAEMON_URL)],
  server: {
    // Vite ignores PORT natively. Portless does inject --port/--host, but only
    // when it recognises the child binary as Vite — and `bun run <script>` is not
    // one of the package runners it unwraps, so under this repo's launcher the
    // flags never arrive. Reading the env is what actually makes the assigned
    // port take effect; it is also harmless when the flags are injected, since
    // Portless skips injection if --port is already present.
    port: PORT,
    strictPort: true,
    host: process.env["HOST"] ?? "127.0.0.1",
    // allowedHosts is deliberately NOT widened here: Portless injects
    // __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, which Vite reads itself, so its
    // hostname is permitted without disabling the Host check for everyone else.
  },
});

// Prefixes Vite itself owns beneath the base: its client runtime, module and
// filesystem resolvers, and pre-bundled dependencies. Vite defines these, so the
// list is stable and does not grow with our features.
const VITE_INTERNAL_PREFIXES = ["@vite/", "@id/", "@fs/", "@react-refresh", "src/", "node_modules/", ".vite/"];

/**
 * Routes each request to Vite or to the daemon.
 *
 * The lists maintained by hand are the CLIENT routes and Vite's own internals —
 * never the API routes. The app calls fourteen daemon route families and gains
 * more with every backend feature; a missing API entry would fail only in dev and
 * only silently, because Vite answers `200 text/html` and `res.json()` then
 * throws "Unexpected token '<'", which reads like a frontend bug. Client routes
 * are few, stable, and fail loudly, so anything unrecognised goes to the daemon
 * and a new backend route needs no change here.
 *
 * Registered as a PRE middleware, before Vite's own. Two reasons, both learned
 * the hard way: Vite rewrites `req.url` to strip the base, so matching has to
 * read `originalUrl`; and Vite's base middleware answers 404 for anything outside
 * the base, which would swallow every root-level daemon route before a
 * post-middleware ever saw it.
 */
function forwardToDaemon(daemonUrl: string): PluginOption {
  // The mount point matches EXACTLY. Treating it as a prefix would hand Vite
  // every daemon endpoint under /web/ too (/web/state, /web/events, …).
  const exact = [BASE, BASE.replace(/\/$/, ""), `${BASE}index.html`];
  return {
    name: "synchronize:forward-to-daemon",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "/";
        const path = url.split("?")[0] ?? "/";
        if (viteOwns(path)) return next();
        void pipeToDaemon(daemonUrl, req, res).catch((error: unknown) => {
          // A dead daemon must not be mistaken for a 404 from the app.
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
          }
          res.end(JSON.stringify({ error: { code: "daemon_unreachable", message: String(error), daemon: daemonUrl } }));
        });
      });
    },
  };

  function viteOwns(path: string): boolean {
    if (exact.includes(path)) return true;
    if (CLIENT_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
    if (!path.startsWith(BASE)) return false;
    const rest = path.slice(BASE.length);
    return VITE_INTERNAL_PREFIXES.some((prefix) => rest.startsWith(prefix));
  }
}

async function pipeToDaemon(
  daemonUrl: string,
  req: { url?: string; method?: string; headers: Record<string, string | string[] | undefined> },
  res: {
    statusCode: number;
    headersSent: boolean;
    setHeader(name: string, value: string): void;
    write(chunk: Uint8Array): boolean;
    end(chunk?: string): void;
  },
): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    // `host` must be the daemon's, and hop-by-hop headers must not be relayed.
    if (value === undefined || key === "host" || key === "connection") continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const method = req.method ?? "GET";
  const upstream = await fetch(`${daemonUrl}${req.url ?? "/"}`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: req as unknown as ReadableStream, duplex: "half" as const }),
  });

  res.statusCode = upstream.status;
  for (const [key, value] of upstream.headers) {
    // Length and encoding describe the upstream framing, not ours.
    if (key === "content-length" || key === "content-encoding") continue;
    res.setHeader(key, value);
  }

  // Streamed through unbuffered and uncompressed, which is what keeps the SSE
  // stream at /web/events live rather than accumulating until the request ends.
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(value);
  }
  res.end();
}
