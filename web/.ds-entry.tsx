// Generated for /design-sync (storybook shape) — re-exports the component
// modules onto a single entry so esbuild assigns them to window.SynchronizeWeb.
// Story imports of these components are redirected to that global by the
// converter. Excludes main.tsx / App.tsx (self-mounting) and *.stories.tsx.
export * from "./src/components/primitives.tsx";
export * from "./src/components/ActivityItem.tsx";
export * from "./src/components/ActivityView.tsx";
export * from "./src/components/AgentColorPicker.tsx";
export * from "./src/components/AgentPreview.tsx";
export * from "./src/components/AgentRoster.tsx";
export * from "./src/components/ArchiveRecovery.tsx";
export * from "./src/components/AttachmentPreview.tsx";
export * from "./src/components/BoardView.tsx";
export * from "./src/components/BottomNav.tsx";
export * from "./src/components/ChatView.tsx";
export * from "./src/components/Composer.tsx";
export * from "./src/components/ContextMenu.tsx";
export * from "./src/components/IconButton.tsx";
export * from "./src/components/Markdown.tsx";
export * from "./src/components/MessageRow.tsx";
export * from "./src/components/PollWidget.tsx";
export * from "./src/components/ResizeHandle.tsx";
export * from "./src/components/RoomHeader.tsx";
export * from "./src/components/ScrollControls.tsx";
export * from "./src/components/Sidebar.tsx";
export * from "./src/components/SpawnAgentDialog.tsx";
export * from "./src/components/ThreadPane.tsx";
export * from "./src/components/ThreadSummaryPanel.tsx";
export * from "./src/components/TimelineRail.tsx";
export * from "./src/components/Toast.tsx";
export * from "./src/ui/Sheet.tsx";
export * from "./src/shell-mode.tsx";

// Compact/mobile chrome + fallback surfaces live in App.tsx (App/Shell are the
// self-mounting roots, excluded; these are standalone exported components with
// their own stories). Named re-export so they reach window.SynchronizeWeb without
// pulling App/Shell onto the global as cards.
export {
  CompactAppBar,
  CompactSettingsSheet,
  SettingsRow,
  Placeholder,
  ConnectionError,
} from "./src/App.tsx";

// Dark-theme reference siblings — aliases of the same components so the
// *Dark.stories.tsx titles resolve to distinct design-system cards. Same
// component, themed dark (see the *Dark stories + conventions.md).
export { ChatView as ChatViewDark } from "./src/components/ChatView.tsx";
export { Sidebar as SidebarDark } from "./src/components/Sidebar.tsx";
export { ActivityView as ActivityViewDark } from "./src/components/ActivityView.tsx";
export { BoardView as BoardViewDark } from "./src/components/BoardView.tsx";

// Glass-skin reference siblings — aliases of the same components so the
// *Glass.stories.tsx titles resolve to distinct design-system cards. Same
// component, rendered with data-skin="glass" (see the *Glass stories +
// conventions.md). Skin is an orthogonal axis: compose with any theme.
export { ChatView as ChatViewGlass } from "./src/components/ChatView.tsx";
export { BoardView as BoardViewGlass } from "./src/components/BoardView.tsx";
export { ThreadPane as ThreadPaneGlass } from "./src/components/ThreadPane.tsx";
export { ThreadSummaryPanel as ThreadSummaryPanelGlass } from "./src/components/ThreadSummaryPanel.tsx";
export { TimelineRail as TimelineRailGlass } from "./src/components/TimelineRail.tsx";
export { Composer as ComposerGlass } from "./src/components/Composer.tsx";
export { Sidebar as SidebarGlass } from "./src/components/Sidebar.tsx";
export { AgentRoster as AgentRosterGlass } from "./src/components/AgentRoster.tsx";
export { RoomHeader as RoomHeaderGlass } from "./src/components/RoomHeader.tsx";
export { CompactAppBar as CompactAppBarGlass } from "./src/App.tsx";
export { ContextMenuProvider as ContextMenuGlass } from "./src/components/ContextMenu.tsx";
