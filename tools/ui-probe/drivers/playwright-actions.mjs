import { expect } from "@playwright/test";
import { snippet } from "../core/real-data.mjs";

const probeMode = process.env.UI_PROBE_MODE ?? "offline";
const demoPauseMs = Number(process.env.UI_PROBE_DEMO_PAUSE_MS ?? 900);

export async function openActivity(page) {
  const activityButton = page.getByRole("button", { name: "Activity" });
  await expect(activityButton).toBeVisible();
  await activityButton.click();
  await expect(page.locator(".activity-view")).toBeVisible();
}

export async function openGroupChat(page, groupName) {
  const room = page.locator(".room-item").filter({ hasText: `#${groupName}` }).first();
  await expect(room, `expected #${groupName} in the sidebar`).toBeVisible();
  await room.click();
  await expect(page.locator(".chat-view")).toBeVisible();
}

export async function openThreadFromChat(page, target) {
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

export async function closeThread(page) {
  const close = page.getByRole("button", { name: "close thread" });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator(".thread-pane")).toHaveCount(0);
}

export async function demoPause(page, label) {
  if (probeMode !== "demo") return;
  await page.locator("body").evaluate((body, step) => {
    body.setAttribute("data-ui-probe-step", step);
  }, label);
  await page.waitForTimeout(demoPauseMs);
}

export async function scrollThreadToBottom(thread) {
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
