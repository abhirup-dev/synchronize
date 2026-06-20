import { expect, test } from "@playwright/test";
import { screenshotPath } from "../core/artifacts.mjs";
import { collectConsoleProblems } from "../core/console.mjs";
import { loadStateFromEnv } from "../core/real-data.mjs";
import { openActivity } from "../drivers/playwright-actions.mjs";

const state = loadStateFromEnv();

test("real-data activity shell renders without console errors", async ({ page }, testInfo) => {
  const consoleProblems = collectConsoleProblems(page);

  await page.goto("/web");
  await expect(page).toHaveTitle(/Synchronize/);
  await expect(page.locator(".app-shell")).toBeVisible();

  if (testInfo.project.name === "compact") {
    await page.screenshot({ path: screenshotPath(`${testInfo.project.name}-activity.png`), fullPage: true });
    expect(consoleProblems).toEqual([]);
    return;
  }

  await openActivity(page);

  await expect(page.getByText("ACTIVITY", { exact: true })).toBeVisible();
  expect(state.events.length, "real snapshot should include events").toBeGreaterThan(0);
  expect(state.groups.length, "real snapshot should include groups").toBeGreaterThan(0);

  const groupNames = state.groups.map((group) => group.name).filter(Boolean).slice(0, 8);
  let visibleGroups = 0;
  for (const name of groupNames) {
    if (await page.getByText(`#${name}`, { exact: false }).count()) visibleGroups += 1;
  }
  expect(visibleGroups, `expected at least one real group visible from ${groupNames.join(", ")}`).toBeGreaterThan(0);

  await page.screenshot({ path: screenshotPath(`${testInfo.project.name}-activity.png`), fullPage: true });
  expect(consoleProblems).toEqual([]);
});

test("real-data UI has enough volume for probe confidence", async ({ page }, testInfo) => {
  await page.goto("/web");
  await expect(page.locator(".app-shell")).toBeVisible();

  const buttons = await page.locator("button").count();
  const text = await page.locator(".app-shell").innerText();

  expect(buttons, "real UI should expose a non-trivial interaction surface").toBeGreaterThan(5);
  expect(text.length, "real UI should render non-trivial text volume").toBeGreaterThan(100);

  await page.screenshot({ path: screenshotPath(`${testInfo.project.name}-shell.png`), fullPage: true });
});
