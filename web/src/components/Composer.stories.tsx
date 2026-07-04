import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Composer } from "./Composer.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { useDataSource } from "../data/context.tsx";
import type { DataSource } from "../data/types.ts";

// Provider-backed: Composer reads agents/rooms/skills and dispatches sendMessage
// through the MockDataSource supplied by the global StorybookProviders decorator.
// Only `roomId` is required; everything else flows through hooks.
const group = GROUPS.find((r) => r.id === "checkout-revamp")!;
const dm = DMS.find((r) => r.id === "dm-cortex")!;

const meta = {
  title: "Composer/Composer",
  component: Composer,
  parameters: { layout: "fullscreen" },
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

// Exposes the story's per-mount MockDataSource so play() can write drafts the
// way ANOTHER TAB would (through the DataSource, not the textarea). Rendered
// beside the real Composer — it adds no DOM and changes no mounting.
declare global {
  interface Window {
    __composerStoryDs?: DataSource;
  }
}
function CaptureDataSource() {
  window.__composerStoryDs = useDataSource();
  return null;
}
const withDataSourceCapture: NonNullable<Story["decorators"]> = (StoryFn) => (
  <>
    <CaptureDataSource />
    <StoryFn />
  </>
);
const composerTextarea = (canvasElement: HTMLElement) =>
  within(canvasElement).getByPlaceholderText("message the room… use @ to tag an agent") as HTMLTextAreaElement;

// A draft saved elsewhere (another tab / earlier session) hydrates into a
// pristine composer via the draft snapshot.
export const HydratedDraft: Story = {
  decorators: [withDataSourceCapture],
  play: async ({ canvasElement }) => {
    const textarea = composerTextarea(canvasElement);
    await expect(textarea).toHaveValue("");
    await window.__composerStoryDs!.saveDraft({ roomId: group.id, body: "picked up from the other tab" });
    await waitFor(() => expect(textarea).toHaveValue("picked up from the other tab"));
  },
};

// Echo suppression: a remote draft update must NOT clobber a composer that is
// focused with in-progress typing — the local text wins until it is sent or
// the composer goes idle.
export const RemoteUpdateWhileTyping: Story = {
  decorators: [withDataSourceCapture],
  play: async ({ canvasElement }) => {
    const textarea = composerTextarea(canvasElement);
    await userEvent.type(textarea, "local in-progress text");
    await window.__composerStoryDs!.saveDraft({ roomId: group.id, body: "remote overwrite attempt" });
    // Give the (suppressed) remote-apply effect a beat, then confirm the local
    // text survived.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(textarea).toHaveValue("local in-progress text");
  },
};

// Type into the textarea and hit send; submit() clears the draft on success,
// which is the observable effect of the sendMessage dispatch landing.
export const TypeAndSend: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByPlaceholderText(
      "message the room… use @ to tag an agent",
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
