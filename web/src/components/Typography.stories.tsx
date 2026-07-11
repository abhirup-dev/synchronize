import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { MessageRow } from "./MessageRow.tsx";
import { ActivityView } from "./ActivityView.tsx";
import { ChatView } from "./ChatView.tsx";
import { ThreadPane } from "./ThreadPane.tsx";
import { AGENTS, GROUPS } from "../data/seed.ts";
import type { Message } from "../data/types.ts";
import { ChatSplitSurfaceFrame } from "../storybook/shellFrames.tsx";
import {
  AvailabilityBadge,
  FontSwitchChrome,
  type FontPreviewArgs,
  fontVars,
  typographyArgTypes,
} from "../storybook/typographyFontSwitch.tsx";

const previewAuthor = AGENTS.find((agent) => agent.id === "atlas")!;
const chatPreviewRoom = GROUPS.find((room) => room.id === "checkout-revamp")!;
const chatPreviewThreadParentId = "m2";
const previewMessage: Message = {
  id: "typography-rich-preview",
  roomId: "design-system",
  authorId: "atlas",
  createdAt: new Date().toISOString(),
  body: [
    "# H1 / Report title style",
    "",
    "This is a deliberately long rich-message preview for comparing fonts in the same surface that chat and thread bubbles use. It includes **bold emphasis**, _italic nuance_, a long inline token like `SYNCHRONIZE_SESSION_NAME=typography-preview`, and enough ordinary prose to expose x-height, counters, punctuation rhythm, and how each typeface behaves under sustained reading.",
    "",
    "The second paragraph is intentionally dense because agent messages often carry operational context rather than short social chat. A good font should keep the paragraph readable across multiple wrapped lines, preserve a clear distinction between commas and periods, and avoid making bold text feel like a billboard in Kanagawa Wave. It should also make paths such as `/Users/dev/work/synchronize/web/src/components/Typography.stories.tsx` feel legible without dominating the sentence.",
    "",
    "## H2 / Section heading style",
    "",
    "Here is a report-style section with a mixture of list structure, inline code, and emphasis. The goal is to see whether the selected body font can survive the exact format agents tend to produce when summarizing a debugging session or a design review.",
    "",
    "1. Check whether the daemon state came from the expected runtime, not a stale browser tab.",
    "2. Compare the active room, selected thread, and `messageId` target before declaring the link correct.",
    "3. If the preview looks cramped, adjust the rich-message rhythm rather than changing every Markdown surface.",
    "",
    "```ts",
    "type RichMarkdownSurface = \"chat-bubble\" | \"thread-bubble\";",
    "",
    "function shouldUseRichMarkdown(surface: string): surface is RichMarkdownSurface {",
    "  return surface === \"chat-bubble\" || surface === \"thread-bubble\";",
    "}",
    "```",
    "",
    "### H3 / Detail label style",
    "",
    "- Confirm markdown headings remain distinct without turning the bubble into a document page.",
    "- Check **bold text** in Kanagawa Wave without overpowering the body.",
    "- Compare inline code like `--session-id 75d04165-9ccc-471f-be23-e35f3374e4b8` against prose.",
    "- Keep this preview scoped to Storybook typography exploration.",
    "",
    "### H3 / Pseudo-code and formula explanation",
    "",
    "When agents explain logic they often write compact notation in ordinary prose: score = Σ(weight_i * signal_i) / max(totalWeight, ε), (roomId, threadParentId) -> focusMessageId, or if (state.archived && !session.live) { resume(mode: \"foreground\") }. The chosen body font needs clear parentheses (), brackets [], braces {}, pipes |, arrows ->, fat arrows =>, comparisons >= <= !==, and dense punctuation like map<string, Array<Event>> without turning the sentence into visual noise.",
    "",
    "A longer pseudo-code paragraph stresses mixed prose and symbols: compute visibleRows = rows.filter((row) => selectedRooms.has(row.roomId) && (filter === \"all\" || row.awaiting === true)), then group by room.name, then sort by (max(eventId), createdAt) descending. In markdown this is still ordinary explanatory text, not a formal math renderer, so the body font has to keep A[i + 1], Δt = t_now - t_seen, (p95_latency / baseline) < 1.10, and confidence = P(success | room, actor, age) readable inside one wrapped paragraph.",
    "",
    "Another realistic explanation: if arrivals(t) ~ Poisson(λ) and backlog_next = max(0, backlog_now + arrivals(t) - capacity(t)), the UI should show a warning only when backlog_next >= threshold && trend(backlog, 15m) > 0. This is intentionally normal body text so the selected prose font, not the monospace code font, is what gets evaluated.",
    "",
    "```txt",
    "for each room in rooms:",
    "  rows := activity[room.id] ?? []",
    "  freshness := max(rows.map(r => r.eventId)) - min(rows.map(r => r.eventId))",
    "  display(room) when (rows.length > 0) && (freshness >= threshold)",
    "```",
    "",
    "> Blockquote treatment should still feel like a note inside a message, not a separate document. It needs enough contrast to be discoverable but should not steal focus from the surrounding prose.",
    "",
    "## H2 / Longer conclusion style",
    "",
    "Long conclusions are where font choice tends to fail. This paragraph mixes readable natural language with identifiers, quotes, and compact technical notation: the agent checked `web/src/components/MessageRow.tsx`, verified `variant=\"rich\"`, and confirmed that activity previews continue to use basic markdown. The message should feel calm enough to scan, but not so lightweight that it washes out against the dark paper surface.",
    "",
    "A final paragraph adds another long run of text so the preview has enough vertical mass to judge paragraph spacing, line height, and heading recovery after code blocks. When switching fonts from the dropdown, look at the shape of lowercase letters, the weight of punctuation, how `inline code` interrupts the sentence, and whether **important words** remain readable without becoming visually loud.",
  ].join("\n"),
  mentions: [],
  reactions: [],
};

