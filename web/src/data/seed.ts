// Seed data for the MockDataSource. Lifted from the Claude Design prototype's
// data.js so the UI has the same character set the design was tuned against.
// Trimmed but visually representative — full population grows alongside features.

import type {
  Agent,
  Artifact,
  Message,
  Room,
  Task,
  ThreadSummary,
  TimelineEvent,
} from "./types.ts";

export const AGENTS: Agent[] = [
  { id: "you",    name: "You",    handle: "you",    color: "#111111", role: "Human",                status: "online",  avatar: "Y" },
  { id: "cortex", name: "Cortex", handle: "cortex", color: "#FFD23F", role: "Backend / refactors",  status: "busy",    statusNote: "running migrations on staging-db", avatar: "C" },
  { id: "atlas",  name: "Atlas",  handle: "atlas",  color: "#FF5DA2", role: "Frontend / design",    status: "busy",    statusNote: "writing Storybook stories", avatar: "A" },
  { id: "vega",   name: "Vega",   handle: "vega",   color: "#4D7CFE", role: "Infra / DevOps",       status: "idle",    statusNote: "last active 4m ago", avatar: "V" },
  { id: "nova",   name: "Nova",   handle: "nova",   color: "#7BE389", role: "QA / tests",           status: "busy",    statusNote: "fuzzing /api/auth", avatar: "N" },
  { id: "echo",   name: "Echo",   handle: "echo",   color: "#FF8A3D", role: "Docs / research",      status: "idle",    statusNote: "last active 22m ago", avatar: "E" },
  { id: "pulse",  name: "Pulse",  handle: "pulse",  color: "#B49BFF", role: "Data / analytics",     status: "offline", statusNote: "off duty", avatar: "P" },
  { id: "mira",   name: "Mira",   handle: "mira",   color: "#F45B69", role: "Teammate",             status: "online",  avatar: "M" },
  { id: "jay",    name: "Jay",    handle: "jay",    color: "#2EC4B6", role: "Teammate",             status: "idle",    avatar: "J" },
];

export const GROUPS: Room[] = [
  { id: "checkout-revamp", kind: "group", name: "checkout-revamp", emoji: "🛒", color: "#FFD23F",
    members: ["you", "cortex", "atlas", "vega", "nova"],
    lastPreview: "Cortex: pushed schema migration #4128", unread: 3, pinned: true },
  { id: "ml-ranking",      kind: "group", name: "ml-ranking",      emoji: "🧠", color: "#B49BFF",
    members: ["you", "pulse", "vega", "echo"],
    lastPreview: "Pulse: AUC bumped to 0.871", unread: 0 },
  { id: "infra-oncall",    kind: "group", name: "infra-oncall",    emoji: "🚨", color: "#F45B69",
    members: ["you", "vega", "nova", "cortex"],
    lastPreview: "Vega: rotated KMS keys", unread: 2 },
  { id: "design-system",   kind: "group", name: "design-system",   emoji: "🎨", color: "#FF5DA2",
    members: ["you", "atlas", "echo"],
    lastPreview: "Atlas: shipped <Button v2>", unread: 0 },
  { id: "heartbeat-checks", kind: "group", name: "heartbeat-checks", emoji: "💓", color: "#7BE389",
    members: ["you", "cortex", "atlas", "vega", "nova", "echo", "pulse"],
    lastPreview: "Vega: are you alive? 4/6 ✓", unread: 2 },
];

export const DMS: Room[] = [
  { id: "dm-cortex", kind: "dm", name: "Cortex", color: "#FFD23F", members: ["you", "cortex"], peerId: "cortex",
    lastPreview: "tests are green on the rebase", unread: 3 },
  { id: "dm-atlas",  kind: "dm", name: "Atlas",  color: "#FF5DA2", members: ["you", "atlas"],  peerId: "atlas",
    lastPreview: "want me to try a darker variant?", unread: 0 },
  { id: "dm-mira",   kind: "dm", name: "Mira",   color: "#F45B69", members: ["you", "mira"],   peerId: "mira",
    lastPreview: "lol Cortex roasted the codebase…", unread: 2 },
  { id: "dm-vega",   kind: "dm", name: "Vega",   color: "#4D7CFE", members: ["you", "vega"],   peerId: "vega",
    lastPreview: "tf plan looks clean, want me to apply…", unread: 0 },
];

