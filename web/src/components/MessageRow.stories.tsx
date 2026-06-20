import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageRow } from "./MessageRow.tsx";
import { AGENTS, MESSAGES } from "../data/seed.ts";

const msgs = MESSAGES["checkout-revamp"]!;
const authorOf = (authorId: string) => AGENTS.find((a) => a.id === authorId)!;

const meta = {
  title: "Messages/MessageRow",
  component: MessageRow,
  args: { agents: AGENTS, groupedWithPrev: false },
} satisfies Meta<typeof MessageRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  args: { message: msgs[0]!, author: authorOf(msgs[0]!.authorId) },
};

// m2 carries markdown, a fenced SQL block, reactions, and a thread reply count —
// the busiest single-row state.
export const RichWithReactions: Story = {
  args: { message: msgs[1]!, author: authorOf(msgs[1]!.authorId) },
};

export const GroupedWithPrev: Story = {
  args: { message: msgs[2]!, author: authorOf(msgs[2]!.authorId), groupedWithPrev: true },
};
