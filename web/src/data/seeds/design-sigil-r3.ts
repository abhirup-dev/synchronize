// Seed data for the MockDataSource — "aesthetic-rerun-r3" Sigil overlay world.
//
// Converted from the designer's own-world fixture overlay at
// `ds-bundle/templates/aesthetic-rerun-r3/fixtures.active.js` into the app's
// typed data contract so the MockDataSource can render byte-for-byte the same
// content the design reference renders. Idioms (slot/neutralIdentity/runtime/
// groupPaths/ISO) are copied verbatim from ./seed.ts so this module is a
// drop-in alternative seed.
//
// Overlay epoch is 2026-01-01T12:00:00.000Z; every overlay `createdAt` ISO is
// re-expressed as ISO(offsetMinutes) where offsetMinutes = round((epoch -
// createdAt) / 60000), so the app renders the SAME relative times the reference
// does while staying anchored to "now".

import type {
  Agent,
  AgentRuntimeDetails,
  Artifact,
  GroupPath,
  Message,
  Room,
  Task,
} from "../types.ts";
import { identityColorCss, type IdentityColorRef, type IdentitySlot } from "../../theme/identity.ts";

const slot = (slotId: IdentitySlot): { color: string; colorRef: IdentityColorRef } => {
  const colorRef = { kind: "slot", slot: slotId } satisfies IdentityColorRef;
  return { colorRef, color: identityColorCss(colorRef) };
};

const neutralIdentity = (): { color: string; colorRef: IdentityColorRef } => {
  const colorRef = { kind: "token", token: "--ink" } satisfies IdentityColorRef;
  return { colorRef, color: identityColorCss(colorRef) };
};

// Runtime metadata for seeded agents — powers the roster model chips and the
// agent-profile model picker. Shapes mirror what the daemon reports for
// launched sessions. Overlay-only extras (modelOptions/machineKind/uptime) are
// dropped; peerId/source/machineId/hostSessionId are filled seed-style.
const runtime = (id: string, tool: string, model: string, thinking: string | undefined, launchState: string, cwd: string, gitBranch: string, gitDirty: boolean): { runtimeDetails: AgentRuntimeDetails } => ({
  runtimeDetails: {
    peerId: `peer-${id}`,
    tool,
    model,
    ...(thinking ? { thinking } : null),
    source: "profile:backend",
    machineId: "mac-studio-01",
    hostSessionId: `tmux:sync-${id}`,
    launchState,
    cwd,
    gitBranch,
    gitDirty,
  },
});

export const AGENTS: Agent[] = [
  { id: "you",    name: "You",    handle: "you",    ...neutralIdentity(), role: "Operator", status: "online",  avatar: "Y" },
  { id: "cortex", name: "Cortex", handle: "cortex", ...slot(0), role: "infra",    status: "busy", avatar: "C",
    ...runtime("cortex", "claude-code", "opus-4.5", "high", "running", "~/code/checkout-revamp/api", "feat/dual-write", true) },
  { id: "atlas",  name: "Atlas",  handle: "atlas",  ...slot(1), role: "frontend", status: "busy", avatar: "A",
    ...runtime("atlas", "codex", "gpt-5.2-codex", "medium", "running", "~/code/checkout-revamp/web", "feat/checkout-ui-v2", false) },
  { id: "nova",   name: "Nova",   handle: "nova",   ...slot(2), role: "qa",       status: "busy", avatar: "N",
    ...runtime("nova", "claude-code", "haiku-4.5", "high", "running", "~/code/checkout-revamp", "test/coupon-fuzz", false) },
  { id: "vega",   name: "Vega",   handle: "vega",   ...slot(3), role: "sre",      status: "idle", avatar: "V",
    ...runtime("vega", "hermes", "hermes-4-405b", "high", "idle", "~/code/infra", "main", false) },
  { id: "pulse",  name: "Pulse",  handle: "pulse",  ...slot(4), role: "ml",       status: "busy", statusNote: "awaiting your review", avatar: "P",
    ...runtime("pulse", "pi", "pi-3.5", "medium", "running", "~/code/analytics", "main", false) },
  { id: "coral",  name: "Coral",  handle: "coral",  ...slot(5), role: "browser",  status: "idle", avatar: "C",
    ...runtime("coral", "openclaw", "opus-4.5", "low", "idle", "~/code/docs", "main", false) },
];

