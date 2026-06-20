import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect, waitFor } from "storybook/test";
import { Shell } from "../App.tsx";

// Cross-component workflow sample (extensible). Mounts the REAL app shell and
// drives a multi-step journey through the actual navigation glue — not a single
// isolated component. This is the template to copy for further flows.
//
// The flow opens a long thread (THREAD_REPLIES["ml-deepdive"], 14 replies) whose
// last reply is NOT authored by "you", so ThreadPane opens at the TOP — which
// makes "scroll to the bottom" a real, assertable action (the latest reply is
// virtualized off-screen until we scroll to it).
//
// Boundary: runs against MockDataSource in a real browser (Playwright Chromium
// via the Vitest addon), NOT the live daemon/SSE/routing. Full-app E2E against
// the running /web belongs to the real-data UI probe pipeline (sync-rycd).
const meta = {
  title: "Flows/Activity to Thread",
  component: Shell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PlayCtx = Parameters<NonNullable<Story["play"]>>[0];

// Shared flow. `pauseMs > 0` + `smooth` is "demo mode" — visible pacing and
// animated scroll for watching in the Interactions panel; the real test runs
// with 0/instant for speed and determinism.
async function activityToThread(
  { canvasElement, step }: PlayCtx,
  { pauseMs = 0, smooth = false }: { pauseMs?: number; smooth?: boolean } = {},
) {
  const pause = () => (pauseMs ? sleep(pauseMs) : Promise.resolve());
  const canvas = within(canvasElement);

  await step("Open the Activity view from the sidebar", async () => {
    await pause();
    await userEvent.click(canvas.getByTitle(/activity/i));
    await waitFor(() => expect(canvasElement.querySelector(".act-scroll")).toBeTruthy());
  });

  await step("Click the deep-dive activity row to open its thread", async () => {
    await pause();
    expect(canvasElement.querySelector(".thread-pane")).toBeNull();
    const row = await waitFor(() => {
      const match = [...canvasElement.querySelectorAll<HTMLElement>(".act-scroll .act-row")].find(
        (el) => /rollout checklist deep-dive/i.test(el.textContent ?? ""),
      );
      if (!match) throw new Error("deep-dive activity row not found");
      return match;
    });
    row.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    await pause();
    await userEvent.click(row);
  });

  await step("Thread opens at the top (latest reply still off-screen)", async () => {
    const pane = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".thread-pane");
      if (!el) throw new Error("thread pane did not open");
      return el;
    });
    const inPane = within(pane);
    await expect(inPane.getByText(/rollout checklist deep-dive/i)).toBeInTheDocument();
    const body = pane.querySelector<HTMLElement>(".thread-pane-body")!;
    expect(body).toBeTruthy();
    await waitFor(() => expect(body.scrollHeight).toBeGreaterThan(body.clientHeight));
    expect(inPane.queryByText(/checklist fully cleared/i)).toBeNull();
    await pause();
  });

  await step("Scroll to the bottom — the latest reply becomes visible", async () => {
    const pane = document.querySelector<HTMLElement>(".thread-pane")!;
    const body = pane.querySelector<HTMLElement>(".thread-pane-body")!;
    const inPane = within(pane);
    expect(body.scrollTop).toBe(0); // opened at the top
    if (smooth) body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    else body.scrollTop = body.scrollHeight;
    await waitFor(() => expect(inPane.getByText(/checklist fully cleared/i)).toBeVisible());
    expect(body.scrollTop).toBeGreaterThan(0); // genuinely moved
    await pause();
  });
}

// The real test: fast, instant, deterministic. Runs in `test:storybook` / CI.
export const OpenThreadFromActivity: Story = {
  play: async (ctx) => activityToThread(ctx),
};

// Demo: same flow, paced with pauses + smooth scroll so it's watchable in real
// time in the Interactions panel. Tagged `!test` so it is excluded from the
// test run (no CI slowdown, no flake) — it exists purely for visual demos.
export const OpenThreadFromActivityDemo: Story = {
  tags: ["!test"],
  play: async (ctx) => activityToThread(ctx, { pauseMs: 900, smooth: true }),
};
