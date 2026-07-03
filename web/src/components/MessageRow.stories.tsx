import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, userEvent, expect, fn, screen, waitFor, within } from "storybook/test";
import { MessageRow } from "./MessageRow.tsx";
import { AGENTS, MESSAGES } from "../data/seed.ts";
import { agentsWithRuntimeDetails } from "../storybook/runtimeDetailsProvider.tsx";

const msgs = MESSAGES["checkout-revamp"]!;
const msg = (id: string) => msgs.find((m) => m.id === id)!;
const authorOf = (authorId: string) => AGENTS.find((a) => a.id === authorId)!;
const runtimeAuthorOf = (authorId: string) => agentsWithRuntimeDetails.find((a) => a.id === authorId)!;
const avatarMenuMsg = msg("m3");
const avatarMenuAuthor = runtimeAuthorOf(avatarMenuMsg.authorId);
const longAutolink =
  "https://sharechat.slack.com/archives/C08Q1HBQ2BF/p1752123456789012?thread_ts=1752123456.789012&cid=C08Q1HBQ2BF&workspace=synchronize-long-link-wrap-regression";
const longPlainToken =
  "series_019eaa8ff63f77728e51992a7b500930_with_feature_store_compact_ttl_backfill_pending";

const meta = {
  title: "Messages/MessageRow",
  component: MessageRow,
  args: { agents: AGENTS, groupedWithPrev: false },
} satisfies Meta<typeof MessageRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  args: { message: msg("m1"), author: authorOf(msg("m1").authorId) },
};

// m2 carries markdown, a fenced SQL block, reactions, and a thread reply count —
// the busiest single-row state. Wire onReact + onOpenThread because the real
// mount (ChatView/ThreadPane) always passes them: that surfaces the add-reaction
// affordance and the clickable reply badge, not just the reactions themselves.
export const RichWithReactions: Story = {
  args: { message: msg("m2"), author: authorOf(msg("m2").authorId), onReact: fn(), onOpenThread: fn() },
};

export const RichWithLongAutolink: Story = {
  render: (args) => (
    <div style={{ width: 420 }}>
      <MessageRow {...args} />
    </div>
  ),
  args: {
    message: {
      id: "long-link-edge",
      roomId: "checkout-revamp",
      authorId: "atlas",
      createdAt: new Date().toISOString(),
      body: [
        "Context from the archive:",
        "",
        longAutolink,
        "",
        `Related token: ${longPlainToken}`,
      ].join("\n"),
      mentions: [],
      reactions: [],
    },
    author: authorOf("atlas"),
  },
  play: async ({ canvasElement }) => {
    const link = canvasElement.querySelector<HTMLAnchorElement>(`a[href="${longAutolink}"]`);
    expect(link).toBeTruthy();
    expect(link!.textContent).toBe(longAutolink);
    expect(link!.getAttribute("href")).toBe(longAutolink);
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");

    await fireEvent.contextMenu(link!);
    await waitFor(() => expect(screen.getByText("Copy link address")).toBeTruthy());
    expect(screen.queryByText("Reply in thread")).toBeNull();

    const bubble = canvasElement.querySelector<HTMLElement>(".bubble");
    expect(bubble).toBeTruthy();
    expect(bubble!.textContent).toContain(longPlainToken);
    expect(bubble!.scrollWidth).toBeLessThanOrEqual(bubble!.clientWidth + 1);
  },
};

export const ThreadPaneTextReaction: Story = {
  render: (args) => (
    <div className="thread-pane-body" style={{ width: 280 }}>
      <MessageRow {...args} />
    </div>
  ),
  args: {
    message: {
      id: "thread-text-reaction-edge",
      roomId: "checkout-revamp",
      authorId: "atlas",
      createdAt: new Date().toISOString(),
      body: "Text-like reactions should stay horizontal inside the narrower thread pane footer.",
      mentions: [],
      reactions: [{ emoji: "ok", by: ["you"] }],
      parentId: "m2",
    },
    author: authorOf("atlas"),
    onReact: fn(),
    hideAvatar: true,
  },
  play: async ({ canvasElement }) => {
    const reaction = canvasElement.querySelector<HTMLElement>(".reaction");
    expect(reaction).toBeTruthy();
    expect(reaction!.textContent?.replace(/\s+/g, "")).toBe("ok1");
    const rect = reaction!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(rect.height);
  },
};

export const ThreadPaneShortSelfReply: Story = {
  render: (args) => (
    <div className="thread-pane-body" style={{ width: 280 }}>
      <MessageRow {...args} />
    </div>
  ),
  args: {
    message: {
      id: "thread-short-self-edge",
      roomId: "checkout-revamp",
      authorId: "you",
      createdAt: new Date().toISOString(),
      body: "cool",
      mentions: [],
      reactions: [],
      parentId: "m2",
    },
    author: authorOf("you"),
    hideAvatar: true,
  },
  play: async ({ canvasElement }) => {
    const bubble = canvasElement.querySelector<HTMLElement>(".bubble");
    expect(bubble).toBeTruthy();
    expect(bubble!.textContent?.trim()).toBe("cool");
    const rect = bubble!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(rect.height);
  },
};