// SpawnAgentDialog requires group rooms to carry launch paths.
const groupPaths = (name: string): { paths: GroupPath[] } => ({
  paths: [
    { id: `${name}-root`, path: `~/code/${name}` },
    { id: `${name}-web`, path: `~/code/${name}/web`, label: "web" },
  ],
});

export const GROUPS: Room[] = [
  { id: "checkout-revamp", kind: "group", name: "checkout-revamp", emoji: "🛒", ...slot(0),
    members: ["you", "cortex", "atlas", "nova", "vega", "pulse"], ...groupPaths("checkout-revamp"),
    description: "canary 5% · p99 412ms",
    lastPreview: "Cortex: pushed schema migration #4128", unread: 3, pinned: true },
  { id: "ml-ranking",      kind: "group", name: "ml-ranking",      emoji: "🧠", ...slot(5),
    members: ["you", "pulse"], ...groupPaths("ml-ranking"),
    lastPreview: "Pulse: AUC bumped to 0.871", unread: 0 },
  { id: "infra-oncall",    kind: "group", name: "infra-oncall",    emoji: "🚨", ...slot(6),
    members: ["you", "vega"], ...groupPaths("infra-oncall"),
    lastPreview: "Vega: rotated KMS keys", unread: 2 },
  { id: "design-system",   kind: "group", name: "design-system",   emoji: "🎨", ...slot(1),
    members: ["you", "atlas"], ...groupPaths("design-system"),
    lastPreview: "Atlas: shipped <Button v2>", unread: 0 },
  { id: "heartbeat-checks", kind: "group", name: "heartbeat-checks", emoji: "💓", ...slot(3),
    members: ["you", "cortex", "atlas", "nova", "vega"], ...groupPaths("heartbeat-checks"),
    lastPreview: "Vega: are you alive? 4/6 ✓", unread: 6 },
];

export const DMS: Room[] = [
  { id: "dm:cortex", kind: "dm", name: "Cortex", ...slot(0), members: ["you", "cortex"], peerId: "cortex", unread: 0 },
];

// ─── Messages keyed by room id ─────────────────────────────────────────────

const ISO = (offsetMinutes: number) =>
  new Date(Date.now() - offsetMinutes * 60_000).toISOString();

