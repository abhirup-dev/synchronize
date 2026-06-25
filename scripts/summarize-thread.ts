#!/usr/bin/env bun
//
// V0 spike for sync-b8q (thread summaries). Reads a real thread from the
// running synchronize daemon and asks an LLM (via Vercel AI SDK + OpenRouter)
// to summarize it. No DB writes, no caching, no worker — pure transcript-in /
// summary-out for prompt + provider validation.
//
// Usage:
//   OPENROUTER_API_KEY=sk-... bun run scripts/summarize-thread.ts --root-event-id 42
//   bun run scripts/summarize-thread.ts --root-event-id 42 --strategy first_k --k 3
//   bun run scripts/summarize-thread.ts --root-event-id 42 --strategy first_last --first-k 5 --last-k 10
//   bun run scripts/summarize-thread.ts --list                     # list discoverable threads
//   bun run scripts/summarize-thread.ts --root-event-id 42 --raw   # print transcript only, skip LLM
//
import { Database } from "bun:sqlite";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getRuntimePaths } from "../src/paths.ts";

type Strategy = "all" | "first_k" | "last_k" | "first_last";

interface CliArgs {
  rootEventId?: number;
  strategy: Strategy;
  k: number;
  firstK: number;
  lastK: number;
  model: string;
  list: boolean;
  raw: boolean;
}

const SYSTEM_PROMPT = `You are summarizing a chat thread between local agents.
Output 2-4 sentences covering: what was discussed, who participated, and any decision or open question.
Do not include preamble, headings, or quotes.`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    strategy: "first_k",
    k: 3,
    firstK: 5,
    lastK: 10,
    model: process.env.SYNCHRONIZE_LLM_MODEL ?? "anthropic/claude-haiku-4.5",
    list: false,
    raw: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--root-event-id": args.rootEventId = Number(next()); break;
      case "--strategy": args.strategy = next() as Strategy; break;
      case "--k": args.k = Number(next()); break;
      case "--first-k": args.firstK = Number(next()); break;
      case "--last-k": args.lastK = Number(next()); break;
      case "--model": args.model = next(); break;
      case "--list": args.list = true; break;
      case "--raw": args.raw = true; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`summarize-thread (V0 spike for sync-b8q)

Usage:
  --list                            list discoverable threads from the running daemon
  --root-event-id N                 thread root event id to summarize (required unless --list)
  --strategy all|first_k|last_k|first_last   message selection strategy (default: first_k)
  --k N                             k for first_k / last_k (default: 3)
  --first-k N                       first k for first_last (default: 5)
  --last-k N                        last k for first_last (default: 10)
  --model NAME                      OpenRouter model id (default: anthropic/claude-haiku-4.5)
  --raw                             print transcript only, skip LLM call
  -h, --help

Env:
  OPENROUTER_API_KEY                required unless --raw or --list
  SYNCHRONIZE_LLM_MODEL             overrides default model
`);
}

interface ThreadEvent {
  event_id: number;
  sender_peer_id: string | null;
  body: string | null;
  parent_event_id: number | null;
  created_at: string;
}

interface ThreadMeta {
  root_event_id: number;
  group_name: string;
  reply_count: number;
  participant_count: number;
  aliases: Map<string, string>;
}

function openDb(): Database {
  const paths = getRuntimePaths();
  const db = new Database(paths.dbPath, { readonly: true });
  db.exec("PRAGMA query_only = ON;");
  return db;
}

function loadThread(db: Database, rootEventId: number): { events: ThreadEvent[]; meta: ThreadMeta } {
  const root = db
    .prepare(
      `SELECT e.event_id, e.sender_peer_id, e.body, e.parent_event_id, e.created_at,
              g.name AS group_name
       FROM events e
       LEFT JOIN groups g ON g.group_id = e.group_id
       WHERE e.event_id = ? AND e.type = 'group_message' AND e.parent_event_id IS NULL`,
    )
    .get(rootEventId) as (ThreadEvent & { group_name: string }) | null;
  if (!root) {
    throw new Error(`no root group_message event with id=${rootEventId}`);
  }
  const replies = db
    .prepare(
      `SELECT event_id, sender_peer_id, body, parent_event_id, created_at
       FROM events
       WHERE parent_event_id = ? AND type = 'group_message'
       ORDER BY event_id ASC`,
    )
    .all(rootEventId) as ThreadEvent[];

  const events: ThreadEvent[] = [
    { event_id: root.event_id, sender_peer_id: root.sender_peer_id, body: root.body, parent_event_id: null, created_at: root.created_at },
    ...replies,
  ];

  const peerIds = new Set<string>();
  for (const e of events) if (e.sender_peer_id) peerIds.add(e.sender_peer_id);
  const aliases = new Map<string, string>();
  if (peerIds.size > 0) {
    const rows = db
      .prepare(
        `SELECT peer_id, session_name FROM peers WHERE peer_id IN (${[...peerIds].map(() => "?").join(",")})`,
      )
      .all(...peerIds) as Array<{ peer_id: string; session_name: string | null }>;
    for (const r of rows) aliases.set(r.peer_id, r.session_name ?? r.peer_id);
  }

  return {
    events,
    meta: {
      root_event_id: rootEventId,
      group_name: root.group_name,
      reply_count: replies.length,
      participant_count: peerIds.size,
      aliases,
    },
  };
}

