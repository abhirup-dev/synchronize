import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect } from "storybook/test";
import { useContextMenu, type MenuEntry } from "./ContextMenu.tsx";
import { AGENTS } from "../data/seed.ts";

// The ContextMenuProvider is mounted globally by the StorybookProviders
// decorator (.storybook/preview.tsx), so these stories only USE the
// useContextMenu() hook — they never re-mount the provider. Each story renders
// a right-clickable target whose contextmenu opens the shared menu popup.

const TARGET_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 280,
  height: 120,
  border: "var(--line-md)",
  borderRadius: "var(--radius-lg, 12px)",
  background: "var(--paper-2, #1a1a1a)",
  color: "var(--ink, #eee)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "var(--text-13, 13px)",
  cursor: "context-menu",
  userSelect: "none",
} as const;

function Target({ items, label }: { items: MenuEntry[]; label: string }) {
  const open = useContextMenu();
  return (
    <div style={{ padding: 48 }}>
      <div style={TARGET_STYLE} onContextMenu={(e) => open(e, items)}>
        {label}
      </div>
    </div>
  );
}

const agent = AGENTS[0]!;

const meta = {
  title: "Surfaces/ContextMenu",
  component: Target,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Target>;

export default meta;
type Story = StoryObj<typeof meta>;

// A typical message context menu: a few actions, a divider, and a danger row.
const messageItems: MenuEntry[] = [
  { label: "Reply in thread", shortcut: "R", onSelect: () => {} },
  { label: "React", shortcut: "E", onSelect: () => {} },
  { label: "Copy text", shortcut: "⌘C", onSelect: () => {} },
  { divider: true },
  { label: "Delete message", danger: true, shortcut: "⌫", onSelect: () => {} },
];

export const MessageActions: Story = {
  args: { items: messageItems, label: "Right-click me" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const target = canvas.getByText("Right-click me");
    await userEvent.pointer({ keys: "[MouseRight]", target });
    // Popup renders in a portal — query the whole document, not just the canvas.
    const menu = within(document.body);
    await expect(await menu.findByText("Reply in thread")).toBeInTheDocument();
    await expect(menu.getByText("Delete message")).toBeInTheDocument();
  },
};

// Edge case: a disabled item alongside enabled ones.
const peerItems: MenuEntry[] = [
  { label: `Message ${agent.name}`, onSelect: () => {} },
  { label: "View profile", onSelect: () => {} },
  { divider: true },
  { label: "Mute (already muted)", disabled: true, onSelect: () => {} },
  { label: "Remove from group", danger: true, onSelect: () => {} },
];

export const WithDisabledItem: Story = {
  args: { items: peerItems, label: `Right-click ${agent.name}` },
};

// Minimal: a single action, no divider, no shortcut.
export const SingleAction: Story = {
  args: {
    items: [{ label: "Archive", onSelect: () => {} }],
    label: "Right-click for one option",
  },
};
