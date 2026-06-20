import { expect, test } from "@playwright/test";
import { screenshotPath } from "../core/artifacts.mjs";
import { collectConsoleProblems } from "../core/console.mjs";
import { groupWithTopThreads, loadStateFromEnv, topThreadRoots } from "../core/real-data.mjs";
import {
  closeThread,
  demoPause,
  openActivity,
  openGroupChat,
  openThreadFromChat,
  scrollThreadToBottom,
} from "../drivers/playwright-actions.mjs";

const state = loadStateFromEnv();

test("flow chat.top-thread-traversal.scroll-bottom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "contract flow currently targets the desktop chat/thread split layout");

  const consoleProblems = collectConsoleProblems(page);
  const group = groupWithTopThreads(state);
  expect(group, "real data should include a group with at least two top-five thread roots").toBeTruthy();
  const targets = topThreadRoots(state, group!.group_id).slice(0, 5);
  expect(targets.length, "top-five candidate set should include at least two threads").toBeGreaterThanOrEqual(2);

  await page.goto("/web");
  await expect(page.locator(".app-shell")).toBeVisible();
  await openActivity(page);
  await demoPause(page, "activity-open");
  await openGroupChat(page, group!.name);
  await demoPause(page, "chat-open");

  const opened: number[] = [];
  for (const target of targets) {
    if (opened.length >= 2) break;
    const openedThread = await openThreadFromChat(page, target);
    if (!openedThread) continue;
    opened.push(target.event_id);

    const thread = page.locator(".thread-pane");
    await expect(thread).toBeVisible();
    await demoPause(page, `thread-${target.event_id}-open`);
    const scrollMetrics = await scrollThreadToBottom(thread);
    expect(scrollMetrics.atBottom, `thread ${target.event_id} should scroll to bottom`).toBe(true);
    await expect(thread.locator(".composer")).toBeVisible();
    await page.screenshot({ path: screenshotPath(`${testInfo.project.name}-chat-thread-${opened.length}.png`), fullPage: true });
    await demoPause(page, `thread-${target.event_id}-bottom`);
    await closeThread(page);
  }

  expect(opened, `expected to open two different threads from top-five candidates ${targets.map((target) => target.event_id).join(", ")}`).toHaveLength(2);
  expect(new Set(opened).size, "opened thread ids should be distinct").toBe(2);
  expect(consoleProblems).toEqual([]);
});
