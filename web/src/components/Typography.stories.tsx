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

/* Typography is FIXED to the Sigil reference (sigil/design.md §3): Instrument
   Sans for prose/UI, JetBrains Mono for metadata/machine text, px scale from
   tokens.css. These stories are the executable contract for that scale — they
   render real surfaces and assert computed font values, so any rule that
   drifts a surface off the reference scale fails here. */

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
    "This is a deliberately long rich-message preview for judging the fixed body typography in the same surface that chat and thread bubbles use. It includes **bold emphasis**, _italic nuance_, a long inline token like `SYNCHRONIZE_SESSION_NAME=typography-preview`, and enough ordinary prose to expose x-height, counters, punctuation rhythm, and sustained-reading behavior.",
    "",
    "## H2 / Section heading style",
    "",
    "1. Check whether the daemon state came from the expected runtime, not a stale browser tab.",
    "2. Compare the active room, selected thread, and `messageId` target before declaring the link correct.",
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
    "- Compare inline code like `--session-id 75d04165-9ccc-471f-be23-e35f3374e4b8` against prose.",
    "",
    "| column | value |",
    "| --- | --- |",
    "| p95 | 118ms |",
    "| errors | 0.02% |",
    "",
    "> Blockquote treatment should still feel like a note inside a message, not a separate document.",
  ].join("\n"),
  mentions: [],
  reactions: [],
};

const meta = {
  title: "Design/Typography",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const MONO = "JetBrains Mono";
const SANS = "Instrument Sans";

function styleOf(el: Element) {
  return getComputedStyle(el as HTMLElement);
}

export const RichMarkdown: Story = {
  render: () => (
    <section style={{ background: "var(--paper)", color: "var(--ink)", width: 700 }}>
      <div className="chat-list">
        <div className="message-virtual-row">
          <MessageRow message={previewMessage} author={previewAuthor} agents={AGENTS} groupedWithPrev={false} />
        </div>
      </div>
    </section>
  ),
  play: async ({ canvasElement }) => {
    const bubble = canvasElement.querySelector(".bubble")!;
    await expect(bubble).toBeTruthy();
    // Message body: 13.5px Instrument Sans, line-height 1.6 (13.5 * 1.6 = 21.6)
    await expect(styleOf(bubble).fontSize).toBe("13.5px");
    await expect(styleOf(bubble).fontFamily).toContain(SANS);
    await expect(styleOf(bubble).lineHeight).toBe("21.6px");
    // Inline code: 12px JetBrains Mono
    const inlineCode = canvasElement.querySelector(".markdown p code, .markdown li code")!;
    await expect(styleOf(inlineCode).fontSize).toBe("12px");
    await expect(styleOf(inlineCode).fontFamily).toContain(MONO);
    // Code block: 12px mono / 1.6
    const pre = canvasElement.querySelector(".markdown pre")!;
    await expect(styleOf(pre).fontSize).toBe("12px");
    await expect(styleOf(pre).lineHeight).toBe("19.2px");
    // Table header: mono, uppercase, tracked
    const th = canvasElement.querySelector(".markdown th")!;
    await expect(styleOf(th).fontFamily).toContain(MONO);
    await expect(styleOf(th).textTransform).toBe("uppercase");
    // Sender name: 13px / 700 Instrument Sans
    const pill = canvasElement.querySelector(".author-name.identity-name-pill")!;
    await expect(styleOf(pill).fontSize).toBe("13px");
    await expect(styleOf(pill).fontWeight).toBe("700");
    await expect(styleOf(pill).fontFamily).toContain(SANS);
    // Timestamp: 9.5px mono
    const time = canvasElement.querySelector(".message-time")!;
    await expect(styleOf(time).fontSize).toBe("9.5px");
    await expect(styleOf(time).fontFamily).toContain(MONO);

    // Code block palette stays theme-paired (light hljs vs dark hljs).
    const root = canvasElement.ownerDocument.documentElement;
    const highlightedCode = canvasElement.querySelector<HTMLElement>(".markdown pre code.hljs");
    await expect(highlightedCode).toBeTruthy();
    const originalTheme = root.getAttribute("data-theme");
    const stylesFor = (theme: "sigil-light" | "sigil-dark") => {
      root.setAttribute("data-theme", theme);
      return {
        background: styleOf(canvasElement.querySelector(".markdown pre")!).backgroundColor,
        foreground: styleOf(highlightedCode!).color,
      };
    };
    try {
      const light = stylesFor("sigil-light");
      const dark = stylesFor("sigil-dark");
      await expect(light.background).not.toBe(dark.background);
      await expect(light.foreground).not.toBe(dark.foreground);
      await expect(light.background).toBe("rgb(242, 242, 241)");
      await expect(light.foreground).toBe("rgb(29, 30, 32)");
    } finally {
      if (originalTheme) root.setAttribute("data-theme", originalTheme);
      else root.removeAttribute("data-theme");
    }
  },
};

export const Activity: Story = {
  render: () => (
    <section style={{ background: "var(--paper)", color: "var(--ink)", height: 780, minWidth: 760, overflow: "hidden", width: 1080 }}>
      <ActivityView onJumpToRoom={() => {}} onOpenDm={() => {}} threadWidth={420} onThreadWidth={() => {}} />
    </section>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".activity-view")).toBeTruthy();
    // Group header name: 14px / 700 Instrument Sans
    const roomName = canvasElement.querySelector(".act-room-name")!;
    await expect(styleOf(roomName).fontSize).toBe("14px");
    await expect(styleOf(roomName).fontWeight).toBe("700");
    await expect(styleOf(roomName).fontFamily).toContain(SANS);
    // "N AWAITING": 9.5px mono 700
    const awaiting = canvasElement.querySelector(".act-room-await")!;
    await expect(styleOf(awaiting).fontSize).toBe("9.5px");
    await expect(styleOf(awaiting).fontFamily).toContain(MONO);
    // Item author: 12.5px / 700 sans; timestamps 9.5px mono
    const agentPill = canvasElement.querySelector(".author-chip.xs")!;
    await expect(styleOf(agentPill).fontSize).toBe("12.5px");
    await expect(styleOf(agentPill).fontWeight).toBe("700");
    await expect(styleOf(agentPill).fontFamily).toContain(SANS);
    const time = canvasElement.querySelector(".act-time")!;
    await expect(styleOf(time).fontSize).toBe("9.5px");
    await expect(styleOf(time).fontFamily).toContain(MONO);
    // Active top-bar tab: 12px / 600 Instrument Sans
    const activeTab = canvasElement.querySelector('.tab-group [role="tab"][aria-selected="true"]')!;
    await expect(styleOf(activeTab).fontSize).toBe("12px");
    await expect(styleOf(activeTab).fontWeight).toBe("600");
    await expect(styleOf(activeTab).fontFamily).toContain(SANS);
  },
};

