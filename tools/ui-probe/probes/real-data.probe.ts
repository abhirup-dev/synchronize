import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

interface WebState {
  peers: unknown[];
  groups: Array<{ group_id: number; name: string }>;
  events: Array<{
    event_id: number;
    type: string;
    group_id: number | null;
    group_name?: string;
    body: string | null;
    parent_event_id: number | null;
    reply_count: number;
    reactions: Array<{ emoji: string; by: string[] }>;
  }>;
  media: unknown[];
}

const statePath = process.env.UI_PROBE_STATE_JSON;
if (!statePath) throw new Error("UI_PROBE_STATE_JSON is required");

const artifactDir = process.env.UI_PROBE_ARTIFACT_DIR ?? "tools/ui-probe/artifacts/latest";
const screenshotDir = join(artifactDir, "screenshots");
mkdirSync(screenshotDir, { recursive: true });

const state = JSON.parse(readFileSync(statePath, "utf8")) as WebState;

test("flow chat.top-thread-traversal.scroll-bottom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "contract flow currently targets the desktop chat/thread split layout");

  const consoleProblems = collectConsoleProblems(page);
  const group = state.groups.find((candidate) => topThreadRoots(candidate.group_id).length >= 2);
  expect(group, "real data should include a group with at least two top-five thread roots").toBeTruthy();
  const targets = topThreadRoots(group!.group_id).slice(0, 5);
  expect(targets.length, "top-five candidate set should include at least two threads").toBeGreaterThanOrEqual(2);

  await page.goto("/web");
  await expect(page.locator(".app-shell")).toBeVisible();
  await openActivity(page);
  await openGroupChat(page, group!.name);

  const opened: number[] = [];
  for (const target of targets) {
    if (opened.length >= 2) break;
    const openedThread = await openThreadFromChat(page, target);
    if (!openedThread) continue;
    opened.push(target.event_id);

    const thread = page.locator(".thread-pane");
    await expect(thread).toBeVisible();
    const scrollMetrics = await scrollThreadToBottom(thread);
    expect(scrollMetrics.atBottom, `thread ${target.event_id} should scroll to bottom`).toBe(true);
    await expect(thread.locator(".composer")).toBeVisible();
    await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-chat-thread-${opened.length}.png`), fullPage: true });
    await closeThread(page);
  }

  expect(opened, `expected to open two different threads from top-five candidates ${targets.map((target) => target.event_id).join(", ")}`).toHaveLength(2);
  expect(new Set(opened).size, "opened thread ids should be distinct").toBe(2);
  expect(consoleProblems).toEqual([]);
});

test("flow activity.thread-row.open-scroll-emoji", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "contract flow currently targets the desktop Activity split-pane layout");

  const consoleProblems = collectConsoleProblems(page);
  const target = state.events.findLast((event) =>
    event.type === "group_message" &&
    (event.reply_count > 0 || event.parent_event_id !== null) &&
    event.reactions?.length > 0 &&
    Boolean(event.body?.trim()),
  );
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

  await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-activity-thread-emoji.png`), fullPage: true });
  expect(consoleProblems).toEqual([]);
});

test("real-data activity shell renders without console errors", async ({ page }, testInfo) => {
  const consoleProblems = collectConsoleProblems(page);

  await page.goto("/web");
  await expect(page).toHaveTitle(/Synchronize/);
  await expect(page.locator(".app-shell")).toBeVisible();

  if (testInfo.project.name === "compact") {
    await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-activity.png`), fullPage: true });
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

  await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-activity.png`), fullPage: true });
  expect(consoleProblems).toEqual([]);
});

test("real-data UI has enough volume for probe confidence", async ({ page }, testInfo) => {
  await page.goto("/web");
  await expect(page.locator(".app-shell")).toBeVisible();

  const buttons = await page.locator("button").count();
  const text = await page.locator(".app-shell").innerText();

  expect(buttons, "real UI should expose a non-trivial interaction surface").toBeGreaterThan(5);
  expect(text.length, "real UI should render non-trivial text volume").toBeGreaterThan(100);

  await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-shell.png`), fullPage: true });
});

function collectConsoleProblems(page: import("@playwright/test").Page): string[] {
  const consoleProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleProblems.push(error.message);
  });
  return consoleProblems;
}

async function openActivity(page: import("@playwright/test").Page): Promise<void> {
  const activityButton = page.getByRole("button", { name: "Activity" });
  await expect(activityButton).toBeVisible();
  await activityButton.click();
  await expect(page.locator(".activity-view")).toBeVisible();
}

async function openGroupChat(page: import("@playwright/test").Page, groupName: string): Promise<void> {
  const room = page.locator(".room-item").filter({ hasText: `#${groupName}` }).first();
  await expect(room, `expected #${groupName} in the sidebar`).toBeVisible();
  await room.click();
  await expect(page.locator(".chat-view")).toBeVisible();
}

async function openThreadFromChat(page: import("@playwright/test").Page, target: WebState["events"][number]): Promise<boolean> {
  const needle = snippet(target.body ?? "");
  const chatList = page.locator(".chat-list");
  await expect(chatList).toBeVisible();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = page.locator(".message-virtual-row").filter({ hasText: needle }).first();
    if (await row.isVisible().catch(() => false)) {
      const badge = row.locator(".thread-badge").first();
      if (await badge.isVisible().catch(() => false)) {
        await badge.click();
        return true;
      }
    }
    await chatList.evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollTop - Math.max(320, element.clientHeight * 0.75));
    });
  }
  return false;
}

async function closeThread(page: import("@playwright/test").Page): Promise<void> {
  const close = page.getByRole("button", { name: "close thread" });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator(".thread-pane")).toHaveCount(0);
}

async function scrollThreadToBottom(thread: import("@playwright/test").Locator): Promise<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  remaining: number;
  atBottom: boolean;
}> {
  const threadBody = thread.locator(".thread-pane-body");
  await expect(threadBody).toBeVisible();
  return threadBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      remaining,
      atBottom: Math.abs(remaining) <= 2,
    };
  });
}

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 48);
}

function topThreadRoots(groupId: number): WebState["events"] {
  return state.events
    .filter((event) =>
      event.type === "group_message" &&
      event.group_id === groupId &&
      event.parent_event_id === null &&
      event.reply_count > 1 &&
      Boolean(event.body?.trim()),
    )
    .sort((a, b) => b.event_id - a.event_id)
    .slice(0, 5);
}
