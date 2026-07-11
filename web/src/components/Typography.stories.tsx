import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor } from "storybook/test";
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
    avatarFont: "Archivo Black",
    codeFont: "JetBrains Mono",
    width: 700,
  },
  argTypes: typographyArgTypes,
  parameters: { layout: "centered" },
} satisfies Meta<FontPreviewArgs>;

export default meta;
type Story = StoryObj<FontPreviewArgs>;

const configuredFontFamilies = ["Avenir Next", "Space Grotesk", "Archivo Black", "Archivo Black", "JetBrains Mono"];

function expectConfiguredFontPickers(canvasElement: HTMLElement) {
  const values = [...canvasElement.querySelectorAll<HTMLSelectElement>('[data-testid="font-control-grid"] select')].map((select) => select.value);
  return expect(values).toEqual(configuredFontFamilies);
}

async function expectConfiguredTuning(canvasElement: HTMLElement) {
  const sizes = [...canvasElement.querySelectorAll<HTMLInputElement>('[data-testid="font-control-grid"] input[aria-label^="size"]')].map((input) => Number(input.value));
  await expect(sizes).toEqual([1, 1, 1.1, 1.35, 1]);
  await expect(canvasElement.querySelector('[data-freeze-configuration]')).toBeTruthy();
}

function PreviewFrame({
  bodyFont,
  headingFont,
  displayFont,
  avatarFont,
  codeFont,
  width,
}: {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  avatarFont: string;
  codeFont: string;
  width: number;
}) {
  return (
    <section
      style={{
        ...fontVars(bodyFont, headingFont, displayFont, avatarFont, codeFont),
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
            heading: {headingFont} · display: {displayFont} · avatar: {avatarFont} · code: {codeFont}
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
  avatarFont,
  codeFont,
  width,
}: {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  avatarFont: string;
  codeFont: string;
  width: number;
}) {
  return (
    <section
      style={{
        ...fontVars(bodyFont, headingFont, displayFont, avatarFont, codeFont),
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
  avatarFont,
  codeFont,
  width,
}: {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  avatarFont: string;
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
        ...fontVars(bodyFont, headingFont, displayFont, avatarFont, codeFont),
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
  render: ({ bodyFont, headingFont, displayFont, avatarFont, codeFont, width }) => (
    <FontSwitchChrome bodyFont={bodyFont} headingFont={headingFont} displayFont={displayFont} avatarFont={avatarFont} codeFont={codeFont} width={width} sourceStoryId="design-typography--rich-markdown-font-switch">
      {(selection) => <PreviewFrame {...selection} />}
    </FontSwitchChrome>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".markdown.rich-markdown")).toBeTruthy();
    await expect(canvasElement.querySelectorAll("select")).toHaveLength(5);
    await expect(canvasElement.querySelectorAll('input[type="range"]')).toHaveLength(10);
    const weightPickers = canvasElement.querySelectorAll<HTMLElement>("[data-font-weight-picker]");
    await expect(weightPickers).toHaveLength(5);
    await expect([...weightPickers[1]!.querySelectorAll("[data-weight-option]")].map((option) => option.textContent)).toEqual(["400", "500", "600", "700"]);
    await expect([...weightPickers[2]!.querySelectorAll("[data-weight-option]")].map((option) => option.textContent)).toEqual(["400"]);
    await expect(weightPickers[2]!.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    await expect([...weightPickers[4]!.querySelectorAll("[data-weight-option]")].map((option) => option.textContent)).toEqual(["400", "500", "700"]);
    await expect(canvasElement.querySelectorAll('[aria-label$="font preview"]')).toHaveLength(5);
    await expectConfiguredFontPickers(canvasElement);
    await expectConfiguredTuning(canvasElement);
    await expect(canvasElement.querySelector("[data-config-source]")?.getAttribute("data-config-source")).toContain("design-typography--");
    const optionCounts = [...canvasElement.querySelectorAll("select")].map((select) => select.options.length);
    await expect(new Set(optionCounts).size).toBe(1);
    const controlGrid = canvasElement.querySelector<HTMLElement>('[data-testid="font-control-grid"]')!;
    controlGrid.style.width = "320px";
    await expect([...controlGrid.children].every((card) => card.scrollWidth <= card.clientWidth)).toBe(true);
    controlGrid.style.width = "100%";

    const root = canvasElement.ownerDocument.documentElement;
    const codeBlock = canvasElement.querySelector<HTMLElement>(".markdown pre");
    const highlightedCode = canvasElement.querySelector<HTMLElement>(".markdown pre code.hljs");
    await expect(codeBlock).toBeTruthy();
    await expect(highlightedCode).toBeTruthy();

    const originalTheme = root.getAttribute("data-theme");
    const stylesFor = (theme: "light" | "kanagawa-wave") => {
      root.setAttribute("data-theme", theme);
      return {
        background: getComputedStyle(codeBlock!).backgroundColor,
        foreground: getComputedStyle(highlightedCode!).color,
      };
    };

    try {
      const light = stylesFor("light");
      const dark = stylesFor("kanagawa-wave");
      await expect(light.background).not.toBe(dark.background);
      await expect(light.foreground).not.toBe(dark.foreground);
      await expect(light.background).toBe("rgb(244, 246, 248)");
      await expect(light.foreground).toBe("rgb(15, 20, 25)");
    } finally {
      if (originalTheme) root.setAttribute("data-theme", originalTheme);
      else root.removeAttribute("data-theme");
    }
  },
};

export const ActivityFontSwitch: Story = {
  args: { width: 1080 },
  parameters: { layout: "centered" },
  render: ({ bodyFont, headingFont, displayFont, avatarFont, codeFont, width }) => (
    <FontSwitchChrome bodyFont={bodyFont} headingFont={headingFont} displayFont={displayFont} avatarFont={avatarFont} codeFont={codeFont} width={width} maxWidth={1160} sourceStoryId="design-typography--activity-font-switch">
      {(selection) => <ActivityPreviewFrame {...selection} />}
    </FontSwitchChrome>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".activity-view")).toBeTruthy();
    await expect(canvasElement.querySelectorAll("select")).toHaveLength(5);
    await expect(canvasElement.querySelectorAll('input[type="range"]')).toHaveLength(10);
    await expect(canvasElement.querySelectorAll('[aria-label$="font preview"]')).toHaveLength(5);
    await expectConfiguredFontPickers(canvasElement);
    await expectConfiguredTuning(canvasElement);
    await expect(canvasElement.querySelector('[data-copy-changed]')).toBeFalsy();
    const displaySelect = canvasElement.querySelectorAll("select")[2]!;
    const roomName = canvasElement.querySelector<HTMLElement>(".act-room-name")!;
    const awaiting = canvasElement.querySelector<HTMLElement>(".act-room-await")!;
    const originalDisplayFont = displaySelect.value;
    try {
      await userEvent.selectOptions(displaySelect, "Space Grotesk");
      await waitFor(() => expect(getComputedStyle(roomName).fontFamily).toContain("Space Grotesk"));
      await expect(getComputedStyle(awaiting).fontFamily).toBe(getComputedStyle(roomName).fontFamily);
      const displayWeightPicker = canvasElement.querySelectorAll<HTMLElement>("[data-font-weight-picker]")[2]!;
      const displayWeight = displayWeightPicker.querySelector<HTMLInputElement>('input[type="range"]')!;
      const displaySize = displayWeightPicker.parentElement!.querySelector<HTMLInputElement>('input[aria-label^="size"]')!;
      const agentPill = canvasElement.querySelector<HTMLElement>(".author-chip.xs")!;
      const scopeAction = canvasElement.querySelector<HTMLElement>(".act-scope-ack")!;
      const openAction = canvasElement.querySelector<HTMLElement>(".act-digest-headgo")!;
      const railLabel = canvasElement.querySelector<HTMLElement>(".rail-seg.active .rail-seg-label")!;
      const roomFilter = canvasElement.querySelector<HTMLElement>(".act-room-filter-trigger")!;
      fireEvent.change(displayWeight, { target: { value: "3" } });
      fireEvent.change(displaySize, { target: { value: "1.3" } });
      await waitFor(() => expect(canvasElement.querySelector('[data-copy-changed]')).toBeTruthy());
      await waitFor(() => expect(getComputedStyle(roomName).fontWeight).toBe("700"));
      await expect(getComputedStyle(awaiting).fontWeight).toBe("700");
      await expect(getComputedStyle(roomName).fontSize).toBe("18.2px");
      await expect(getComputedStyle(awaiting).fontSize).toBe("9.1px");
      await expect(getComputedStyle(agentPill).fontFamily).toContain("Space Grotesk");
      await expect(getComputedStyle(agentPill).fontWeight).toBe("700");
      await expect(getComputedStyle(agentPill).fontSize).toBe("11.83px");
      const buttonStyle = getComputedStyle(scopeAction);
      await expect(buttonStyle.fontFamily).toContain("Space Grotesk");
      await expect(buttonStyle.fontSize).toBe("13.65px");
      await expect(buttonStyle.fontWeight).toBe("400");
      for (const control of [openAction, railLabel, roomFilter]) {
        const controlStyle = getComputedStyle(control);
        await expect(controlStyle.fontFamily).toBe(buttonStyle.fontFamily);
        await expect(controlStyle.fontSize).toBe(buttonStyle.fontSize);
        await expect(controlStyle.fontWeight).toBe(buttonStyle.fontWeight);
      }
      await expect(buttonStyle.fontSize).not.toBe(getComputedStyle(agentPill).fontSize);
    } finally {
      await userEvent.selectOptions(displaySelect, originalDisplayFont);
      await waitFor(() => expect(displaySelect.value).toBe(originalDisplayFont));
    }
  },
};

export const ChatWindowFontSwitch: Story = {
  args: { width: 1120 },
  parameters: {
    layout: "centered",
    viewport: { defaultViewport: "desktop" },
  },
  render: ({ bodyFont, headingFont, displayFont, avatarFont, codeFont, width }) => (
    <FontSwitchChrome bodyFont={bodyFont} headingFont={headingFont} displayFont={displayFont} avatarFont={avatarFont} codeFont={codeFont} width={width} maxWidth={1180} sourceStoryId="design-typography--chat-window-font-switch">
      {(selection) => <ChatPreviewFrame {...selection} />}
    </FontSwitchChrome>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".chat-list")).toBeTruthy();
    await expect(canvasElement.querySelector(".thread-pane")).toBeTruthy();
    await expect(canvasElement.querySelectorAll("select")).toHaveLength(5);
    await expect(canvasElement.querySelectorAll('input[type="range"]')).toHaveLength(10);
    await expect(canvasElement.querySelectorAll('[aria-label$="font preview"]')).toHaveLength(5);
    await expectConfiguredFontPickers(canvasElement);
    await expectConfiguredTuning(canvasElement);

    const selects = canvasElement.querySelectorAll("select");
    const avatar = canvasElement.querySelector<HTMLElement>(".identity-icon");
    const bubble = canvasElement.querySelector<HTMLElement>(".bubble");
    const chatAgentPill = canvasElement.querySelector<HTMLElement>(".chat-list .identity-name-pill");
    const threadAgentPill = canvasElement.querySelector<HTMLElement>(".thread-pane .identity-name-pill");
    await expect(avatar).toBeTruthy();
    await expect(bubble).toBeTruthy();
    await expect(chatAgentPill).toBeTruthy();
    await expect(threadAgentPill).toBeTruthy();
    await expect(getComputedStyle(threadAgentPill!).fontFamily).toBe(getComputedStyle(chatAgentPill!).fontFamily);
    await expect(getComputedStyle(threadAgentPill!).fontSize).toBe(getComputedStyle(chatAgentPill!).fontSize);
    await expect(getComputedStyle(threadAgentPill!).fontWeight).toBe(getComputedStyle(chatAgentPill!).fontWeight);
    const chatComposer = canvasElement.querySelector<HTMLElement>(".chat-col > .composer")!;
    const threadComposer = canvasElement.querySelector<HTMLElement>(".thread-pane > .composer")!;
    const chatComposerRect = chatComposer.getBoundingClientRect();
    const threadComposerRect = threadComposer.getBoundingClientRect();
    await expect(Math.abs(chatComposerRect.bottom - threadComposerRect.bottom)).toBeLessThan(1);
    await expect(Math.abs(chatComposerRect.height - threadComposerRect.height)).toBeLessThan(1);
    for (const composer of [chatComposer, threadComposer]) {
      const style = getComputedStyle(composer);
      await expect(style.borderBottomLeftRadius).toBe("0px");
      await expect(style.borderBottomRightRadius).toBe("0px");
    }
    const bodyFamily = getComputedStyle(bubble!).fontFamily;
    const originalAvatarFont = selects[3]!.value;
    try {
      await userEvent.selectOptions(selects[3]!, "JetBrains Mono");
      await waitFor(() => expect(getComputedStyle(avatar!).fontFamily).toContain("JetBrains Mono"));
      await expect(getComputedStyle(bubble!).fontFamily).toBe(bodyFamily);
    } finally {
      await userEvent.selectOptions(selects[3]!, originalAvatarFont);
      await waitFor(() => expect(selects[3]!.value).toBe(originalAvatarFont));
    }
  },
};
