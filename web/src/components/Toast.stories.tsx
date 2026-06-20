import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { within, userEvent, expect } from "storybook/test";
import { useToast, type ToastKind } from "./Toast.tsx";

// The ToastProvider is mounted globally by the Storybook preview decorator, so
// these demos only need the `useToast()` hook to fire toasts. Each story renders
// a small panel of buttons that call `show`/`dismiss` against the live manager.

const KIND_LABEL: Record<ToastKind, string> = {
  info: "Info",
  success: "Success",
  warn: "Warning",
  error: "Error",
};

const KINDS: ToastKind[] = ["info", "success", "warn", "error"];

const MESSAGES: Record<ToastKind, string> = {
  info: "Atlas joined #checkout-revamp",
  success: "Message delivered to 3 peers",
  warn: "Daemon reconnecting — retrying in 5s",
  error: "Failed to reach daemon at 127.0.0.1",
};

const panel = { display: "flex", gap: 8, flexWrap: "wrap" as const, padding: 24 };

function ToastButtons() {
  const { show } = useToast();
  return (
    <div style={panel}>
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => show(MESSAGES[kind], { kind })}
          style={{ padding: "8px 14px", cursor: "pointer" }}
        >
          Show {KIND_LABEL[kind]}
        </button>
      ))}
    </div>
  );
}

function StickyToast() {
  const { show, dismiss } = useToast();
  const idRef = useRef<string | null>(null);
  return (
    <div style={panel}>
      <button
        type="button"
        onClick={() => {
          // duration 0 = sticky; requires manual dismiss.
          idRef.current = show("Uploading artifact… (sticky)", { kind: "info", duration: 0 });
        }}
        style={{ padding: "8px 14px", cursor: "pointer" }}
      >
        Show sticky toast
      </button>
      <button
        type="button"
        onClick={() => {
          if (idRef.current) dismiss(idRef.current);
        }}
        style={{ padding: "8px 14px", cursor: "pointer" }}
      >
        Dismiss it
      </button>
    </div>
  );
}

const meta = {
  title: "Surfaces/Toast",
  component: ToastButtons,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ToastButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

// All four kinds available to fire. The toast viewport is positioned at the top
// of the (global) provider's container.
export const AllKinds: Story = {};

// Fire a success toast and assert it lands in the viewport.
export const FiresSuccess: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Show Success" }));
    await expect(await canvas.findByText(MESSAGES.success)).toBeInTheDocument();
  },
};

// Error toast — the highest-severity tinted variant.
export const FiresError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Show Error" }));
    await expect(await canvas.findByText(MESSAGES.error)).toBeInTheDocument();
  },
};

// A sticky toast (duration 0) that only goes away on explicit dismiss.
export const StickyWithDismiss: Story = {
  render: () => <StickyToast />,
};
