import { useMemo, type ReactNode } from "react";
import { DataSourceProvider } from "../data/context.tsx";
import { MockDataSource } from "../data/mock.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { ToastProvider } from "../components/Toast.tsx";
import { ArchiveRecoveryProvider } from "../components/ArchiveRecovery.tsx";

// The same provider stack App.tsx wraps the live tree in, backed by a FRESH
// MockDataSource per mount. MockDataSource carries mutable snapshots and
// localStorage-backed color overrides; a shared instance would leak state
// between stories, so each story gets its own.
export function StorybookProviders({ children }: { children: ReactNode }) {
  const ds = useMemo(() => new MockDataSource(), []);
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
