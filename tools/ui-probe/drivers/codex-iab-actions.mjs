import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { snippet } from "../core/real-data.mjs";

export async function ensureVisibleBrowser(browser) {
  await (await browser.capabilities.get("visibility")).set(true);
}

export async function ensureUsableTab(browser, tab) {
  if ((await tab.url().catch(() => "")).startsWith("data:")) {
    return browser.tabs.new();
  }
  return tab;
}

export async function openUrl(tab, url, pauseMs) {
  if (await tab.url() === url) {
    await tab.reload();
  } else {
    await tab.goto(url);
  }
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 10_000 });
  await tab.playwright.waitForTimeout(pauseMs);
}

export async function openActivity(tab, pauseMs) {
  await clickOne(tab.playwright.getByRole("button", { name: "Activity" }), "Activity button");
  await tab.playwright.waitForTimeout(pauseMs);
  await expectVisible(tab, ".activity-view", "Activity view");
  await markStep(tab, "activity-open");
}

export async function openGroupChat(tab, groupName, pauseMs) {
  await clickOne(tab.playwright.locator(".room-item").filter({ hasText: `#${groupName}` }), `#${groupName} room`);
  await tab.playwright.waitForTimeout(pauseMs);
  await expectVisible(tab, ".chat-view", "chat view");
  await markStep(tab, "chat-open");
}

export async function openThreadFromChat(tab, target, pauseMs) {
  const needle = snippet(target.body ?? "");
  await expectVisible(tab, ".chat-list", "chat list");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = tab.playwright.locator(".message-virtual-row").filter({ hasText: needle });
    if (await row.count() === 1) {
      const badge = row.locator(".thread-badge");
      if (await badge.count() === 1) {
        await badge.click({});
        await tab.playwright.waitForTimeout(pauseMs);
        await expectVisible(tab, ".thread-pane", "thread pane");
        return true;
      }
    }

    const rect = await rectFor(tab, ".chat-list");
    await tab.cua.scroll({
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      scrollY: -Math.max(320, Math.round(rect.height * 0.75)),
      scrollX: 0,
    });
    await tab.playwright.waitForTimeout(Math.max(250, Math.floor(pauseMs / 2)));
  }
  return false;
}

export async function scrollThreadToBottom(tab, pauseMs) {
  await expectVisible(tab, ".thread-pane-body", "thread pane body");
  const rect = await rectFor(tab, ".thread-pane-body");
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height * 0.75);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const metrics = await threadMetrics(tab);
    if (metrics.atBottom) return metrics;
    await tab.cua.scroll({ x, y, scrollY: Math.max(500, Math.round(rect.height * 0.85)), scrollX: 0 });
    await tab.playwright.waitForTimeout(Math.max(250, Math.floor(pauseMs / 2)));
  }
  return threadMetrics(tab);
}

export async function closeThread(tab, pauseMs) {
  await clickOne(tab.playwright.getByRole("button", { name: "close thread" }), "close thread button");
  await tab.playwright.waitForTimeout(pauseMs);
}

export async function clickOne(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`expected one ${label}, got ${count}`);
  await locator.click({});
}

export async function expectVisible(tab, selector, label) {
  const visible = await tab.playwright.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  })()`);
  if (!visible) throw new Error(`expected visible ${label} (${selector})`);
}

export async function markStep(tab, label) {
  await tab.playwright.evaluate(`(() => {
    document.body.setAttribute("data-ui-probe-step", ${JSON.stringify(label)});
    return true;
  })()`).catch(() => undefined);
}

export async function saveScreenshot(tab, artifactDir, filename) {
  if (typeof tab.screenshot !== "function") return null;
  const image = await tab.screenshot({ fullPage: true });
  if (image == null) return null;
  const dir = join(artifactDir, "screenshots");
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
  const bytes = image instanceof Uint8Array ? image : image.bytes ?? image.data ?? null;
  if (bytes == null) return null;
  await writeFile(path, bytes);
  return path;
}

async function rectFor(tab, selector) {
  const rect = await tab.playwright.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error(`invalid rect for ${selector}`);
  return rect;
}

async function threadMetrics(tab) {
  return tab.playwright.evaluate(`(() => {
    const element = document.querySelector(".thread-pane-body");
    if (!element) throw new Error("missing thread pane body");
    const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      remaining,
      atBottom: Math.abs(remaining) <= 2,
    };
  })()`);
}
