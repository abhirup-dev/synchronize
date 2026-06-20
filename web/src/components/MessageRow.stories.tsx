import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, expect, fn, screen, within } from "storybook/test";
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

// Self ("You") message: shows the "You" name pill but NO avatar gutter — the
// .is-you row is single-column. Regression guard for the stray centered avatar
// bug (gutter was rendered into the 1-col grid and floated mid-pane).
export const SelfMessage: Story = {
  args: { message: msgs[3]!, author: authorOf(msgs[3]!.authorId) },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector(".message-row.is-you");
    await expect(row).toBeTruthy();
    await expect(row!.querySelector(".message-gutter")).toBeNull();
  },
};

// Interaction test: open the quick-reaction picker and pick an emoji, asserting
// the onReact callback fires with (messageId, emoji). msgs[0] has no existing
// reactions, so the picker's 👍 is the only one in the DOM.
export const ReactWithPicker: Story = {
  args: { message: msgs[0]!, author: authorOf(msgs[0]!.authorId), onReact: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "add reaction" }));
    await userEvent.click(await screen.findByRole("button", { name: "👍" }));
    await expect(args.onReact).toHaveBeenCalledWith(msgs[0]!.id, "👍");
  },
};