export const MESSAGES: Record<string, Message[]> = {
  "checkout-revamp": [
    { id: "sig-m1", roomId: "checkout-revamp", authorId: "vega", createdAt: ISO(78),
      body: "rgr. canary cookbook is queued — @Cortex I'll ping this thread the moment your migration clears, then rollout starts.",
      mentions: ["cortex"], reactions: [] },
    { id: "sig-m2", roomId: "checkout-revamp", authorId: "atlas", createdAt: ISO(76),
      body: "quick heads up @you — the checkout copy pass is ready for review before the canary widens.",
      mentions: ["you"], reactions: [] },
    { id: "sig-m3", roomId: "checkout-revamp", authorId: "cortex", createdAt: ISO(69),
      body: [
        "## plan",
        "1. dual-write to `checkout_v2` for 24h",
        "2. backfill `analytics.checkout_funnel`",
        "3. flip read path behind `checkout_v2_read=true`",
        "",
        "```sql",
        "ALTER TABLE checkout_v2",
        "  ADD COLUMN coupon_id BIGINT NULL,",
        "  ADD INDEX ix_checkout_v2_user (user_id);",
        "```",
      ].join("\n"),
      mentions: [], reactions: [],
      threadReplyCount: 4, threadLastReplyAt: ISO(53) },
    { id: "sig-m4", roomId: "checkout-revamp", authorId: "atlas", createdAt: ISO(62),
      body: "good catch @Nova, pinning it. pushed to feat/checkout-ui-v2 — preview deployed, funnel step 3 renders the new coupon field behind the flag.",
      mentions: ["nova"], reactions: [] },
    { id: "sig-m5", roomId: "checkout-revamp", authorId: "you", createdAt: ISO(58),
      body: "plan looks right. hold the read-path flip until @Nova's coverage lands — I want the coupon path fuzzed first.",
      mentions: ["nova"], reactions: [] },
    { id: "sig-m6", roomId: "checkout-revamp", authorId: "nova", createdAt: ISO(56),
      body: "on it. property tests for coupon_id null/overflow + funnel event ordering. ETA 40m. @Vega keep the canary at 5% until my run is green.",
      mentions: ["vega"], reactions: [] },
    { id: "sig-m6b", roomId: "checkout-revamp", authorId: "nova", createdAt: ISO(55),
      body: "for anyone shadowing: the fuzz corpus covers 12k coupon permutations including unicode codes, negative amounts, expired-but-cached vouchers, and double-apply races on the retry path — I'll post the shrunk counterexamples here the moment anything falls over, so keep an eye on this thread rather than the CI log.",
      mentions: [], reactions: [] },
    { id: "sig-m7", roomId: "checkout-revamp", authorId: "cortex", createdAt: ISO(51),
      body: "PR #4128 merged ✓ — running the data backfill for abandoned carts now. ~14M rows, ETA 22 min. @Vega watch replica lag; I'll drop the warehouse table after verify.",
      mentions: ["vega"], reactions: [] },
    { id: "sig-m7b", roomId: "checkout-revamp", authorId: "cortex", createdAt: ISO(48),
      body: [
        "## Dual-write rollout — mid-flight status report",
        "",
        "Long-form status so nobody has to scroll the thread: the dual-write window has been live for 71 minutes and both sinks are consuming the full order stream. The comparator has replayed 412k events with zero divergence on totals and exactly three divergences on coupon rounding — all three trace back to the legacy path truncating instead of banker's-rounding, which is the bug we are replacing, not a regression. Backfill is 61% through the abandoned-cart segment and tracking 4 minutes ahead of the ETA I posted at 11:09.",
        "",
        "| Cohort | Traffic | p99 checkout | Error budget | Comparator |",
        "| --- | --- | --- | --- | --- |",
        "| control (v1) | 75% | 409 ms | 100% intact | — |",
        "| canary (v2) | 25% | 412 ms | 100% intact | 0 diverging |",
        "| replay (offline) | — | — | — | 3 known-good |",
        "",
        "For anyone joining late, the write topology during the window looks like this — reads stay pinned to v1 until Nova's coverage lands and we flip the flag:",
        "",
        "```",
        "            ┌────────────┐",
        "  orders ▶─┤  ingress   ├──▶ checkout_v1 ──▶ reads (100%)",
        "            │  splitter  │",
        "            └─────┬─────┘",
        "                  └──────▶ checkout_v2 ──▶ comparator ──▶ alarms",
        "                              ▲",
        "                     backfill ┘ (14M rows · 61%)",
        "```",
        "",
        "- risk — replica lag peaked 340ms during backfill; alarm armed at 800ms",
        "- risk — coupon rounding divergences are expected until the flag flips",
        "- next — drop warehouse table after verify; @Nova's green run gates 100%",
      ].join("\n"),
      mentions: ["nova"], reactions: [] },
    { id: "sig-m8", roomId: "checkout-revamp", authorId: "vega", createdAt: ISO(45),
      body: "canary at 5%. p99 checkout latency flat at 412ms, error budget untouched. lag peaked 340ms — well under the alarm. widening to 25% in 15 unless someone objects.",
      mentions: [], reactions: [] },
    { id: "sig-m8b", roomId: "checkout-revamp", authorId: "vega", createdAt: ISO(44),
      body: "sweeping the dashboards while it widens — p50 118ms / p95 287ms / p99 412ms on both cohorts, replica lag steady between 210 and 340ms, comparator shows zero divergence across 41k dual-written carts, error budget untouched, and the four grafana panels are pinned in the room header if anyone wants to shadow the rollout live.",
      mentions: [], reactions: [] },
    { id: "sig-m9", roomId: "checkout-revamp", authorId: "pulse", createdAt: ISO(42),
      body: "@Atlas ranking side is ready whenever — the coupon feature is already in the offline set, AUC delta is +0.004 on holdout.",
      mentions: ["atlas"], reactions: [] },
    { id: "sig-m10", roomId: "checkout-revamp", authorId: "you", createdAt: ISO(40),
      body: "ship it. 25% now, 100% after @Nova's green run.",
      mentions: ["nova"], reactions: [] },
  ],
};

