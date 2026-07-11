import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, screen, userEvent, waitFor, within } from "storybook/test";
import { Shell } from "../App.tsx";

const meta = {
  title: "Flows/Synchronize UI",
  component: Shell,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Cross-component Synchronize UI contracts. These mount the real Shell against MockDataSource and encode complex workflows as Storybook interaction tests.",
      },
    },
  },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayCtx = Parameters<NonNullable<Story["play"]>>[0];
type FlowOptions = { pauseMs?: number; smooth?: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function pauseFor({ pauseMs = 0 }: FlowOptions) {
  return () => (pauseMs ? sleep(pauseMs) : Promise.resolve());
}

function requireElement<T extends Element>(root: ParentNode, selector: string, label: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`${label} not found (${selector})`);
  return el;
}

function roomButton(canvasElement: HTMLElement, roomId: string): HTMLElement {
  return requireElement<HTMLElement>(canvasElement, `[data-vim-item="room-${roomId}"]`, `room ${roomId}`);
}

function messageRow(messageId: string): HTMLElement {
  return requireElement<HTMLElement>(document, `#msg-${messageId}`, `message ${messageId}`);
}

async function threadPane(): Promise<HTMLElement> {
  return waitFor(() => requireElement<HTMLElement>(document, ".thread-pane", "thread pane"));
}

function expectInsideScrollport(container: HTMLElement, target: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  expect(targetRect.bottom).toBeLessThanOrEqual(containerRect.bottom + 2);
  expect(targetRect.top).toBeGreaterThanOrEqual(containerRect.top - 2);
}

async function scrollThreadToBottom(pane: HTMLElement, latestReplyId: string, { smooth = false }: FlowOptions) {
  const body = requireElement<HTMLElement>(pane, ".thread-pane-body", "thread pane body");
  const scrollBehavior: ScrollBehavior = smooth ? "smooth" : "auto";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    body.scrollTo({ top: body.scrollHeight, behavior: scrollBehavior });
    await nextFrame();
    const latestReply = pane.querySelector<HTMLElement>(`#msg-${latestReplyId}`);
    if (latestReply) {
      latestReply.scrollIntoView({ block: "end", behavior: scrollBehavior });
      await nextFrame();
    }
  }
  await waitFor(() => {
    const latestReply = requireElement<HTMLElement>(pane, `#msg-${latestReplyId}`, `latest reply ${latestReplyId}`);
    const distanceFromBottom = body.scrollHeight - body.clientHeight - body.scrollTop;
    if (distanceFromBottom > 2) {
      body.scrollTo({ top: body.scrollHeight, behavior: "auto" });
    }
    expect(distanceFromBottom).toBeLessThanOrEqual(2);
    expectInsideScrollport(body, latestReply);
  });
}

async function openActivity(ctx: PlayCtx, options: FlowOptions = {}) {
  const pause = pauseFor(options);
  const canvas = within(ctx.canvasElement);
  await ctx.step("Open the Activity view from the sidebar", async () => {
    await pause();
    await userEvent.click(canvas.getByTitle(/activity/i));
    await waitFor(() => expect(ctx.canvasElement.querySelector(".act-scroll")).toBeTruthy());
  });
}

async function activityThreadScrollAndEmoji(ctx: PlayCtx, options: FlowOptions = {}) {
  const pause = pauseFor(options);
  await openActivity(ctx, options);

  await ctx.step("Click the deep-dive activity row to open its thread", async () => {
    await pause();
    expect(ctx.canvasElement.querySelector(".thread-pane")).toBeNull();
    const row = await waitFor(() => {
      const match = [...ctx.canvasElement.querySelectorAll<HTMLElement>(".act-scroll .act-row")].find((el) =>
        /ramp to 50%/i.test(el.textContent ?? ""),
      );
      if (!match) throw new Error("deep-dive activity row not found");
      return match;
    });
    row.scrollIntoView({ block: "center", behavior: options.smooth ? "smooth" : "auto" });
    await pause();
    await userEvent.click(row);
  });

  await ctx.step("Thread opens with scrollable reply history", async () => {
    const pane = await threadPane();
    const inPane = within(pane);
    await expect(inPane.getByText(/rollout checklist deep-dive/i)).toBeInTheDocument();
    const body = requireElement<HTMLElement>(pane, ".thread-pane-body", "thread pane body");
    await waitFor(() => expect(body.scrollHeight).toBeGreaterThan(body.clientHeight));
    await pause();
  });

  await ctx.step("Scroll to the bottom and verify the latest reply", async () => {
    const pane = await threadPane();
    await scrollThreadToBottom(pane, "mld-r14", options);
    await expect(within(pane).getByText(/checklist fully cleared/i)).toBeVisible();
    await pause();
  });

  await ctx.step("Verify emoji glyphs render in reactions and message text", async () => {
    const pane = await threadPane();
    const reaction = within(pane).getByRole("button", { name: /🚀 reaction from You, Vega/i });
    await expect(reaction).toBeVisible();
    await expect(reaction).toHaveTextContent("🚀");
    await pause();
  });
}