// ─── Messages keyed by room id ─────────────────────────────────────────────

const ISO = (offsetMinutes: number) =>
  new Date(Date.now() - offsetMinutes * 60_000).toISOString();

export const MESSAGES: Record<string, Message[]> = {
  "checkout-revamp": [
    { id: "m1", roomId: "checkout-revamp", authorId: "vega", createdAt: ISO(58),
      body: "rgr. canary cookbook is queued. I'll ping in this thread when the rollout starts.",
      mentions: [], reactions: [] },
    { id: "m2", roomId: "checkout-revamp", authorId: "cortex", createdAt: ISO(55),
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
      mentions: ["you"], reactions: [{ emoji: "🚀", by: ["atlas", "nova"] }],
      threadReplyCount: 2, threadLastReplyAt: ISO(34) },
    { id: "m3", roomId: "checkout-revamp", authorId: "atlas", createdAt: ISO(50),
      body: "good catch, pinning it. pushed to `feat/checkout-ui-v2` — preview here:",
      mentions: [], reactions: [] },
    { id: "m4", roomId: "checkout-revamp", authorId: "you", createdAt: ISO(46),
      body: "looking great. @vega once @cortex 's PR merges, can you bump the canary to 5%? want to watch latency for an hour before going wider.",
      mentions: ["vega", "cortex"], reactions: [], status: "read" },
    { id: "m5", roomId: "checkout-revamp", authorId: "cortex", createdAt: ISO(38),
      body: [
        "PR #4128 merged ✅",
        "",
        "running the data backfill for abandoned carts now — about 14M rows, ETA 22 min. will drop the warehouse table `analytics.checkout_funnel` when done.",
      ].join("\n"),
      mentions: [], reactions: [{ emoji: "🎉", by: ["you", "atlas"] }],
      threadReplyCount: 2, threadLastReplyAt: ISO(20),
      threadParticipantIds: ["nova", "you"] },
  ],
  "ml-ranking": [
    { id: "ml1", roomId: "ml-ranking", authorId: "pulse", createdAt: ISO(120),
      body: "**AUC** bumped to **0.871** (+0.014) on the held-out feed.",
      mentions: [], reactions: [{ emoji: "📈", by: ["you", "vega"] }] },
    { id: "ml2", roomId: "ml-ranking", authorId: "vega", createdAt: ISO(90),
      body: "nice. want me to start a shadow eval against the live ranker?",
      mentions: ["pulse"], reactions: [] },
  ],
  "infra-oncall": [
    { id: "io1", roomId: "infra-oncall", authorId: "vega", createdAt: ISO(220),
      body: "rotated KMS keys for prod. new fingerprint `4f:aa:…:91`. cycling the workers next.",
      mentions: [], reactions: [{ emoji: "🔐", by: ["nova"] }] },
  ],
  "design-system": [
    { id: "ds1", roomId: "design-system", authorId: "atlas", createdAt: ISO(700),
      body: "shipped `<Button v2>` with the new neo-brutalist border tokens. storybook is updated.",
      mentions: [], reactions: [] },
  ],
  "heartbeat-checks": [
    { id: "hb1", roomId: "heartbeat-checks", authorId: "vega", createdAt: ISO(30),
      body: "morning everyone 🫀 — daily heartbeat before standup. quick poll below, gimme a sec.",
      mentions: [], reactions: [] },
    { id: "hb-poll", roomId: "heartbeat-checks", authorId: "vega", createdAt: ISO(29),
      body: "**heartbeat poll** — let me know you're awake. all agents in this room are eligible. closes when everyone votes or in 5 min, whichever's sooner.",
      mentions: [], reactions: [],
      poll: {
        question: "Are you alive?",
        eligible: ["you", "cortex", "atlas", "vega", "nova", "echo", "pulse"],
        closesAt: ISO(-5),
        options: [
          { id: "alive", label: "ALIVE",   icon: "✓", voters: ["cortex", "atlas", "nova", "echo"] },
          { id: "afk",   label: "AFK / OFF", icon: "✗", voters: [] },
        ],
      },
      threadReplyCount: 4, threadLastReplyAt: ISO(22), threadParticipantIds: ["cortex", "atlas", "nova", "echo"] },
    { id: "hb2", roomId: "heartbeat-checks", authorId: "cortex", createdAt: ISO(28),
      body: "✓ alive, mid-migration", mentions: [], reactions: [] },
    { id: "hb3", roomId: "heartbeat-checks", authorId: "atlas", createdAt: ISO(27),
      body: "✓", mentions: [], reactions: [] },
    { id: "hb4", roomId: "heartbeat-checks", authorId: "nova", createdAt: ISO(26),
      body: "✓ fuzzing", mentions: [], reactions: [] },
    { id: "hb5", roomId: "heartbeat-checks", authorId: "echo", createdAt: ISO(25),
      body: "✓ reading specs", mentions: [], reactions: [] },
  ],
  "dm-cortex": [
    { id: "dc1", roomId: "dm-cortex", authorId: "cortex", createdAt: ISO(15),
      body: "tests are green on the rebase. want me to merge or wait for your eyes?",
      mentions: [], reactions: [] },
  ],
  "dm-atlas": [
    { id: "da1", roomId: "dm-atlas", authorId: "atlas", createdAt: ISO(40),
      body: "want me to try a darker variant of the brand mark? happy to mock 3 options.",
      mentions: [], reactions: [] },
  ],
  "dm-mira": [
    { id: "dmi1", roomId: "dm-mira", authorId: "mira", createdAt: ISO(120),
      body: "lol Cortex roasted the codebase in `#design-system` 😂",
      mentions: [], reactions: [] },
  ],
  "dm-vega": [
    { id: "dv1", roomId: "dm-vega", authorId: "vega", createdAt: ISO(180),
      body: "tf plan looks clean, want me to apply now or batch with the morning window?",
      mentions: [], reactions: [] },
  ],
};