const meta = {
  title: "Design/Typography",
  args: {
    bodyFont: "Avenir Next",
    headingFont: "Space Grotesk",
    displayFont: "Archivo Black",
    codeFont: "JetBrains Mono",
    width: 700,
  },
  argTypes: typographyArgTypes,
  parameters: { layout: "centered" },
} satisfies Meta<FontPreviewArgs>;

export default meta;
type Story = StoryObj<FontPreviewArgs>;

function PreviewFrame({
  bodyFont,
  headingFont,
  displayFont,
  codeFont,
  width,
}: {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  codeFont: string;
  width: number;
}) {
  return (
    <section
      style={{
        ...fontVars(bodyFont, headingFont, displayFont, codeFont),
        background: "var(--paper)",
        color: "var(--ink)",
        display: "grid",
        fontFamily: "var(--font-ui)",
        gap: 12,
        width,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              color: "var(--ink)",
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-13)",
              letterSpacing: "var(--tracking-sm)",
              margin: 0,
            }}
          >
            {bodyFont}
          </h3>
          <p
            style={{
              color: "var(--ink-soft)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-10)",
              margin: "4px 0 0",
            }}
          >
            heading: {headingFont} · display: {displayFont} · code: {codeFont}
          </p>
        </div>
        <AvailabilityBadge font={bodyFont} />
      </header>
      <div className="chat-list">
        <div className="message-virtual-row">
          <MessageRow message={previewMessage} author={previewAuthor} agents={AGENTS} groupedWithPrev={false} />
        </div>
      </div>
    </section>
  );
}

function ActivityPreviewFrame({
  bodyFont,
  headingFont,
  displayFont,
  codeFont,
  width,
}: {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  codeFont: string;
  width: number;
}) {
  return (
    <section
      style={{
        ...fontVars(bodyFont, headingFont, displayFont, codeFont),
        background: "var(--paper)",
        color: "var(--ink)",
        fontFamily: "var(--font-ui)",
        height: 780,
        maxWidth: "calc(100vw - 32px)",
        minWidth: 760,
        overflow: "hidden",
        width: Math.max(width, 960),
      }}
    >
      <ActivityView
        onJumpToRoom={() => {}}
        onOpenDm={() => {}}
        threadWidth={420}
        onThreadWidth={() => {}}
      />
    </section>
  );
}