async function openThreadFromMessage(messageId: string, latestReplyId: string, latestReply: RegExp, options: FlowOptions = {}) {
  const pause = pauseFor(options);
  const row = messageRow(messageId);
  row.scrollIntoView({ block: "center", behavior: options.smooth ? "smooth" : "auto" });
  await pause();
  const badge = requireElement<HTMLButtonElement>(row, ".thread-badge", `thread badge for ${messageId}`);
  await userEvent.click(badge);
  const pane = await threadPane();
  await scrollThreadToBottom(pane, latestReplyId, options);
  const latestReplyRow = requireElement<HTMLElement>(pane, `#msg-${latestReplyId}`, `latest reply ${latestReplyId}`);
  const body = requireElement<HTMLElement>(pane, ".thread-pane-body", "thread pane body");
  expectInsideScrollport(body, latestReplyRow);
  expect(latestReplyRow.textContent).toMatch(latestReply);
  await expect(requireElement<HTMLElement>(pane, ".composer", "thread composer")).toBeVisible();
}

async function chatTopThreadTraversal(ctx: PlayCtx, options: FlowOptions = {}) {
  const pause = pauseFor(options);
  await openActivity(ctx, options);

  await ctx.step("Navigate from Activity into #checkout-revamp", async () => {
    await pause();
    await userEvent.click(roomButton(ctx.canvasElement, "checkout-revamp"));
    await waitFor(() => {
      expect(ctx.canvasElement.querySelector(".chat-view")).toBeTruthy();
      expect(ctx.canvasElement.querySelector(".room-header")?.textContent).toContain("checkout-revamp");
    });
  });

  await ctx.step("Open the first qualifying top-five thread and scroll it to bottom", async () => {
    await openThreadFromMessage("m2", "m2-r2", /coupon_id path/i, options);
    await pause();
  });

  await ctx.step("Close the first thread", async () => {
    await userEvent.click(screen.getByRole("button", { name: "close thread" }));
    await waitFor(() => expect(document.querySelector(".thread-pane")).toBeNull());
    await pause();
  });

  await ctx.step("Open a second qualifying top-five thread and scroll it to bottom", async () => {
    await openThreadFromMessage("m5", "m5-r2", /row-count once it lands/i, options);
    await pause();
  });
}

async function spawnAgentEntrypoint(ctx: PlayCtx, options: FlowOptions = {}) {
  const pause = pauseFor(options);
  const checkoutRoom = roomButton(ctx.canvasElement, "checkout-revamp");

  await ctx.step("Open the group room context menu", async () => {
    await pause();
    fireEvent.contextMenu(checkoutRoom, { clientX: 180, clientY: 160 });
    await expect(await screen.findByText("Spawn agent...")).toBeVisible();
  });

  await ctx.step("Choose Spawn agent and verify the real dialog opens", async () => {
    await pause();
    await userEvent.click(screen.getByText("Spawn agent..."));
    await expect(await screen.findByRole("heading", { name: /Spawn into #checkout-revamp/i })).toBeVisible();
    await expect(screen.getByLabelText("Name")).toHaveValue("pi-checkout");
    await expect(screen.getByRole("button", { name: "Spawn" })).toBeVisible();
  });

  await ctx.step("Close without mutating state", async () => {
    await pause();
    await userEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Spawn agent/i })).toBeNull());
  });
}

export const ActivityThreadScrollAndEmoji: Story = {
  parameters: {
    synchronizeFlow: {
      id: "flows.activity-thread-scroll-emoji",
      tier: "contract",
      determinism: "deterministic",
      components: ["app-shell", "activity-view", "activity-row", "thread-pane", "message-row", "composer"],
      data: "MockDataSource seed",
    },
  },
  play: async (ctx) => activityThreadScrollAndEmoji(ctx),
};