export const LongMultiParagraphMessage: Story = {
  render: (args) => (
    <div className="chat-list" style={{ width: 560 }}>
      <div className="message-virtual-row">
        <MessageRow {...args} />
      </div>
    </div>
  ),
  args: {
    message: {
      id: "long-paragraph-edge",
      roomId: "checkout-revamp",
      authorId: "atlas",
      createdAt: new Date().toISOString(),
      body: [
        "The first thing I checked was whether the archive result had enough signal to explain the bug without opening another panel. The answer was mostly yes: the event trail had the right people, the right room, and enough timing detail to make the next step obvious.",
        "",
        "The second paragraph is intentionally long enough to wrap across several visual lines. This is where the bubble used to feel cramped because paragraph transitions were not visually distinct from ordinary line wrapping inside a single paragraph.",
        "",
        "The third paragraph keeps the same body size but should breathe a little more. The message text is unchanged; only the bubble-scoped markdown rhythm should create separation between paragraphs.",
      ].join("\n"),
      mentions: [],
      reactions: [],
    },
    author: authorOf("atlas"),
  },
  play: async ({ canvasElement }) => {
    const bubble = canvasElement.querySelector<HTMLElement>(".bubble");
    expect(bubble).toBeTruthy();
    expect(bubble!.querySelector(".markdown.rich-markdown")).toBeTruthy();
    const paragraphs = [...bubble!.querySelectorAll<HTMLParagraphElement>(".markdown p")];
    expect(paragraphs).toHaveLength(3);
    expect(getComputedStyle(paragraphs[0]!).lineHeight).toBe(getComputedStyle(paragraphs[1]!).lineHeight);
    expect(getComputedStyle(paragraphs[1]!).lineHeight).toBe("21px");
    expect(parseFloat(getComputedStyle(paragraphs[1]!).marginBlockStart)).toBeGreaterThan(0);
  },
};

export const RichWithHeadingLevels: Story = {
  render: (args) => (
    <div className="chat-list" style={{ width: 560 }}>
      <div className="message-virtual-row">
        <MessageRow {...args} />
      </div>
    </div>
  ),
  args: {
    message: {
      id: "heading-levels-edge",
      roomId: "checkout-revamp",
      authorId: "atlas",
      createdAt: new Date().toISOString(),
      body: [
        "# H1 / Report title style",
        "",
        "The room-level context should make the top heading feel readable without turning the bubble into a document page. This paragraph includes **bold emphasis** to preview the Kanagawa message weight.",
        "",
        "## H2 / Section heading style",
        "",
        "The second-level heading introduces the ordered details that usually follow in a longer agent report.",
        "",
        "### H3 / Detail label style",
        "",
        "- Confirm the daemon state is fresh.",
        "- Reopen the thread if the archive summary references stale data.",
        "- Leave the final decision in the room.",
      ].join("\n"),
      mentions: [],
      reactions: [],
    },
    author: authorOf("atlas"),
  },
  play: async ({ canvasElement }) => {
    const bubble = canvasElement.querySelector<HTMLElement>(".bubble");
    expect(bubble).toBeTruthy();
    expect(bubble!.querySelector(".markdown.rich-markdown")).toBeTruthy();
    expect(bubble!.querySelector("h1")?.textContent).toBe("H1 / Report title style");
    expect(bubble!.querySelector("h2")?.textContent).toBe("H2 / Section heading style");
    expect(bubble!.querySelector("h3")?.textContent).toBe("H3 / Detail label style");
    expect(bubble!.querySelector("strong")?.textContent).toBe("bold emphasis");
  },
};

export const MessagePermalinkMenu: Story = {
  args: { message: msg("m1"), author: authorOf(msg("m1").authorId), onReact: fn(), onOpenThread: fn() },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(".message-row");
    expect(row).toBeTruthy();
    await fireEvent.contextMenu(row!);
    await waitFor(() => expect(screen.getByText("Copy link")).toBeTruthy());
    expect(screen.queryByText("Copy link (soon)")).toBeNull();
    const item = screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
  },
};

export const GroupedWithPrev: Story = {
  args: { message: msg("m3"), author: authorOf(msg("m3").authorId), groupedWithPrev: true },
};

// Self message: NO avatar gutter — the .is-self row is single-column. Regression
// guard for the stray centered avatar bug (gutter was rendered into the 1-col grid
// and floated mid-pane). The refactor unified is-you/is-web-author into is-self.
export const SelfMessage: Story = {
  args: { message: msg("m4"), author: authorOf(msg("m4").authorId) },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector(".message-row.is-self");
    await expect(row).toBeTruthy();
    await expect(row!.querySelector(".message-gutter")).toBeNull();
  },
};

// Interaction test: open the quick-reaction picker and pick an emoji, asserting
// the onReact callback fires with (messageId, emoji). m1 has no existing
// reactions, so the picker's 👍 is the only one in the DOM.
export const ReactWithPicker: Story = {
  args: { message: msg("m1"), author: authorOf(msg("m1").authorId), onReact: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "add reaction" }));
    await userEvent.click(await screen.findByRole("button", { name: "👍" }));
    await expect(args.onReact).toHaveBeenCalledWith("m1", "👍");
  },
};

export const AgentAvatarMenu: Story = {
  args: {
    agents: agentsWithRuntimeDetails,
    message: avatarMenuMsg,
    author: avatarMenuAuthor,
    onOpenDm: fn(),
  },
  play: async ({ canvasElement }) => {
    const avatar = canvasElement.querySelector<HTMLElement>(".message-gutter");
    expect(avatar).toBeTruthy();
    await fireEvent.contextMenu(avatar!);
    await waitFor(() => expect(screen.getByText("View profile")).toBeTruthy());
    expect(screen.getByText("Open DM")).toBeTruthy();
    expect(screen.getByText("Copy AOE attach command")).toBeTruthy();
    expect(screen.getByText("Archive session...")).toBeTruthy();
    expect(screen.getByText("Resume session...")).toBeTruthy();
    expect(screen.getByText("Copy @handle")).toBeTruthy();
    expect(screen.queryByText(/Focus on/i)).toBeNull();

    await userEvent.click(screen.getByText("View profile"));
    await waitFor(() => expect(screen.getByText(`${avatarMenuAuthor.name} profile`)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(avatarMenuAuthor.runtimeDetails!.model!)).toBeTruthy());
  },
};
