import type { Meta, StoryObj, Decorator } from "@storybook/react-vite";
import { useContextMenu, type MenuEntry } from "./ContextMenu.tsx";
import { useEffect, useRef } from "react";

// Glass-skin sibling of ContextMenu — the ContextMenuProvider is mounted globally
// (StorybookProviders), and its popup renders in a portal. The base MessageActions
// story opens the menu via a play() interaction, which a static capture does not
// reproduce — so this sibling auto-opens the menu on mount, making the
// translucent glass popup (skin-glass.css backdrop on the menu surface) visible
// at capture time on both the preview and the storybook reference side.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const TARGET_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 280,
  height: 120,
  border: "var(--line-md)",
  borderRadius: "var(--radius-lg)",
  background: "var(--paper-2)",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-13)",
  cursor: "context-menu",
  userSelect: "none",
} as const;

// Auto-opens the menu on mount at the target's centre — the same anchor logic as
// the base MessageActions play(), but driven by an effect so it is present in a
// static render, not only after a Storybook interaction step.
function AutoOpenTarget({ items, label }: { items: MenuEntry[]; label: string }) {
  const open = useContextMenu();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + rect.height / 2),
      }),
    );
  }, []);
  return (
    <div style={{ padding: 48 }}>
      <div ref={ref} style={TARGET_STYLE} onContextMenu={(e) => open(e, items)}>
        {label}
      </div>
    </div>
  );
}

const messageItems: MenuEntry[] = [
  { label: "Reply in thread", shortcut: "R", onSelect: () => {} },
  { label: "React", shortcut: "E", onSelect: () => {} },
  { label: "Copy text", shortcut: "⌘C", onSelect: () => {} },
  { divider: true },
  { label: "Delete message", danger: true, shortcut: "⌫", onSelect: () => {} },
];

const meta = {
  title: "Surfaces/ContextMenu Glass",
  component: AutoOpenTarget,
  parameters: { layout: "fullscreen" },
  globals: { skin: "glass" },
  decorators: [glass],
} satisfies Meta<typeof AutoOpenTarget>;
export default meta;
type Story = StoryObj<typeof meta>;

// The canonical message context menu, auto-opened so the glass popup is captured.
export const MessageMenu: Story = {
  args: { items: messageItems, label: "Right-click me" },
};
