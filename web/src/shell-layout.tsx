// Shared structural shell cells — the SINGLE composition vocabulary for the app
// shell. App.tsx composes these, and Storybook mounts stories through the very
// same components (see src/storybook/shellFrames.tsx). Because both sides build
// from one set of cells, a story can't drift from how the app actually mounts a
// component — the recurring source of false-positive audit findings.
//
// These are pure presentational wrappers: they carry NO mode if-else and NO
// business logic. Mode-dependent behaviour stays in the `shellLayout(mode)`
// capability contract (shell-mode.tsx); these cells only reproduce the DOM/CSS
// structure (the `.app-shell` / `.main-body` grid the styles.css responsive rules
// bind to). Pass the resolved `mode` in; never branch on it here.

import type { CSSProperties, ReactNode } from "react";
import { cn } from "./lib/cn.ts";
import { ShellModeProvider, type ShellMode } from "./shell-mode.tsx";

// The outer `.app-shell shell-{mode}` grid + the ShellModeProvider that backs
// `useShellMode()`/`useShellLayout()`. Extra props (e.g. App's data-vim-mode)
// pass through so app-only concerns don't have to live in this shared cell.
export function AppShellGrid({
  mode,
  threadOpen = false,
  children,
  ...rest
}: {
  mode: ShellMode;
  threadOpen?: boolean;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <ShellModeProvider value={mode}>
      <div
        className={`app-shell shell-${mode}${threadOpen ? " thread-open" : ""}`}
        data-shell-mode={mode}
        {...rest}
      >
        {children}
      </div>
    </ShellModeProvider>
  );
}

// The chat region's main column (sits in the grid's 1fr cell, right of the
// persistent sidebar). Anchors the absolutely-positioned toast stack.
export function ShellMainColumn({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties | undefined;
}) {
  return (
    <main className={cn("flex flex-col min-w-0 [border-left:var(--line)] bg-paper relative", className)} style={style}>
      {children}
    </main>
  );
}

// The chat + roster grid inside the main column (`.main-body`: 1fr chat / 260px
// roster on desktop, single column in medium/compact — owned by styles.css).
export function ShellMainBody({
  threadOpen = false,
  children,
  style,
}: {
  threadOpen?: boolean;
  children: ReactNode;
  style?: CSSProperties | undefined;
}) {
  return (
    <div className={cn("main-body", threadOpen && "thread-open")} style={style}>
      {children}
    </div>
  );
}

// The chat column wrapper that hosts ChatView/BoardView/Placeholder — bounded so
// the list scrolls internally and the composer stays pinned at the bottom.
export function ShellChatColumn({ children }: { children: ReactNode }) {
  return <div className="min-w-0 min-h-0 flex flex-col overflow-hidden">{children}</div>;
}
