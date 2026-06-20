import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { groupWithTopThreads, topThreadRoots } from "./core/real-data.mjs";
import {
  closeThread,
  ensureUsableTab,
  ensureVisibleBrowser,
  expectVisible,
  markStep,
  openActivity,
  openGroupChat,
  openThreadFromChat,
  openUrl,
  saveScreenshot,
  scrollThreadToBottom,
} from "./drivers/codex-iab-actions.mjs";

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
  const group = groupWithTopThreads(state);
  if (!group) throw new Error("real data should include a group with at least two top-five thread roots");
  const targets = topThreadRoots(state, group.group_id);
  if (targets.length < 2) throw new Error("top-five candidate set should include at least two threads");

  await ensureVisibleBrowser(browser);
  tab = await ensureUsableTab(browser, tab);
  await openUrl(tab, `${resolvedBaseUrl}/web`, pauseMs);
  await expectVisible(tab, ".app-shell", "app shell");

  await openActivity(tab, pauseMs);
  await openGroupChat(tab, group.name, pauseMs);

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
    await closeThread(tab, pauseMs);
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
