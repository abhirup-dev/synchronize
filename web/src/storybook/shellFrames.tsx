// Story mount frames — the Storybook half of the shared shell vocabulary.
//
// Each frame composes the SAME structural cells the app composes (shell-layout.tsx),
// so a story mounts a component exactly where the app mounts it. This is what makes
// "passes in Storybook" mean "works in the app": there is no parallel reconstruction
// of the layout and no mode if-else — the cells are shared, and mode-dependent
// behaviour stays in the `shellLayout(mode)` capability contract that components read.
//
// Compose by CHOOSING a decorator (inChatSurface / inSidebarColumn / …); never add
// a slot enum + switch here. Shell mode is derived from the live preview viewport
// width via the single-source `shellModeForWidth`, so sweeping the toolbar viewport
// (compact/tablet/desktop) moves a story through the real breakpoints automatically.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { shellModeForWidth, type ShellMode } from "../shell-mode.tsx";
import { AppShellGrid, ShellMainColumn, ShellMainBody, ShellChatColumn } from "../shell-layout.tsx";

function useViewportShellMode(): ShellMode {
  const [mode, setMode] = useState<ShellMode>(() => shellModeForWidth(window.innerWidth));
  useEffect(() => {
    const onResize = () => setMode(shellModeForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mode;
}

// RoomHeader and other direct children of the chat region's main column.
function MainColumnFrame({ children }: { children: ReactNode }) {
  const mode = useViewportShellMode();
  return (
    <AppShellGrid mode={mode} style={{ gridTemplateColumns: "1fr" }}>
      <ShellMainColumn>{children}</ShellMainColumn>
    </AppShellGrid>
  );
}

// ChatView / BoardView / Placeholder — the full chat surface, nested exactly as
// the app nests it (main column › main-body › chat column). The timeline rail,
// composer pinning and compact behaviour then follow the real capability rules.
function ChatSurfaceFrame({ children }: { children: ReactNode }) {
  const mode = useViewportShellMode();
  return (
    <AppShellGrid mode={mode} style={{ gridTemplateColumns: "1fr" }}>
      <ShellMainColumn>
        <ShellMainBody>
          <ShellChatColumn>{children}</ShellChatColumn>
        </ShellMainBody>
      </ShellMainColumn>
    </AppShellGrid>
  );
}

// Chat surface plus app-level right pane (ThreadPane today). This mirrors the
// App.tsx composition where ChatView and ThreadPane are siblings inside
// ShellMainBody, so flow stories can show the complete split UI without
// rebuilding shell geometry locally.
export function ChatSplitSurfaceFrame({
  children,
  pane,
  paneWidth = 420,
}: {
  children: ReactNode;
  pane?: ReactNode;
  paneWidth?: number;
}) {
  const mode = useViewportShellMode();
  const split = Boolean(pane) && mode === "desktop";
  return (
    <AppShellGrid mode={mode} threadOpen={split} style={{ gridTemplateColumns: "1fr" }}>
      <ShellMainColumn
        style={split ? ({
          "--thread-pane-width": `${paneWidth}px`,
        } as CSSProperties) : undefined}
      >
        <ShellMainBody
          threadOpen={split}
          style={split ? ({
            gridTemplateColumns: `minmax(0, 1fr) ${paneWidth}px`,
            "--thread-pane-width": `${paneWidth}px`,
          } as CSSProperties) : undefined}
        >
          <ShellChatColumn>{children}</ShellChatColumn>
          {split ? pane : null}
        </ShellMainBody>
      </ShellMainColumn>
    </AppShellGrid>
  );
}

// Sidebar — grid child 1 of the shell, so it renders at its real column width
// instead of stretching full-bleed (the cause of the collapsed-strip stories).
function SidebarColumnFrame({ children }: { children: ReactNode }) {
  const mode = useViewportShellMode();
  return (
    <AppShellGrid mode={mode}>
      {children}
      <div />
    </AppShellGrid>
  );
}

// AgentRoster — the right-edge agents overlay, mirroring App.tsx's
// `shell-overlay-agents` wrapper (fixed panel over an empty shell). In the
// app a CompactAppBar sits above the roster only in compact mode; the panel
// head is the roster's own (onClose prop) elsewhere.
function RosterPanelFrame({ children }: { children: ReactNode }) {
  const mode = useViewportShellMode();
  return (
    <AppShellGrid mode={mode} style={{ gridTemplateColumns: "1fr" }}>
      <ShellMainColumn>
        <ShellMainBody>
          <div />
        </ShellMainBody>
      </ShellMainColumn>
      <div
        className={`shell-overlay shell-overlay-agents shell-overlay-${mode} fixed z-[var(--z-modal)] bg-paper text-ink [border:var(--line)] shadow-lg flex flex-col overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-label="agents"
      >
        {children}
      </div>
    </AppShellGrid>
  );
}

// BottomNav lives only in the compact shell, where it is grid row 2 (rows are
// `1fr auto`) — anchoring it to the bottom instead of floating at the top. Pinning
// compact here declares the story's shell (the surface is compact-only), it does
// not branch component logic.
function BottomNavRowFrame({ children }: { children: ReactNode }) {
  return (
    <AppShellGrid mode="compact">
      <div />
      {children}
    </AppShellGrid>
  );
}

export const inMainColumn: Decorator = (Story) => <MainColumnFrame><Story /></MainColumnFrame>;
export const inChatSurface: Decorator = (Story) => <ChatSurfaceFrame><Story /></ChatSurfaceFrame>;
export const inSidebarColumn: Decorator = (Story) => <SidebarColumnFrame><Story /></SidebarColumnFrame>;
export const inRosterPanel: Decorator = (Story) => <RosterPanelFrame><Story /></RosterPanelFrame>;
export const inBottomNavRow: Decorator = (Story) => <BottomNavRowFrame><Story /></BottomNavRowFrame>;
