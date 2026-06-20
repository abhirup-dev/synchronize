import type { Meta, StoryObj } from "@storybook/react-vite";
import { Placeholder } from "../App.tsx";
import { inChatSurface } from "../storybook/shellFrames.tsx";

// Stamp shown for not-yet-built surfaces (e.g. the Artifacts tab).
const meta = {
  title: "Surfaces/Placeholder",
  component: Placeholder,
  parameters: { layout: "fullscreen" },
  // `.placeholder` is flex:1 + place-items:center — it needs the bounded chat
  // column it lives in (the app renders it there for the Artifacts tab). Without
  // a sized flex parent the stamp clips off the top.
  decorators: [inChatSurface],
  args: { label: "ARTIFACTS — coming in V2" },
} satisfies Meta<typeof Placeholder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Artifacts: Story = {};