function ChatPreviewFrame({
  bodyFont,
  headingFont,
  displayFont,
  codeFont,
  width,
}: {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  codeFont: string;
  width: number;
}) {
  const [threadOpen, setThreadOpen] = useState(true);
  const [threadParentId, setThreadParentId] = useState<string | null>(chatPreviewThreadParentId);
  const showThread = threadOpen && Boolean(threadParentId);

  useEffect(() => {
    setThreadParentId(threadOpen ? chatPreviewThreadParentId : null);
  }, [threadOpen]);

  return (
    <section
      style={{
        ...fontVars(bodyFont, headingFont, displayFont, codeFont),
        background: "var(--paper)",
        color: "var(--ink)",
        display: "grid",
        fontFamily: "var(--font-ui)",
        gap: 10,
        maxWidth: "calc(100vw - 32px)",
        minWidth: 920,
        width: Math.max(width, 1120),
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            color: "var(--ink-soft)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-10)",
          }}
        >
          chat surface · checkout-revamp · thread {showThread ? "open" : "closed"}
        </span>
        <button
          className="topbar-control"
          type="button"
          aria-pressed={showThread}
          onClick={() => setThreadOpen((open) => !open)}
        >
          {showThread ? "close thread" : "open thread"}
        </button>
      </div>
      <div style={{ height: 760, minHeight: 0, overflow: "hidden" }}>
        <ChatSplitSurfaceFrame
          paneWidth={420}
          pane={showThread ? (
            <ThreadPane
              room={chatPreviewRoom}
              parentId={threadParentId ?? chatPreviewThreadParentId}
              onClose={() => setThreadOpen(false)}
              showHeader={false}
            />
          ) : undefined}
        >
          <ChatView
            room={chatPreviewRoom}
            onOpenThread={(parentId) => {
              setThreadParentId(parentId);
              setThreadOpen(true);
            }}
            isThreadOpen={showThread}
            threadSummaryOpen={false}
            onToggleThreadSummary={() => {}}
          />
        </ChatSplitSurfaceFrame>
      </div>
    </section>
  );
}

export const RichMarkdownFontSwitch: Story = {
  render: ({ bodyFont, headingFont, displayFont, codeFont, width }) => (
    <FontSwitchChrome bodyFont={bodyFont} headingFont={headingFont} displayFont={displayFont} codeFont={codeFont} width={width}>
      {(selection) => <PreviewFrame {...selection} />}
    </FontSwitchChrome>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".markdown.rich-markdown")).toBeTruthy();
    await expect(canvasElement.querySelectorAll("select")).toHaveLength(4);
  },
};

export const ActivityFontSwitch: Story = {
  args: { width: 1080 },
  parameters: { layout: "centered" },
  render: ({ bodyFont, headingFont, displayFont, codeFont, width }) => (
    <FontSwitchChrome bodyFont={bodyFont} headingFont={headingFont} displayFont={displayFont} codeFont={codeFont} width={width} maxWidth={1160}>
      {(selection) => <ActivityPreviewFrame {...selection} />}
    </FontSwitchChrome>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".activity-view")).toBeTruthy();
    await expect(canvasElement.querySelectorAll("select")).toHaveLength(4);
  },
};

export const ChatWindowFontSwitch: Story = {
  args: { width: 1120 },
  parameters: {
    layout: "centered",
    viewport: { defaultViewport: "desktop" },
  },
  render: ({ bodyFont, headingFont, displayFont, codeFont, width }) => (
    <FontSwitchChrome bodyFont={bodyFont} headingFont={headingFont} displayFont={displayFont} codeFont={codeFont} width={width} maxWidth={1180}>
      {(selection) => <ChatPreviewFrame {...selection} />}
    </FontSwitchChrome>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".chat-list")).toBeTruthy();
    await expect(canvasElement.querySelector(".thread-pane")).toBeTruthy();
    await expect(canvasElement.querySelectorAll("select")).toHaveLength(4);
  },
};
