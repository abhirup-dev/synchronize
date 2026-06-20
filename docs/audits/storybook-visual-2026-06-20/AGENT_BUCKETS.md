# Agent Bucket Map

This maps the parallel audit agents to their assigned Storybook brackets and
their output docks.

| Agent | Bucket | Scope | Output |
| --- | --- | --- | --- |
| Bohr | Activity / Chat Desktop | ActivityItem, ActivityView, BoardView, ChatView; brutal desktop only | [activity-chat-desktop.md](./agent-reports/activity-chat-desktop.md) |
| Curie | Composer + Messages Desktop | AttachmentPreview, Composer, ContextMenu, Markdown, MessageRow, PollWidget; brutal desktop only | [composer-messages-desktop.md](./agent-reports/composer-messages-desktop.md) |
| Feynman | Thread / Timeline / Toast Desktop | ThreadPane, ThreadSummaryPanel, TimelineRail, Toast; brutal desktop only | [thread-timeline-toast.md](./agent-reports/thread-timeline-toast.md) |
| Halley | Primitives / Status / Settings Desktop | Identity primitives, IconButton, ConnectionError, Placeholder; desktop settings rows deferred | [primitives-status-settings.md](./agent-reports/primitives-status-settings.md) |
| Mencius | Dialogs Desktop | ArchiveRecovery and SpawnAgentDialog; brutal desktop only | [dialogs-desktop.md](./agent-reports/dialogs-desktop.md) |
| Archimedes | Compact / Mobile | Brutal compact/mobile only, source from `feat-android-app` worktree | [compact-mobile-feat-android.md](./agent-reports/compact-mobile-feat-android.md) |
| Fermat | Flows / end-to-end demos | `flows-synchronize-ui--*`; isolated interaction-heavy desktop audit | [flows-desktop.md](./agent-reports/flows-desktop.md) |
| Kant | AgentColorPicker Desktop | `agent-states-agentcolorpicker--*`; brutal desktop only | [agent-color-picker-desktop.md](./agent-reports/agent-color-picker-desktop.md) |
| Tesla | Layouts Desktop / Tablet | desktop and tablet layout residuals; medium optional/deferred | [layouts-desktop-tablet.md](./agent-reports/layouts-desktop-tablet.md) |
| Averroes | Navigation Desktop Residual | remaining AgentRoster, RoomHeader, Sidebar desktop states; no compact/glass | [navigation-residual-desktop.md](./agent-reports/navigation-residual-desktop.md) |
| Chandrasekhar | Scroll / Resize Residual | remaining ScrollControls and ResizeHandle variants | [scroll-resize-residual-desktop.md](./agent-reports/scroll-resize-residual-desktop.md) |
| Banach | Compact / Responsive Attempt | Superseded blocked run from wrong source/runtime context | [compact-deferred.md](./agent-reports/compact-deferred.md) |

Closed/superseded workers should not be used as final evidence unless their
report explicitly states isolated capture, correct source context, and the
assigned viewport/theme scope.

## Residual Buckets Completed

These were previously unassigned and now have completed reports.

| Bucket | Story groups | Notes |
| --- | --- | --- |
| Flows / end-to-end demos | `flows-synchronize-ui--*` | Completed by Fermat. Requested ids were absent; current activity-to-thread flow equivalents failed. |
| Agent color picker | `agent-states-agentcolorpicker--*` | Completed by Kant; no confirmed failures. |
| Layouts desktop and tablet residual | `layouts-chat-surface--desktop`, `layouts-chat-surface--tablet` | Completed by Tesla; `layouts-app-shell--desktop` absent from `index.json`. |
| Navigation desktop residual | `navigation-agentroster--default`, `navigation-agentroster--all-statuses`, `navigation-roomheader--group`, `navigation-roomheader--direct-message`, `navigation-sidebar--activity-dock`, `navigation-sidebar--dm-selected`, `navigation-sidebar--typing-mode` | Completed by Averroes. |
| Scroll controls residual | `surfaces-scrollcontrols--hidden`, `surfaces-scrollcontrols--jump-to-bottom`, `surfaces-scrollcontrols--new-items-below` | Completed by Chandrasekhar; all passed. |
| ResizeHandle residual | `primitives-resizehandle--at-max-width`, `primitives-resizehandle--at-min-width`, `primitives-resizehandle--narrow-clamp` | Completed by Chandrasekhar; same known harness styling failure. |
