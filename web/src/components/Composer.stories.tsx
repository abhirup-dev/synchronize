import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Composer } from "./Composer.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { inChatSurface } from "../storybook/shellFrames.tsx";

// Provider-backed: Composer reads agents/rooms/skills and dispatches sendMessage
// through the MockDataSource supplied by the global StorybookProviders decorator.
// Only `roomId` is required; everything else flows through hooks.
const group = GROUPS.find((r) => r.id === "checkout-revamp")!;
const dm = DMS.find((r) => r.id === "dm-cortex")!;

const meta = {
  title: "Composer/Composer",
  component: Composer,
  parameters: { layout: "fullscreen" },
  decorators: [inChatSurface],
  args: { roomId: group.id },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

// Full composer for a populated group room: toolbar, textarea, footer hints, send.
export const Default: Story = {};

// Reply composer scoped to a thread parent — sends carry parentMessageId.
export const ThreadReply: Story = {
  args: { parentMessageId: "m2" },
};

// Collapsed stub that ChatView mounts to reclaim vertical space; click expands it.
export const Collapsed: Story = {
  args: { collapsedDefault: true },
};

// Thread-summary toggle rendered in the footer when the room pane exposes it.
export const WithThreadSummary: Story = {
  args: { threadSummaryOpen: false, onToggleThreadSummary: () => {} },
};

// Direct-message room — same composer, narrower membership for mentions.
export const DirectMessage: Story = {
  args: { roomId: dm.id },
};

// Compact (mobile-narrow, 390): toolbar, textarea, and footer hints at a thumb
// width — the Android composer state (incl. safe-area padding).
export const Compact: Story = {
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
};

export const MentionComboboxSemantics: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByRole("textbox");
    const combobox = canvas.getByRole("combobox");
    await expect(combobox).toHaveAttribute("aria-expanded", "false");
    await userEvent.type(textarea, "@");
    await expect(combobox).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("listbox", { name: "mention suggestions" })).toBeVisible();
  },
};

// Type into the textarea and hit send; submit() clears the draft on success,
// which is the observable effect of the sendMessage dispatch landing.
export const TypeAndSend: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Room-aware placeholder (ref: `message #checkout-revamp — @ tags an agent`).
    const textarea = canvas.getByPlaceholderText(
      "message #checkout-revamp — @ tags an agent",
    ) as HTMLTextAreaElement;

    await userEvent.type(textarea, "shipping the migration now");
    await expect(textarea).toHaveValue("shipping the migration now");

    const send = canvas.getByRole("button", { name: "send message" });
    await expect(send).toBeEnabled();
    await userEvent.click(send);

    // submit() resets the draft once sendMessage resolves.
    await expect(textarea).toHaveValue("");
  },
};
