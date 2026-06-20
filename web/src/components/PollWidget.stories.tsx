import type { Meta, StoryObj } from "@storybook/react-vite";
import { PollWidget } from "./PollWidget.tsx";
import { AGENTS, MESSAGES } from "../data/seed.ts";
import type { Poll } from "../data/types.ts";

// The seeded heartbeat poll ("Are you alive?") is the canonical fixture.
const seedPoll = MESSAGES["heartbeat-checks"]!.find((m) => m.poll)!.poll!;

const meta = {
  title: "Messages/PollWidget",
  component: PollWidget,
  args: { agents: AGENTS, me: "you" },
} satisfies Meta<typeof PollWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

// Open poll, deadline in the future, "you" has not voted yet.
const openPoll: Poll = {
  ...seedPoll,
  closesAt: new Date(Date.now() + 5 * 60_000).toISOString(),
};

export const Open: Story = {
  args: { poll: openPoll },
};

// Same poll but "you" has cast a vote — the picked option is highlighted.
const votedPoll: Poll = {
  ...openPoll,
  options: openPoll.options.map((opt) =>
    opt.id === "alive" ? { ...opt, voters: [...opt.voters, "you"] } : opt,
  ),
};

export const Voted: Story = {
  args: { poll: votedPoll },
};

// Closed poll: deadline in the past renders "closed", everyone eligible voted.
const closedPoll: Poll = {
  ...seedPoll,
  closesAt: new Date(Date.now() - 60_000).toISOString(),
  options: seedPoll.options.map((opt) =>
    opt.id === "alive"
      ? { ...opt, voters: ["cortex", "atlas", "nova", "echo", "you"] }
      : { ...opt, voters: ["pulse"] },
  ),
};

export const ClosedResults: Story = {
  args: { poll: closedPoll },
};

// No deadline and zero votes — fresh poll with the "open · no deadline" footer.
const emptyPoll: Poll = {
  question: "Ship the rollout tonight?",
  eligible: ["you", "cortex", "atlas", "vega", "nova", "echo", "pulse"],
  options: [
    { id: "ship", label: "SHIP IT", icon: "🚀", voters: [] },
    { id: "hold", label: "HOLD", icon: "✋", voters: [] },
  ],
};

export const EmptyNoDeadline: Story = {
  args: { poll: emptyPoll },
};