const activityThreadScrollAndEmojiParameters = ActivityThreadScrollAndEmoji.parameters!;

export const ActivityThreadScrollAndEmojiDemo: Story = {
  tags: ["!test"],
  parameters: activityThreadScrollAndEmojiParameters,
  play: async (ctx) => activityThreadScrollAndEmoji(ctx, { pauseMs: 900, smooth: true }),
};

export const ChatTopThreadTraversal: Story = {
  parameters: {
    synchronizeFlow: {
      id: "flows.chat-top-thread-traversal",
      tier: "contract",
      determinism: "deterministic",
      components: ["app-shell", "activity-view", "chat-view", "message-row", "thread-pane", "composer"],
      data: "MockDataSource seed",
    },
  },
  play: async (ctx) => chatTopThreadTraversal(ctx),
};

const chatTopThreadTraversalParameters = ChatTopThreadTraversal.parameters!;

export const ChatTopThreadTraversalDemo: Story = {
  tags: ["!test"],
  parameters: chatTopThreadTraversalParameters,
  play: async (ctx) => chatTopThreadTraversal(ctx, { pauseMs: 900, smooth: true }),
};

export const SpawnAgentEntrypoint: Story = {
  parameters: {
    synchronizeFlow: {
      id: "flows.agent-spawn-entrypoint",
      tier: "contract",
      determinism: "deterministic",
      components: ["app-shell", "agent-roster", "spawn-agent-dialog"],
      data: "MockDataSource seed",
    },
  },
  play: async (ctx) => spawnAgentEntrypoint(ctx),
};

const spawnAgentEntrypointParameters = SpawnAgentEntrypoint.parameters!;

export const SpawnAgentEntrypointDemo: Story = {
  tags: ["!test"],
  parameters: spawnAgentEntrypointParameters,
  play: async (ctx) => spawnAgentEntrypoint(ctx, { pauseMs: 900 }),
};

// Compact (Android) chrome end-to-end: the bottom nav opens the Chats overlay
// (CompactAppBar), the app bar opens the display-settings Sheet, Escape dismisses
// it, and the close button tears the overlay down. Exercises the whole compact
// navigation surface that desktop never mounts.
async function compactNavAndSettings(ctx: PlayCtx, options: FlowOptions = {}) {
  const pause = pauseFor(options);
  const canvas = within(ctx.canvasElement);

  await ctx.step("Compact shell shows the three-tab bottom nav", async () => {
    await waitFor(() => expect(ctx.canvasElement.querySelector(".bottom-nav")).toBeTruthy());
    await expect(canvas.getByRole("button", { name: "Chats" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Activity" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Agents" })).toBeVisible();
    await pause();
  });

  await ctx.step("Bottom nav → Chats opens the room-switcher overlay", async () => {
    await userEvent.click(canvas.getByRole("button", { name: "Chats" }));
    await waitFor(() => requireElement(ctx.canvasElement, '[aria-label="chats"]', "chats overlay"));
    await pause();
  });

  await ctx.step("App bar opens the display-settings sheet; Escape dismisses it", async () => {
    const overlay = requireElement<HTMLElement>(ctx.canvasElement, '[aria-label="chats"]', "chats overlay");
    await userEvent.click(within(overlay).getByRole("button", { name: "open display settings" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "display settings" })).toBeVisible());
    await pause();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "display settings" })).toBeNull());
    await pause();
  });

  await ctx.step("Close button tears the overlay down", async () => {
    const overlay = requireElement<HTMLElement>(ctx.canvasElement, '[aria-label="chats"]', "chats overlay");
    await userEvent.click(within(overlay).getByRole("button", { name: "close" }));
    await waitFor(() => expect(ctx.canvasElement.querySelector('[aria-label="chats"]')).toBeNull());
  });
}

export const CompactNavAndSettings: Story = {
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  parameters: {
    synchronizeFlow: {
      id: "flows.compact-nav-and-settings",
      tier: "contract",
      determinism: "deterministic",
      components: ["app-shell", "bottom-nav", "compact-app-bar", "sheet", "sidebar"],
      data: "MockDataSource seed",
    },
  },
  play: async (ctx) => compactNavAndSettings(ctx),
};

export const CompactNavAndSettingsDemo: Story = {
  tags: ["!test"],
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  parameters: CompactNavAndSettings.parameters!,
  play: async (ctx) => compactNavAndSettings(ctx, { pauseMs: 900 }),
};
