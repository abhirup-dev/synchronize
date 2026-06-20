import { expect, test } from "@playwright/test";
import { screenshotPath } from "../core/artifacts.mjs";
import { collectConsoleProblems } from "../core/console.mjs";
import { activityThreadWithReaction, loadStateFromEnv, snippet } from "../core/real-data.mjs";
import { openActivity, scrollThreadToBottom } from "../drivers/playwright-actions.mjs";

const state = loadStateFromEnv();

test("flow activity.thread-row.open-scroll-emoji", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "contract flow currently targets the desktop Activity split-pane layout");

  const consoleProblems = collectConsoleProblems(page);
  const target = activityThreadWithReaction(state);
  expect(target, "real data should include a threaded event with reactions").toBeTruthy();

  const expectedEmoji = target!.reactions[0]!.emoji;
  const needle = snippet(target!.body!);

  await page.goto("/web");
  await expect(page.locator(".app-shell")).toBeVisible();
  await openActivity(page);

  const row = page.locator(".act-row").filter({ hasText: needle }).first();
  await expect(row, `expected an Activity row containing ${JSON.stringify(needle)}`).toBeVisible();
  await row.click();

  const thread = page.locator(".thread-pane");
  await expect(thread).toBeVisible();
  const scrollMetrics = await scrollThreadToBottom(thread);
  expect(scrollMetrics.atBottom, `activity thread ${target!.event_id} should scroll to bottom`).toBe(true);
  await expect(thread.locator(".composer")).toBeVisible();

  const reaction = thread.locator("button[aria-label*='reaction from']").filter({ hasText: expectedEmoji }).first();
  await expect(reaction, `expected reaction emoji ${expectedEmoji} to render in the opened thread`).toBeVisible();
  const text = await reaction.innerText();
  const label = await reaction.getAttribute("aria-label");
  expect(text).toContain(expectedEmoji);
  expect(label ?? "").toContain(expectedEmoji);
  expect(text).not.toContain("\uFFFD");
  expect(text).not.toContain("□");

  await page.screenshot({ path: screenshotPath(`${testInfo.project.name}-activity-thread-emoji.png`), fullPage: true });
  expect(consoleProblems).toEqual([]);
});
