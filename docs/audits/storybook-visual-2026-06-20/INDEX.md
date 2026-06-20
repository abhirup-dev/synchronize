# Storybook Visual Audit - 2026-06-20

This folder is the fix packet for the Storybook visual audit. It is meant to be
safe to hand to another agent: start here, then use the referenced report and
screenshot for each issue.

## Scope

- Current confirmed pass: brutal theme, desktop viewport.
- Completed compact/mobile pass: brutal theme, compact/mobile viewport, using
  the `feat-android-app` worktree for source inspection.
- Out of scope for the current confirmed desktop list: glass theme, medium mode,
  compact/mobile-only stories, and screenshot edge/vertical clipping artifacts.

## Primary Documents

- [NOTES.md](./NOTES.md) - unified confirmed findings and deferred scopes.
- [AGENT_BUCKETS.md](./AGENT_BUCKETS.md) - subagent-to-bracket map and output docks.
- [storybook-visual-audit protocol](../../../.claude/skills/synchronize-debugging/storybook-visual-audit.md) - repeatable audit method for future agents.

## Bucket Reports

- [activity-chat-desktop.md](./agent-reports/activity-chat-desktop.md) - ActivityItem, ActivityView, BoardView, ChatView.
- [composer-messages-desktop.md](./agent-reports/composer-messages-desktop.md) - Composer, AttachmentPreview, ContextMenu, Markdown, MessageRow, PollWidget.
- [dialogs-desktop.md](./agent-reports/dialogs-desktop.md) - ArchiveRecovery and SpawnAgentDialog; no confirmed failures.
- [primitives-status-settings.md](./agent-reports/primitives-status-settings.md) - primitives, status, settings rows.
- [thread-timeline-toast.md](./agent-reports/thread-timeline-toast.md) - ThreadPane, ThreadSummaryPanel, TimelineRail, Toast.
- [compact-mobile-feat-android.md](./agent-reports/compact-mobile-feat-android.md) - compact/mobile brutal-theme stories from the `feat-android-app` worktree.
- [agent-color-picker-desktop.md](./agent-reports/agent-color-picker-desktop.md) - AgentColorPicker states; no confirmed failures.
- [flows-desktop.md](./agent-reports/flows-desktop.md) - flow/demo stories and activity-to-thread equivalents.
- [layouts-desktop-tablet.md](./agent-reports/layouts-desktop-tablet.md) - desktop/tablet chat-surface layout references.
- [navigation-residual-desktop.md](./agent-reports/navigation-residual-desktop.md) - remaining desktop navigation states.
- [scroll-resize-residual-desktop.md](./agent-reports/scroll-resize-residual-desktop.md) - remaining ScrollControls and ResizeHandle variants.
- [compact-deferred.md](./agent-reports/compact-deferred.md) - superseded blocked report from the wrong source context; do not use as final compact/mobile evidence.

## Screenshot Policy

The `screenshots/` directory should contain only confirmed failure references or
explicitly deferred references. Pass screenshots should stay temporary and should
not be committed into this folder.

## Compact/Mobile Output

The compact/mobile brutal-theme pass wrote:

- `agent-reports/compact-mobile-feat-android.md`
- `screenshots/compact-mobile-feat-android--*.png`

It used `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-android-app`
for source/story inspection, a private Storybook server on port `6008`, and an
isolated headless browser. The server was stopped after the audit.
