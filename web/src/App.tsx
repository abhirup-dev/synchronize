import { RouterProvider } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { DataSource } from "./data/types.ts";
import { DataSourceProvider, useDataSource } from "./data/context.tsx";
import { BASE, isAppPath } from "./routing/address.ts";
import { createAppRouter, createMemoryRouter } from "./routing/router.tsx";
import { MockDataSource } from "./data/mock.ts";
import { DaemonDataSource } from "./data/daemon.ts";
import { ContextMenuProvider } from "./components/ContextMenu.tsx";
import { ArchiveRecoveryProvider } from "./components/ArchiveRecovery.tsx";
import { ToastProvider } from "./components/Toast.tsx";
// Dev-only live token editor — EXCLUDED from production builds. web/build.ts
// replaces process.env.NODE_ENV at build time ("production" unless --watch), so in
// a prod build this ternary folds to null and the dynamic import() is dead-code
// eliminated — the editor never ships, rather than being merely hidden behind a flag.
const ThemeTokenEditor =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./theme/ThemeTokenEditor.tsx").then((m) => ({ default: m.ThemeTokenEditor })))
    : null;

function pickDataSource(): DataSource {
  if (localStorage.getItem("SYNCHRONIZE_DATA_SOURCE") === "mock") {
    return new MockDataSource();
  }
  const token =
    sessionStorage.getItem("SYNCHRONIZE_TOKEN") ??
    localStorage.getItem("SYNCHRONIZE_TOKEN") ??
    undefined;
  if (localStorage.getItem("SYNCHRONIZE_DATA_SOURCE") === "live" || isAppPath(window.location.pathname)) {
    return new DaemonDataSource({ baseUrl: runtimeBaseUrl(), ...(token ? { token } : {}) });
  }
  return new MockDataSource();
}

// The one place RUNTIME (which daemon holds the data) is resolved. No component
// may read it or window.location.origin for data access — every read goes through
// useDataSource(), which keeps a future SharedWorker or desktop-IPC DataSource a
// change at this call site alone.
//
// A worktree UI points at a different daemon without a cross-origin URL: its dev
// server forwards unclaimed requests, so the browser stays same-origin and SSE
// and auth headers need no CORS.
function runtimeBaseUrl(): string {
  return window.location.origin.replace(/\/$/, "");
}

export function App() {
  const ds = useMemo(pickDataSource, []);
  const [connectError, setConnectError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ds.connect().then(
      () => !cancelled && setConnectError(null),
      (error) => !cancelled && setConnectError(error instanceof Error ? error.message : String(error)),
    );
    return () => ds.disconnect();
  }, [ds]);
  if (connectError) {
    return <ConnectionError message={connectError} />;
  }
  return (
    <DataSourceProvider value={ds}>
      <ContextMenuProvider>
        <ToastProvider>
          <ArchiveRecoveryProvider>
            <Shell />
            {ThemeTokenEditor && (
              <Suspense fallback={null}>
                <ThemeTokenEditor />
              </Suspense>
            )}
          </ArchiveRecoveryProvider>
        </ToastProvider>
      </ContextMenuProvider>
    </DataSourceProvider>
  );
}

/**
 * The routed application. One router instance per DataSource, so a Storybook
 * story that remounts gets a fresh history rather than inheriting the previous
 * story's route.
 *
 * Exported because it is the mount point for composed-flow stories, which drive
 * it through the real History API exactly as a browser does.
 */
export function Shell() {
  const ds = useDataSource();
  const router = useMemo(
    // A Storybook iframe is served from /iframe.html, which is outside BASE and so
    // matches no route; those mounts get an in-memory history rooted at BASE.
    () => (isAppPath(window.location.pathname) ? createAppRouter(ds) : createMemoryRouter(ds, BASE)),
    [ds],
  );
  return <RouterProvider router={router} />;
}

// Exported for Storybook (Surfaces/ConnectionError). App() is the runtime caller.
export function ConnectionError({ message }: { message: string }) {
  const authHint = message.toLowerCase().includes("unauthorized") || message.includes("401");
  return (
    <div className="connection-error">
      <div className="connection-error-box">
        <div className="brand-mark">S</div>
        <h1>Daemon connection failed</h1>
        <p>{message}</p>
        {authHint && (
          <p>
            Protected daemon mode needs `SYNCHRONIZE_TOKEN` in sessionStorage or localStorage before loading `/web`.
          </p>
        )}
      </div>
    </div>
  );
}
