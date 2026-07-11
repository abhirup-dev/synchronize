import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatView } from "./ChatView.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { inChatSurface } from "../storybook/shellFrames.tsx";

// Responsive matrix (sync-i24s.4): the real chat surface pinned to specific
// viewport presets. Use the toolbar Theme/Skin controls to sweep these across
// palettes and skins. Android-class widths (390/412) must show no horizontal
// overflow. ChatView needs only `room`; messages/agents come from the global
// MockDataSource decorator.
const group = GROUPS.find((r) => r.id === "checkout-revamp")!;
const dm = DMS[0]!;

const meta = {
  title: "Layouts/Chat Surface",
  component: ChatView,
  parameters: { layout: "fullscreen" },
  // Mount through the real chat-surface cells so shell mode (derived from the
  // viewport width) drives timeline/composer/compact exactly as the app does.
  decorators: [inChatSurface],
  args: { room: group },
} satisfies Meta<typeof ChatView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
};

export const MediumShell: Story = {
  globals: { viewport: { value: "mediumShell", isRotated: false } },
};

export const Tablet: Story = {
  globals: { viewport: { value: "tablet", isRotated: false } },
};

export const AndroidCompact: Story = {
  globals: { viewport: { value: "androidPixel", isRotated: false } },
};

export const MobileNarrowDM: Story = {
  args: { room: dm },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
};
