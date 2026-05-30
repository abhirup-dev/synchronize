# Web / Frontend Series

This is a routing memory for agents filtering by `web`, `frontend`, or `UI`. The detailed memory is `web_ui_overview`, refreshed on 2026-05-23.

## Current state

The web app under `web/` is a React 19 + TypeScript single-page operator surface served by the daemon at `/web` and `/web/*`.

The current UI includes:

- neo-brutalist chat shell.
- Sidebar with groups/DMs.
- RoomHeader with description/topic surface.
- ChatView and MessageRow with sanitized markdown.
- Composer with `@mention` autocomplete.
- AgentRoster.
- TimelineRail.
- ThreadPane with draggable ResizeHandle.
- ContextMenu.
- Toast.
- AgentColorPicker.
- Vim navigation via `useVimNav`.

## Data model

Components use hooks from `web/src/data/context.tsx` and do not fetch directly. `DataSource` is defined in `web/src/data/types.ts`.

Current adapters:

- `MockDataSource` is the working adapter.
- `DaemonDataSource` is still a stub/placeholder for real daemon-backed data.

## Important conventions

Read `web_ui_overview` and `web/DESIGN.md` before frontend edits. Key constraints include no component-level fetches, no arbitrary border radii, no gradients/blur/soft shadows, sanitized markdown, and preserving intentional grouped-message spacing.

## Backend connection points

The daemon serves static assets via `serveWebAsset` using `SYNCHRONIZE_WEB_DIST` or `../web/dist`. That does not mean the web UI is live-daemon-backed yet; the DataSource layer still controls runtime data.