function ChatWindowFrame() {
  const [threadOpen, setThreadOpen] = useState(true);
  const [threadParentId, setThreadParentId] = useState<string | null>(chatPreviewThreadParentId);
  const showThread = threadOpen && Boolean(threadParentId);

  useEffect(() => {
    setThreadParentId(threadOpen ? chatPreviewThreadParentId : null);
  }, [threadOpen]);

  return (
    <section style={{ background: "var(--paper)", color: "var(--ink)", minWidth: 920, width: 1120 }}>
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

export const ChatWindow: Story = {
  parameters: {
    layout: "centered",
    viewport: { defaultViewport: "desktop" },
  },
  render: () => <ChatWindowFrame />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".chat-list")).toBeTruthy();
    await expect(canvasElement.querySelector(".thread-pane")).toBeTruthy();

    // Sender pills use the same fixed type in chat and thread contexts.
    const chatAgentPill = canvasElement.querySelector(".chat-list .identity-name-pill")!;
    const threadAgentPill = canvasElement.querySelector(".thread-pane .identity-name-pill")!;
    await expect(chatAgentPill).toBeTruthy();
    await expect(threadAgentPill).toBeTruthy();
    await expect(styleOf(threadAgentPill).fontFamily).toBe(styleOf(chatAgentPill).fontFamily);
    await expect(styleOf(threadAgentPill).fontSize).toBe(styleOf(chatAgentPill).fontSize);
    await expect(styleOf(threadAgentPill).fontWeight).toBe(styleOf(chatAgentPill).fontWeight);
    await expect(styleOf(chatAgentPill).fontFamily).toContain(SANS);

    // Message body 13.5 sans; avatar glyph Instrument Sans 700.
    const bubble = canvasElement.querySelector(".chat-list .bubble")!;
    await expect(styleOf(bubble).fontSize).toBe("13.5px");
    await expect(styleOf(bubble).fontFamily).toContain(SANS);
    const avatar = canvasElement.querySelector(".identity-icon")!;
    await expect(styleOf(avatar).fontFamily).toContain(SANS);
    await expect(styleOf(avatar).fontWeight).toBe("700");

    // Harness kicker: 8.5px mono uppercase; timestamp 9.5px mono.
    const kicker = canvasElement.querySelector(".author-harness");
    if (kicker) {
      await expect(styleOf(kicker).fontSize).toBe("8.5px");
      await expect(styleOf(kicker).fontFamily).toContain(MONO);
      await expect(styleOf(kicker).textTransform).toBe("uppercase");
    }
    const time = canvasElement.querySelector(".message-time")!;
    await expect(styleOf(time).fontSize).toBe("9.5px");
    await expect(styleOf(time).fontFamily).toContain(MONO);

    // Main and Thread composers keep equal height and bottom alignment.
    const chatComposer = canvasElement.querySelector<HTMLElement>(".chat-col > .composer")!;
    const threadComposer = canvasElement.querySelector<HTMLElement>(".thread-pane > .composer")!;
    const chatComposerRect = chatComposer.getBoundingClientRect();
    const threadComposerRect = threadComposer.getBoundingClientRect();
    await expect(Math.abs(chatComposerRect.bottom - threadComposerRect.bottom)).toBeLessThanOrEqual(1);
    await expect(Math.abs(chatComposerRect.height - threadComposerRect.height)).toBeLessThanOrEqual(1);
    for (const composer of [chatComposer, threadComposer]) {
      const style = getComputedStyle(composer);
      await expect(style.borderBottomLeftRadius).toBe("0px");
      await expect(style.borderBottomRightRadius).toBe("0px");
    }

    // Composer send button: 11px mono 700 (reference send grammar).
    const send = canvasElement.querySelector(".composer-send")!;
    await expect(styleOf(send).fontSize).toBe("11px");
    await expect(styleOf(send).fontFamily).toContain(MONO);
    await expect(styleOf(send).fontWeight).toBe("700");
  },
};