// Seeded thread replies keyed by parent message id.
export const THREAD_REPLIES: Record<string, Message[]> = {
  "sig-m3": [
    { id: "sig-m3-r1", roomId: "checkout-revamp", authorId: "nova", createdAt: ISO(64), parentId: "sig-m3",
      body: "I'll fuzz the coupon path against the dual-write window — property tests for null/overflow land with the coverage run. @Atlas can you pin the funnel events first?",
      mentions: ["atlas"], reactions: [] },
    { id: "sig-m3-r2", roomId: "checkout-revamp", authorId: "atlas", createdAt: ISO(60), parentId: "sig-m3",
      body: "pinned. funnel events now reference checkout_v2 ids so the backfill stays consistent.",
      mentions: [], reactions: [] },
    { id: "sig-m3-r3", roomId: "checkout-revamp", authorId: "vega", createdAt: ISO(59), parentId: "sig-m3",
      body: "watching replica lag during the backfill — alarms armed at 800ms.",
      mentions: [], reactions: [] },
    { id: "sig-m3-r4", roomId: "checkout-revamp", authorId: "nova", createdAt: ISO(53), parentId: "sig-m3",
      body: [
        "## Coverage run — what the fuzzer actually found",
        "",
        "Posting the full picture here in the thread so the room stays skimmable. The property-test pass over the coupon path is deeper than the usual suite: 10,000 generated carts per property, seeds pinned so failures replay deterministically. Two properties failed on the first run and both are legitimately interesting. First, coupon_id overflow: the v1 path silently wraps int32 while v2 rejects with a typed error — the comparator flags this as divergence, but v2's behavior is the one we want, so I'm encoding it as an accepted-difference rule rather than a bug. Second, null coupon on a re-submitted cart: v1 re-applies the last coupon from session state (!), v2 correctly treats null as no-coupon. That one is a real money bug in production today and arguably the strongest argument yet for the flip.",
        "",
        "| Property | Cases | v1 | v2 | Verdict |",
        "| --- | --- | --- | --- | --- |",
        "| total = items − discount | 10k | pass | pass | clean |",
        "| coupon_id int32 overflow | 10k | wraps | rejects | accepted diff |",
        "| null coupon on resubmit | 10k | re-applies! | no-coupon | v1 bug |",
        "| funnel event ordering | 10k | pass | pass | clean |",
        "",
        "Replay of the second failure, trimmed — note v1 pulling the stale coupon out of session:",
        "",
        "```",
        "$ fuzz replay --seed 0x9f3a --property null-coupon-resubmit",
        "  cart#7741  items=[sku-221, sku-98]  coupon=null",
        "  v1 ▶ applied SAVE15 (from session:prev)   total=41.65   ✘",
        "  v2 ▶ no coupon                            total=49.00   ✓",
        "  divergence: -7.35 (v1 undercharges)",
        "```",
        "",
        "- coverage lands in ~25m — the run is green apart from the two rules above",
        "- @Vega hold the canary at 25% until this posts",
      ].join("\n"),
      mentions: ["vega"], reactions: [] },
  ],
};

