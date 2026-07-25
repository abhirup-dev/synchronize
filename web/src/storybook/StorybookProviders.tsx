import { useMemo, type ReactNode } from "react";
import { DataSourceProvider } from "../data/context.tsx";
import { MockDataSource } from "../data/mock.ts";
import type { AgentLaunchProfile, AgentLaunchTool, LaunchToolAvailability } from "../data/types.ts";

/** Launch tooling a story wants the mock daemon to report. See parameters.launch. */
export interface MockLaunchFixture {
  tools?: Partial<Record<AgentLaunchTool, LaunchToolAvailability>>;
  profiles?: AgentLaunchProfile[];
}
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { ToastProvider } from "../components/Toast.tsx";
import { ArchiveRecoveryProvider } from "../components/ArchiveRecovery.tsx";

// The same provider stack App.tsx wraps the live tree in, backed by a FRESH
// MockDataSource per mount. MockDataSource carries mutable snapshots and
// localStorage-backed color overrides; a shared instance would leak state
// between stories, so each story gets its own.
export function StorybookProviders({ children, launch }: { children: ReactNode; launch?: MockLaunchFixture }) {
  const ds = useMemo(() => new MockDataSource(launch), [launch]);
  return (
    <DataSourceProvider value={ds}>
      <ContextMenuProvider>
        <ToastProvider>
          <ArchiveRecoveryProvider>{children}</ArchiveRecoveryProvider>
        </ToastProvider>
      </ContextMenuProvider>
    </DataSourceProvider>
  );
}
