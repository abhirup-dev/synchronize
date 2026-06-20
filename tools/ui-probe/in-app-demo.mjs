import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function runInAppThreadTraversalDemo({
  browser,
  tab,
  sessionPath,
  baseUrl,
  statePath,
  artifactDir,
  pauseMs = 900,
}) {
  if (!browser) throw new Error("Codex in-app browser handle is required");
  if (!tab) throw new Error("Codex in-app browser tab handle is required");

  const session = sessionPath ? JSON.parse(await readFile(sessionPath, "utf8")) : {};
  const resolvedBaseUrl = baseUrl ?? session.baseUrl;
  const resolvedStatePath = statePath ?? session.statePath;
  const resolvedArtifactDir = artifactDir ?? session.artifactDir;
  if (!resolvedBaseUrl) throw new Error("baseUrl is required");
  if (!resolvedStatePath) throw new Error("statePath is required");
  if (!resolvedArtifactDir) throw new Error("artifactDir is required");

  const state = JSON.parse(await readFile(resolvedStatePath, "utf8"));
  const group = state.groups.find((candidate) => topThreadRoots(state, candidate.group_id).length >= 2);
  if (!group) throw new Error("real data should include a group with at least two top-five thread roots");
  const targets = topThreadRoots(state, group.group_id);
  if (targets.length < 2) throw new Error("top-five candidate set should include at least two threads");

  await (await browser.capabilities.get("visibility")).set(true);
  if ((await tab.url().catch(() => "")).startsWith("data:")) {
    tab = await browser.tabs.new();
  }
  const targetUrl = `${resolvedBaseUrl}/web`;
  if (await tab.url() === targetUrl) {
    await tab.reload();
  } else {
    await tab.goto(targetUrl);
  }
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 10_000 });
  await tab.playwright.waitForTimeout(pauseMs);
  await expectVisible(tab, ".app-shell", "app shell");

  await clickOne(tab.playwright.getByRole("button", { name: "Activity" }), "Activity button");
  await tab.playwright.waitForTimeout(pauseMs);
  await expectVisible(tab, ".activity-view", "Activity view");
  await markStep(tab, "activity-open");

  await clickOne(tab.playwright.locator(".room-item").filter({ hasText: `#${group.name}` }), `#${group.name} room`);
  await tab.playwright.waitForTimeout(pauseMs);
  await expectVisible(tab, ".chat-view", "chat view");
  await markStep(tab, "chat-open");

  const opened = [];
  const screenshots = [];
  for (const target of targets) {
    if (opened.length >= 2) break;
    const openedThread = await openThreadFromChat(tab, target, pauseMs);
    if (!openedThread) continue;
    opened.push(target.event_id);
    await markStep(tab, `thread-${target.event_id}-open`);
    await tab.playwright.waitForTimeout(pauseMs);

    const metrics = await scrollThreadToBottom(tab, pauseMs);
    if (!metrics.atBottom) throw new Error(`thread ${target.event_id} did not reach bottom: ${JSON.stringify(metrics)}`);
    await expectVisible(tab, ".thread-pane .composer", "thread composer");
    await markStep(tab, `thread-${target.event_id}-bottom`);
    await tab.playwright.waitForTimeout(pauseMs);

    screenshots.push(await saveScreenshot(tab, resolvedArtifactDir, `codex-iab-chat-thread-${opened.length}.jpeg`));
    await clickOne(tab.playwright.getByRole("button", { name: "close thread" }), "close thread button");
    await tab.playwright.waitForTimeout(pauseMs);
  }

  if (opened.length !== 2) {
    throw new Error(`expected to open two different threads from top-five candidates ${targets.map((target) => target.event_id).join(", ")}, opened ${opened.join(", ")}`);
  }

  const result = {
    ok: true,
    target: "codex-iab",
    baseUrl: resolvedBaseUrl,
    group: group.name,
    opened,
    screenshots,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(resolvedArtifactDir, "in-app-demo-result.json"), JSON.stringify(result, null, 2));
  return result;
}

async function openThreadFromChat(tab, target, pauseMs) {
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

async function scrollThreadToBottom(tab, pauseMs) {
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

async function clickOne(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`expected one ${label}, got ${count}`);
  await locator.click({});
}

async function expectVisible(tab, selector, label) {
  const visible = await tab.playwright.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  })()`);
  if (!visible) throw new Error(`expected visible ${label} (${selector})`);
}

async function rectFor(tab, selector) {
  const rect = await tab.playwright.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("missing selector: ${selector}");
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

async function markStep(tab, label) {
  await tab.playwright.evaluate(`(() => {
    document.body.setAttribute("data-ui-probe-step", ${JSON.stringify(label)});
    return true;
  })()`).catch(() => undefined);
}

async function saveScreenshot(tab, artifactDir, filename) {
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

function snippet(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 48);
}

function topThreadRoots(state, groupId) {
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
