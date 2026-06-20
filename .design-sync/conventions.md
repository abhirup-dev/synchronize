## Building with the Synchronize Web UI

A neo-brutalist agent-ops chat UI: heavy ink rules, hard offset shadows, warm paper
surfaces. React 19 components. Style via **CSS custom-property tokens** (the design
language) layered with Tailwind v4 utilities — never invent ad-hoc colors or spacing.

### Theme + skin (set once on the root)

The palette and aesthetic are driven by attributes on `document.documentElement`:

```js
document.documentElement.dataset.theme = "light"; // light | dark | rose-pine-dawn | kanagawa-wave | catppuccin-mocha
document.documentElement.dataset.skin  = "brutal"; // brutal | glass
```

Every token below resolves through these — set them before rendering or everything
falls back to light/brutal.

> **Dark-theme sibling cards.** The gallery includes four dark reference cards —
> **ChatViewDark, SidebarDark, ActivityViewDark, BoardViewDark** — shown beside
> their light originals (ChatView, Sidebar, ActivityView, BoardView). A `*Dark`
> card is **the exact same component** as its base, just rendered with
> `data-theme="dark"` to show the dark palette — there is no separate "dark"
> component to import. To build in dark, use the base component (`ChatView`, …)
> and set `data-theme="dark"` on the root. Every component is theme-agnostic
> (light default) and supports all five themes + glass skin via the root
> attributes above.

### Provider wrapping

Data-backed components (`ChatView`, `Sidebar`, `ActivityView`, `RoomHeader`,
`AgentRoster`, `ThreadPane`, `BoardView`, `MessageRow`, …) read app context and must be
wrapped. Compose them inside this chain (all are bundle exports):

```jsx
<DataSourceProvider value={dataSource}>
  <ContextMenuProvider><ToastProvider><ArchiveRecoveryProvider>
    {/* your composition */}
  </ArchiveRecoveryProvider></ToastProvider></ContextMenuProvider>
</DataSourceProvider>
```

`value` is a `DataSource`; a ready seeded `mockDataSource` export is available for
previews. Pure primitives (`Avatar`, `StatusDot`, `IdentityBadge`, `MentionChip`,
`CountChip`, `Sticker`, `PollWidget`, `Markdown`) take props and need no provider.

### The token vocabulary (style with `var(--…)`, real names)

| Family | Real tokens |
|---|---|
| Surfaces | `--paper` `--paper-2` `--paper-3`, `--surface` `--surface-raised` `--surface-sunken` |
| Text | `--ink` `--ink-soft` `--ink-faint`, `--fg` `--fg-soft` `--fg-faint`, `--muted` |
| Accents | `--lime` `--pink` `--yellow` `--teal` `--tangerine` `--lilac` `--blue` `--red` |
| Borders / rules | `--rule`, `--line` `--line-sm` `--line-md` `--line-bold` |
| Shadows (hard offset) | `--shadow` `--shadow-sm` `--shadow-md` `--shadow-lg` `--shadow-hover` |
| Radius | `--radius-xs…--radius-2xl`, `--radius-pill`, `--radius-none` |
| Spacing | `--space-0…--space-N` (4px scale) |
| Type | `--font-display` `--font-ui` `--font-mono`, `--text-8…--text-NN`, `--font-weight-bold/black`, `--tracking-*` |
| Self / mention | `--you-bg` `--you-fg`, `--mention-color` `--mention-ink` |

Fonts: Archivo Black (display), Space Grotesk (UI), JetBrains Mono (mono) — loaded
remotely. Read `styles.css` → `_ds_bundle.css` for the full token set and each
component's `.d.ts` / `.prompt.md` for its API before styling.

### Idiomatic snippet

```jsx
<div style={{
  background: "var(--paper)", color: "var(--ink)",
  padding: "var(--space-4)", border: "var(--line)",
  boxShadow: "var(--shadow)", borderRadius: "var(--radius-none)",
  fontFamily: "var(--font-ui)",
}}>
  <Avatar agent={agent} size={32} showStatus />
  <span style={{ fontFamily: "var(--font-display)", letterSpacing: "var(--tracking-md)" }}>
    INBOX
  </span>
</div>
```
