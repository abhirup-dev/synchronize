import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown } from "./Markdown.tsx";
import { AGENTS, MESSAGES } from "../data/seed.ts";

// m2 in checkout-revamp is the richest markdown body in seed: an h2 heading,
// an ordered list, inline code, and a fenced SQL block. Reuse it verbatim.
const seedBody = MESSAGES["checkout-revamp"]!.find((m) => m.id === "m2")!.body;

const meta = {
  title: "Messages/Markdown",
  component: Markdown,
  args: { agents: AGENTS },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

// Real message content from the seed: heading + ordered list + inline code + SQL fence.
export const FromSeed: Story = {
  args: { children: seedBody },
};

// Exercises the GFM table renderer plus mention chips. An agent handle wrapped in
// `@@handle` inline code resolves to a MentionChip via the `agents` prop.
export const TablesAndMentions: Story = {
  args: {
    children: [
      "### canary rollout status",
      "",
      "| stage | owner | traffic | status |",
      "| ----- | ----- | ------: | ------ |",
      "| dual-write | `@@cortex` | 100% | ✅ done |",
      "| backfill | `@@nova` | — | ⏳ running |",
      "| read flip | `@@vega` | 5% | 🟡 watching |",
      "",
      "ping `@@atlas` once the UI preview is live.",
    ].join("\n"),
  },
};

// TypeScript fenced block + inline code + autolink, the typical "code review" body.
export const TypeScriptCode: Story = {
  args: {
    children: [
      "Pushed the guard to `client.ts` — see the `assertLocalhost` helper:",
      "",
      "```ts",
      "function assertLocalhost(url: URL): void {",
      '  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {',
      "    throw new Error(`refusing non-local bind: ${url.hostname}`);",
      "  }",
      "}",
      "```",
      "",
      "spec lives at <https://example.com/synchronize/bind-policy>.",
    ].join("\n"),
  },
};

// GFM extras: task list, strikethrough, blockquote, nested bullets, bold/italic emphasis.
export const RichFormatting: Story = {
  args: {
    children: [
      "**Release checklist** for _checkout v2_:",
      "",
      "- [x] dual-write window closed",
      "- [x] ~~manual coupon backfill~~ (automated)",
      "- [ ] flip read path",
      "  - [ ] enable `checkout_v2_read=true`",
      "  - [ ] watch p99 latency for 1h",
      "",
      "> Note: roll back immediately if error rate exceeds **0.5%**.",
    ].join("\n"),
  },
};

// Edge case: an empty body. The renderer should produce an empty markdown container,
// not crash — this is what an in-flight / placeholder message looks like.
export const Empty: Story = {
  args: { children: "" },
};