function selectEvents(events: ThreadEvent[], args: CliArgs): ThreadEvent[] {
  // events come back chronologically from /threads/:id (root first, then replies).
  const root = events[0];
  const replies = events.slice(1);
  if (!root) return [];

  switch (args.strategy) {
    case "all":
      return events;
    case "first_k":
      return [root, ...replies.slice(0, args.k)];
    case "last_k":
      return [root, ...replies.slice(Math.max(0, replies.length - args.k))];
    case "first_last": {
      const first = replies.slice(0, args.firstK);
      const last = replies.slice(Math.max(0, replies.length - args.lastK));
      const seen = new Set<number>();
      const merged: Event[] = [];
      for (const e of [...first, ...last]) {
        if (!seen.has(e.event_id)) {
          seen.add(e.event_id);
          merged.push(e);
        }
      }
      merged.sort((a, b) => a.event_id - b.event_id);
      return [root, ...merged];
    }
  }
}

function renderTranscript(events: ThreadEvent[], meta: ThreadMeta): string {
  const lines: string[] = [];
  lines.push(`# Thread root=${meta.root_event_id} group=${meta.group_name}`);
  lines.push(`# participants=${meta.participant_count} replies=${meta.reply_count}`);
  lines.push("");
  for (const e of events) {
    const who = e.sender_peer_id ? (meta.aliases.get(e.sender_peer_id) ?? e.sender_peer_id) : "(system)";
    const tag = e.event_id === meta.root_event_id ? "ROOT" : "reply";
    lines.push(`[${tag}] ${who} @ ${e.created_at}`);
    lines.push((e.body ?? "").trim());
    lines.push("");
  }
  return lines.join("\n");
}

function doList(): void {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT root.event_id AS root_event_id,
                g.name AS group_name,
                COUNT(reply.event_id) AS reply_count,
                MAX(reply.created_at) AS last_activity_at,
                COALESCE(p.session_name, root.sender_peer_id) AS who,
                substr(root.body, 1, 60) AS preview
         FROM events root
         JOIN groups g ON g.group_id = root.group_id
         LEFT JOIN peers p ON p.peer_id = root.sender_peer_id
         JOIN events reply ON reply.parent_event_id = root.event_id AND reply.type = 'group_message'
         WHERE root.type = 'group_message' AND root.parent_event_id IS NULL
         GROUP BY root.event_id
         ORDER BY last_activity_at DESC
         LIMIT 50`,
      )
      .all() as Array<{
        root_event_id: number;
        group_name: string;
        reply_count: number;
        last_activity_at: string;
        who: string | null;
        preview: string | null;
      }>;
    if (rows.length === 0) {
      console.log("(no discoverable threads — need at least one root group_message with a reply)");
      return;
    }
    for (const r of rows) {
      const preview = (r.preview ?? "").replace(/\n/g, " ");
      console.log(
        `root=${r.root_event_id}  group=${r.group_name}  replies=${r.reply_count}  by=${r.who ?? "(unknown)"}  last=${r.last_activity_at}`,
      );
      console.log(`    ${preview}`);
    }
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    doList();
    return;
  }
  if (args.rootEventId === undefined || !Number.isFinite(args.rootEventId)) {
    console.error("--root-event-id is required (or pass --list to discover threads)");
    process.exit(2);
  }

  const db = openDb();
  let events: ThreadEvent[];
  let meta: ThreadMeta;
  try {
    ({ events, meta } = loadThread(db, args.rootEventId));
  } finally {
    db.close();
  }
  const selected = selectEvents(events, args);
  const transcript = renderTranscript(selected, meta);

  console.error(
    `[spike] root=${args.rootEventId} strategy=${args.strategy} ` +
    `selected=${selected.length}/${events.length} bytes=${transcript.length}`,
  );

  if (args.raw) {
    process.stdout.write(transcript + "\n");
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not set — pass --raw to dump transcript without calling the LLM");
    process.exit(2);
  }

  const openrouter = createOpenRouter({ apiKey });
  const started = Date.now();
  const result = await generateText({
    model: openrouter(args.model),
    system: SYSTEM_PROMPT,
    prompt: transcript,
  });
  const elapsed = Date.now() - started;

  console.error(`[spike] model=${args.model} elapsed_ms=${elapsed}`);
  if (result.usage) {
    console.error(`[spike] usage=${JSON.stringify(result.usage)}`);
  }
  process.stdout.write(result.text.trim() + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