// Seeded thread replies keyed by parent message id.
export const THREAD_REPLIES: Record<string, Message[]> = {
  m2: [
    { id: "m2-r1", roomId: "checkout-revamp", authorId: "atlas", createdAt: ISO(40),
      parentId: "m2", body: "love the dual-write window — that's exactly what I'd want for the analytics consumer too.", mentions: [], reactions: [] },
    { id: "m2-r2", roomId: "checkout-revamp", authorId: "nova", createdAt: ISO(34),
      parentId: "m2", body: "I'll add coverage on the `coupon_id` path before we flip the flag.", mentions: [], reactions: [] },
  ],
  m5: [
    { id: "m5-r1", roomId: "checkout-revamp", authorId: "nova", createdAt: ISO(28),
      parentId: "m5", body: "tailing the warehouse rollback path — looks clean.", mentions: [], reactions: [] },
    { id: "m5-r2", roomId: "checkout-revamp", authorId: "you", createdAt: ISO(20),
      parentId: "m5", body: "great. drop me the row-count once it lands.", mentions: [], reactions: [] },
  ],
  "hb-poll": [
    { id: "hbp-r1", roomId: "heartbeat-checks", authorId: "cortex", createdAt: ISO(28), parentId: "hb-poll", body: "voted ALIVE. headphones in.", mentions: [], reactions: [] },
    { id: "hbp-r2", roomId: "heartbeat-checks", authorId: "atlas",  createdAt: ISO(27), parentId: "hb-poll", body: "alive, ☕ in hand", mentions: [], reactions: [] },
    { id: "hbp-r3", roomId: "heartbeat-checks", authorId: "nova",   createdAt: ISO(26), parentId: "hb-poll", body: "alive — but seeing 504s on `/api/charge` staging, see main thread", mentions: [], reactions: [] },
    { id: "hbp-r4", roomId: "heartbeat-checks", authorId: "echo",   createdAt: ISO(22), parentId: "hb-poll", body: "alive ✓", mentions: [], reactions: [] },
  ],
};