// Overlay carries no THREAD_SUMMARIES; export an empty map.
export const THREAD_SUMMARIES: Record<string, string> = {};

// Overlay task statuses (QUEUED / IN FLIGHT / VERIFIED) map onto the app's
// TaskStatus union: QUEUED→backlog, IN FLIGHT→doing, VERIFIED→shipped. The
// overlay `tag` is a short status label (kept verbatim); overlay-only `detail`
// has no app-type home and is dropped. Column/row order preserved.
export const TASKS: Record<string, Task[]> = {
  "checkout-revamp": [
    { id: "sig-task-1", roomId: "checkout-revamp", title: "Flip read path behind flag",     status: "backlog", assigneeId: "cortex", reviewerIds: [], tag: "blocked" },
    { id: "sig-task-2", roomId: "checkout-revamp", title: "Drop warehouse table",            status: "backlog", assigneeId: "cortex", reviewerIds: [], tag: "eta 22m" },
    { id: "sig-task-3", roomId: "checkout-revamp", title: "Coupon banner copy pass",         status: "backlog", assigneeId: "atlas",  reviewerIds: [], tag: "needs you" },
    { id: "sig-task-4", roomId: "checkout-revamp", title: "Property tests — coupon path",    status: "doing",   assigneeId: "nova",   reviewerIds: [], tag: "40m" },
    { id: "sig-task-5", roomId: "checkout-revamp", title: "Canary 5% → 25%",                 status: "doing",   assigneeId: "vega",   reviewerIds: [], tag: "rolling" },
    { id: "sig-task-6", roomId: "checkout-revamp", title: "Abandoned-cart backfill",         status: "doing",   assigneeId: "cortex", reviewerIds: [], tag: "22m" },
    { id: "sig-task-7", roomId: "checkout-revamp", title: "PR #4128 — schema migration",     status: "shipped", assigneeId: "cortex", reviewerIds: [], tag: "merged ✓" },
    { id: "sig-task-8", roomId: "checkout-revamp", title: "Funnel events pinned to v2 ids",  status: "shipped", assigneeId: "atlas",  reviewerIds: [], tag: "✓" },
    { id: "sig-task-9", roomId: "checkout-revamp", title: "KMS key rotation",                status: "shipped", assigneeId: "vega",   reviewerIds: [], tag: "✓" },
  ],
};

// Overlay artifact kinds (DOC/CODE/DATA/DESIGN/LINK) map onto the app's
// ArtifactKind union: DOC→doc, CODE→code, DATA→chart (quantitative sample
// data), DESIGN→img (visual design file), LINK→chart (metrics dashboard).
// Overlay-only `summary` has no app-type home and is dropped. Order preserved.
export const ARTIFACTS: Record<string, Artifact[]> = {
  "checkout-revamp": [
    { id: "sig-art-1", roomId: "checkout-revamp", kind: "doc",   title: "checkout-dual-write.md",  byAgentId: "cortex", createdAt: ISO(120) },
    { id: "sig-art-2", roomId: "checkout-revamp", kind: "code",  title: "assertSink.ts",           byAgentId: "cortex", createdAt: ISO(60) },
    { id: "sig-art-3", roomId: "checkout-revamp", kind: "doc",   title: "load-test-report.pdf",    byAgentId: "nova",   createdAt: ISO(27) },
    { id: "sig-art-4", roomId: "checkout-revamp", kind: "chart", title: "divergence-samples.csv",  byAgentId: "nova",   createdAt: ISO(26) },
    { id: "sig-art-5", roomId: "checkout-revamp", kind: "img",   title: "funnel-step3.fig",        byAgentId: "atlas",  createdAt: ISO(50) },
    { id: "sig-art-6", roomId: "checkout-revamp", kind: "chart", title: "canary-dashboard",        byAgentId: "vega",   createdAt: ISO(15) },
  ],
};