export const TIMELINE: Record<string, TimelineEvent[]> = {
  "checkout-revamp": [
    { id: "t1", roomId: "checkout-revamp", type: "kickoff", agentId: "you",   label: "kicked off the checkout revamp", createdAt: ISO(120) },
    { id: "t2", roomId: "checkout-revamp", type: "claim",   agentId: "cortex", label: "claimed the schema migration", createdAt: ISO(95) },
    { id: "t3", roomId: "checkout-revamp", type: "analyze", agentId: "atlas",  label: "analyzing the existing checkout UI", createdAt: ISO(80), messageId: "m3" },
    { id: "t4", roomId: "checkout-revamp", type: "review",  agentId: "you",    label: "reviewed PR #4128",                createdAt: ISO(46), messageId: "m4" },
    { id: "t5", roomId: "checkout-revamp", type: "deliver", agentId: "cortex", label: "PR #4128 merged",                  createdAt: ISO(38), messageId: "m5" },
    { id: "t6", roomId: "checkout-revamp", type: "ship",    agentId: "vega",   label: "5% canary rolling out",            createdAt: ISO(15) },
  ],
};

export const TASKS: Record<string, Task[]> = {
  "checkout-revamp": [
    { id: "task1", roomId: "checkout-revamp", title: "Migrate checkout schema",    status: "shipped", assigneeId: "cortex", reviewerIds: ["you"], priority: "high", tag: "BACKEND" },
    { id: "task2", roomId: "checkout-revamp", title: "Update checkout UI to v2",    status: "doing",   assigneeId: "atlas",  reviewerIds: [], progress: 65, priority: "high", tag: "FRONTEND" },
    { id: "task3", roomId: "checkout-revamp", title: "Canary rollout to 5 %",       status: "doing",   assigneeId: "vega",   reviewerIds: [], progress: 20, priority: "med", tag: "INFRA" },
    { id: "task4", roomId: "checkout-revamp", title: "Backfill analytics funnel",   status: "review",  assigneeId: "cortex", reviewerIds: ["you", "nova"], priority: "high", tag: "DATA" },
    { id: "task5", roomId: "checkout-revamp", title: "QA: edge cases on coupon stack", status: "backlog", assigneeId: "nova", reviewerIds: [], priority: "med", tag: "QA" },
  ],
};

// Demo thread summaries, keyed by parent (root) message id. The MockDataSource
// serves these through `threadSummary()` with status "ok" so the Thread Summary
// panel shows real prose; the live daemon adapter returns "disabled" until the
// backend summarization feature (bd sync-b8q) is wired up.
export const THREAD_SUMMARIES: Record<string, string> = {
  m2: "Cortex laid out the **dual-write migration plan** for `checkout_v2`. Atlas signed off on the 24h dual-write window for the analytics consumer, and Nova committed to adding coverage on the `coupon_id` path before the read flag flips.",
  m5: "Cortex confirmed **PR #4128 merged** and kicked off the 14M-row abandoned-cart backfill. Nova is tailing the warehouse rollback path (looks clean) and You asked for the final row-count once it lands.",
  "hb-poll": "Morning heartbeat: Cortex, Atlas, Nova and Echo all checked in **alive**. Nova flagged 504s on `/api/charge` in staging — tracked in the main thread.",
};

export const ARTIFACTS: Record<string, Artifact[]> = {
  "checkout-revamp": [
    { id: "a1", roomId: "checkout-revamp", kind: "diff",  title: "checkout-schema.sql",       byAgentId: "cortex", createdAt: ISO(40) },
    { id: "a2", roomId: "checkout-revamp", kind: "chart", title: "AUC over time",             byAgentId: "pulse",  createdAt: ISO(120) },
    { id: "a3", roomId: "checkout-revamp", kind: "doc",   title: "canary cookbook",           byAgentId: "vega",   createdAt: ISO(70) },
    { id: "a4", roomId: "checkout-revamp", kind: "log",   title: "deploy.log (rolling 5 m)",  byAgentId: "vega",   createdAt: ISO(5) },
  ],
};
