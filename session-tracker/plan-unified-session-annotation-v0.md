# Plan — Unified session annotation (v0)

> Status: design draft (2026-06-27). No branch yet.
> Supersedes the two prototype branches `codex/pi-session-log-parser` and
> `codex/claude-session-log-parser` — neither is merged as-is; they are the
> spec for a single TS-in-daemon implementation.

## Problem

We want one system that parses agent session transcripts (Claude, Pi, later
Codex and others) into a uniform, richly-annotated record set, stored durably,
so transcripts can be requested on demand and become the baseline for a future
RAG stack over synchronize sessions. It must be cross-machine-robust and let us
plug in new agents incrementally.

Two prototype branches built parsers independently in **Python**:

- `codex/pi-session-log-parser` — `scripts/integration-aoe/sync_itest_aoe/pi_session/annotation.py` (~567 lines) + thin CLI `scripts/pi-session-annotate.py`. Lives **inside the AOE integration harness** because that harness spawns Pi agents with a per-session custom home; this coupling is **incidental to testing**, not how the product should work.
- `codex/claude-session-log-parser` — freestanding `scripts/session_annotation/claude.py` (~674 lines) + CLI `scripts/claude-session-annotate.py`.

## Core insight: they already converged

Written without sharing code, the two parsers landed on **the same design**:

- **Same annotation record** — 20 fields, 18 identical. Only the id fields differ: Pi `entry_id`/`parent_id` vs Claude `uuid`/`parent_uuid`/`session_id`.
- **Same categories** — session, runtime, message, assistant, user, tool, mcp, synchronize, unknown (Claude adds attachment, system).
- **Same tool taxonomy** — shell / filesystem / web / mcp(+agent), normalize MCP names (`mcp__server__tool` / `synchronize_bridge_*`), infer server.
- **Same synchronize XML extraction** — regex over `<channel …>` / `<synchronize_event …>` in message text.
- **Same outputs** — JSON / JSONL / CSV / summary-only.
- **Same storage layout** — `session-tracker/<agent>-session-annotations/<id>/{summary.json, annotations.jsonl, annotations.csv, README.md}`.

So the generic solution is an **extraction, not a build**. The agent-specific
surface is tiny: (1) locate the transcript, (2) decode one JSONL record →
`Annotation[]`, (3) a tool-taxonomy table. Everything else is shared.

## Core insight: the daemon already does the hard part

`agent_sessions` (in `src/db.ts`, populated by `src/cli/commands/hook.ts` and
`src/daemon/routes/agent-sessions.ts`) already stores, for every registered
Claude/Pi session:

- `binding_id` (PK) and the natural key `UNIQUE(host_tool, host_session_id)` — **the cross-machine identity**.
- `host_session_file` — Claude `transcript_path` / Pi session file — **the per-machine transcript locator**, already resolved at hook time.
- `cwd`, `model`, `agent_type`, `source`, `launch_id`, `peer_id`, `metadata_json`.

This means the primary locator is solved: the unified parser reads
`host_session_file` for the binding. No need to reconstruct paths for the common
case, and the Pi parser does **not** need to live in the integration harness.

## Decisions taken (2026-06-27)

1. **Language home: port into the TS daemon.** Rewrite both decoders in
   TypeScript inside the daemon. The Python branches are the behavioral spec
   (port their fixtures/tests as golden cases), not merged code.
2. **No CASS fork — synchronize owns its annotation layer.** CASS
   (`~/Codes/Personal/cass`) already does SQLite-catalog + Tantivy + opt-in
   vector over Claude/Codex/Gemini/Cursor sessions, and it's the proven
   reference we borrow patterns from. But synchronize's annotations are tied to
   *its* world (`binding_id`, `launch_id`, groups, peers, synchronize-events) as
   the bus's own RAG baseline, so we own the schema/store and reuse CASS's
   discipline, not its codebase.
3. **Architecture: a data lake + reverse indexes over it.** The system-of-record
   is an immutable, append-only annotation corpus (the "lake"); every retrieval
   path is a *derived, rebuildable reverse index* over it — metadata indexes
   (exact-match facets), content indexes (body terms), and later vector/graph
   indexes. Indexes are disposable projections; the lake is truth.
4. **v0 scope is deliberately small: tables + schema + query layer.** v0 builds
   the store and a basic SQLite-backed query layer (exact-match facet filters,
   `LIKE` body search, ±N windowing). It does **not** build Tantivy, FTS5,
   vectors, RRF, blob files, or consolidation. The job of v0 is to get the
   *schema and the engine-neutral query contract* right so those later indexes
   are cheap adds, not rewrites.
5. **This task: plan + bd issues only.** No implementation until the plan is
   reviewed.

## Design influences (prior art studied 2026-06-27)

Five session/agent-memory systems were studied; they converge on one spine,
which this plan adopts. CASS (`~/Codes/Personal/cass`): SQLite catalog +
**Tantivy as single FTS authority** + opt-in vector; chunk = one record;
window-expand at query time; bounded query funnel (aggregate → project →
truncate → chain → drill). Tantivy: INDEXED/STORED/FAST field flags;
exact-match (raw `STRING`) **and** tokenized (`en_stem`) text as two fields;
span/window is *not* native — carry `seq`/`turn_index` as fast fields, expand
outside the index. Hindsight (Vectorize.io): narrative-grade self-contained
records; occurrence-interval + mention-time split; multi-strategy recall + RRF;
enrich in **batch over the lake, off the write path**. Supermemory / MemPalace:
embed at record granularity; keep text **verbatim** (compression cost 12pp
recall); composite rerank (`sim + log(usage) + recency/centrality`) beats pure
NN. AgentMemory: two-tier query API — cheap **`recall`** (pure BM25 + filters +
token budget) vs **`smart_search`** (triple-stream RRF, K=60, weights
renormalized so it degrades to BM25-only when vectors are absent); progressive
disclosure (`expandIds`); scope on a **stable project slug, never a path**;
version/supersede chains on derived records. v0 implements only the cheap
`recall`-equivalent; the rest are the documented later rungs.

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TRANSCRIPTS  (host-owned, one per session, per machine)                   │
│  Claude  ~/.claude/projects/<enc-cwd>/<session_id>.jsonl                   │
│  Pi      ~/.pi/agent/sessions/<slug(cwd)>/<ts>_<session_id>.jsonl          │
│  Codex   … (later: add one decoder)                                        │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ host_session_file  (already stored in agent_sessions at hook time)
                ▼
        ┌────────────────┐   decoder picked by host_tool
        │ PARSER          │   DECODERS = { claude, pi, … }
        │ src/annotate/   │   reader(offset) → decode(record) → Annotation[]
        └───────┬─────────┘   incremental + idempotent (resume from byte offset)
                ▼
╔════════════════════════════════════════════════════════════════════════════╗
║  THE LAKE  — system of record (immutable, append-only, per-session)   [v0]   ║
║  session_annotations(binding_id, seq, turn_index, ts_ms, category, kind,     ║
║                      tool, normalized_tool, …, summary, text, data_json)     ║
║  session_annotation_state(binding_id, project, …rollups…, annotated_offset)  ║
╚═══════════════╤══════════════════════════════════════════════════════════════╝
                │ derived, REBUILDABLE projections — never the source of truth
   ┌────────────┼─────────────────────────┬──────────────────────┐
   ▼            ▼                          ▼                      ▼
┌─────────┐ ┌───────────────┐     ┌────────────────┐    ┌────────────────┐
│METADATA │ │ CONTENT        │     │ VECTOR / GRAPH │    │ CATALOG ROLLUPS│
│indexes  │ │ index          │     │ index          │    │ filter-first   │
│SQLite   │ │ v0: LIKE scan  │     │ post-v0        │    │ by_tool/kind/… │
│B-trees  │ │ → FTS5         │     │ RRF (K=60)     │    │                │
│  [v0]   │ │ → Tantivy      │     │                │    │      [v0]      │
└────┬────┘ └──────┬─────────┘     └───────┬────────┘    └───────┬────────┘
     └─────────────┴──── key = (binding_id, seq) ────────────────┘
                                  │
                                  ▼
                  ┌─────────────────────────────────┐
                  │ QUERY LAYER (engine-neutral spec) │
                  │ AnnotationQuery → executor        │
                  │ v0: SQLite   later: +index, RRF   │
                  └───────────────┬───────────────────┘
              ┌───────────────────┴────────────────────┐
              ▼                                         ▼
     POST /annotations/query                   synchronize annotate query
     (client.ts → daemon route)                (cli/commands/annotate.ts)
```

`[v0]` marks what this plan builds. Everything unmarked is a later rung the
schema already supports — added without touching the lake or the query API.

## Cross-machine model

- **Identity = `(host_tool, host_session_id)`** (via `binding_id`). Portable,
  opaque, machine-agnostic.
- **Location is never identity.** `host_session_file` stays in `agent_sessions`,
  local to the machine, never exported into annotations or summaries.
- **No absolute paths in stored/exported artifacts.** The prototypes' biggest
  wart — every annotation and `summary.json` embeds
  `/Users/abhirupdas/.pi/agent/sessions/…`. Drop it. The git-tracked
  `session-tracker/*-session-annotations/*/summary.json` samples are historical
  only and will not be the format going forward.
- **Fallback locator** (for sessions not registered via synchronize, or
  historical import) is a per-tool resolver, used only when `host_session_file`
  is absent:
  - **Pi:** `${PI_CODING_AGENT_SESSION_DIR:-~/.pi/agent/sessions}/<slug(cwd)>/*_<session_id>.jsonl`, where `slug(cwd) = "--" + cwd.lstrip("/").replace("/","-") + "--"`. `PI_CODING_AGENT_SESSION_DIR` is independent of `PI_CODING_AGENT_DIR` and is the only knob that moves the sessions root. (The AOE harness override of `PI_CODING_AGENT_DIR` per session is a test artifact and irrelevant here.)
  - **Claude:** `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` — confirm exact encoding during implementation.
  - Session-id-alone glob (`**/*_<session_id>.jsonl`) works as a last resort but scans all cwds.

```
   IDENTITY  (portable — travels with the lake)     LOCATION  (per machine — never exported)
   ──────────────────────────────────────────     ─────────────────────────────────────────
   (host_tool, host_session_id)                    agent_sessions.host_session_file
     ("claude", "abc123")  ──┐                       machine A: /Users/abhi/.claude/…/abc123.jsonl
                             ├─▶ binding_id ◀──┐      machine B: /home/bob/.claude/…/abc123.jsonl
   session_annotations rows ─┘  (stable key)   └───── resolved locally, on demand
            │
            ▼  every annotation keys on binding_id ONLY → copy the lake to another
               machine and it still resolves; no absolute path is ever stored in a row.
```

## Schema (new migration in `src/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS session_annotations (
  binding_id      TEXT NOT NULL REFERENCES agent_sessions(binding_id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,   -- annotation-grain monotonic order within session
  turn_index      INTEGER NOT NULL,   -- message/turn-grain order; shared by every annotation from one message
  ts_ms           INTEGER,            -- epoch milliseconds; range-queryable (NULL if record has no timestamp)
  line_number     INTEGER NOT NULL,
  category        TEXT NOT NULL,      -- session|runtime|message|assistant|user|tool|mcp|synchronize|attachment|system|unknown
  kind            TEXT NOT NULL,
  record_type     TEXT,
  role            TEXT,
  uuid            TEXT,               -- canonical id (Pi entry_id maps here)
  parent_uuid     TEXT,
  content_index   INTEGER,
  tool            TEXT,
  normalized_tool TEXT,
  tool_call_id    TEXT,
  tool_server     TEXT,
  source          TEXT,
  is_error        INTEGER,
  summary         TEXT,
  text            TEXT,               -- body, stored INLINE in v0 so LIKE needs no join
  est_tokens      INTEGER,            -- cheap len/4 estimate, for token-budgeted chunk assembly
  data_json       TEXT,               -- structured extras
  PRIMARY KEY (binding_id, seq)
);
-- v0 reverse indexes = SQLite B-trees on the exact-match facets:
CREATE INDEX IF NOT EXISTS idx_sa_ts   ON session_annotations(binding_id, ts_ms);    -- time-window slices
CREATE INDEX IF NOT EXISTS idx_sa_turn ON session_annotations(binding_id, turn_index); -- N-messages-around-a-hit
CREATE INDEX IF NOT EXISTS idx_sa_kind ON session_annotations(binding_id, kind);
CREATE INDEX IF NOT EXISTS idx_sa_tool ON session_annotations(tool);
CREATE INDEX IF NOT EXISTS idx_sa_cat  ON session_annotations(category);
CREATE INDEX IF NOT EXISTS idx_sa_ntool ON session_annotations(normalized_tool);
CREATE INDEX IF NOT EXISTS idx_sa_role ON session_annotations(role);
```

> **v0 text-inline note.** `text` is a column on `session_annotations` so `LIKE`
> body search works with no join. When the content reverse index (FTS5/Tantivy)
> arrives, `text` moves to a `session_annotation_text(binding_id, seq, text)`
> sidecar that the index hydrates from — at which point the facet table stays
> narrow. `// ponytail: inline now, split when an index hydrates from it`.

### Catalog row (the promoted `summary.json`)

One row per session = locator-join + provenance + rollups. This is the
filter-first surface (AgentMemory's `Session`, CASS's `conversations`).

```sql
CREATE TABLE IF NOT EXISTS session_annotation_state (
  binding_id        TEXT PRIMARY KEY REFERENCES agent_sessions(binding_id) ON DELETE CASCADE,
  project           TEXT,    -- stable slug, distinct from agent_sessions.cwd (path) — never conflate
  schema_version    INTEGER NOT NULL,
  parser_version    TEXT NOT NULL,    -- per-agent decoder version → idempotent re-ingest (CASS schema_hash idea)
  content_hash      TEXT,             -- of source transcript bytes parsed
  annotated_offset  INTEGER NOT NULL DEFAULT 0,  -- byte offset already parsed (JsonlTail offset; tolerates partial trailing line)
  annotated_lines   INTEGER NOT NULL DEFAULT 0,
  annotation_count  INTEGER NOT NULL DEFAULT 0,
  ts_min            INTEGER, ts_max INTEGER,
  by_category_json  TEXT, by_kind_json TEXT, by_tool_json TEXT,  -- precomputed rollups
  diagnostics_count INTEGER NOT NULL DEFAULT 0,
  annotated_at      TEXT
);
```

Provenance (`agent_type`/`host_tool`, `source`, `origin_host`) lives on the
existing `agent_sessions` row; the query layer JOINs to it. Diagnostics
(malformed lines) are counted here; a dedicated table is deferred.

### Worked example — `session_annotations` rows

One Claude turn-pair decoded. Note how a single assistant *message* (turn_index 1)
explodes into many *annotation* rows (seq 1–3), and how an MCP call is normalized.
`text`/`data_json` abbreviated for width.

| binding_id | seq | turn_index | ts_ms | category | kind | role | tool | normalized_tool | tool_server | is_error | summary | text (excerpt) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude:abc | 0 | 0 | 1719…001 | user | user_message | user | — | — | — | — | "fix the beads sync bug" | fix the beads sync bug… |
| claude:abc | 1 | 1 | 1719…014 | assistant | assistant_thinking | assistant | — | — | — | — | "The push hook likely…" | The push hook likely fails when… |
| claude:abc | 2 | 1 | 1719…014 | assistant | assistant_text | assistant | — | — | — | — | "Let me check the hook." | Let me check the hook. |
| claude:abc | 3 | 1 | 1719…015 | tool | shell_tool_call | assistant | Bash | Bash | — | — | "git log -S beads-" | {cmd:"git log -S 'beads-'"} |
| claude:abc | 4 | 2 | 1719…190 | tool | tool_result | tool | Bash | Bash | — | 0 | "3 commits matched" | beads-7f… beads-9a… |
| claude:abc | 5 | 3 | 1719…210 | mcp | mcp_tool_call | assistant | mcp__synchronize__bridge_reply | bridge_reply | synchronize | — | "reply: found it" | {body:"found it, the %beads- prefix…"} |
| claude:abc | 6 | 3 | 1719…240 | synchronize | synchronize_event | — | — | — | — | — | "evt#812 group dev" | <channel …>found it…</channel> |

Reads off the example: `where tool='Bash'` → seq 3,4 · `where normalized_tool='bridge_reply'`
→ seq 5 · `where body LIKE '%beads-%'` → seq 3,4,5 · `±1 window around seq 5` → seq 4,5,6.

### Worked example — `session_annotation_state` row

The promoted `summary.json` — one row per session, the filter-first surface:

| column | value |
|---|---|
| binding_id | `claude:abc` |
| project | `synchronize` *(slug — NOT the cwd path)* |
| schema_version | `1` |
| parser_version | `claude-decoder@0.1.0` |
| content_hash | `sha256:9f2c…` |
| annotated_offset / annotated_lines | `48211` / `517` |
| annotation_count | `1464` |
| ts_min / ts_max | `1719…001` / `1719…998` |
| by_category_json | `{"tool":585,"message":512,"assistant":185,"mcp":90,"synchronize":42,"user":45,"runtime":4,"session":1}` |
| by_kind_json | `{"shell_tool_call":114,"mcp_tool_call":45,"assistant_thinking":157,…}` |
| by_tool_json | `{"bash":228,"read":94,"bridge_reply":72,"edit":38,…}` |
| diagnostics_count | `0` |
| annotated_at | `2026-06-27T13:40:11Z` |

Use cases this row serves *without touching the lake*: "which sessions used
`bridge_reply`?" (scan `by_tool_json`) · "sessions in project `synchronize`
between two times" (`project` + `ts_min/max`) · "did parsing this session have
errors?" (`diagnostics_count`) · "is the index stale vs the transcript?"
(`content_hash` / `annotated_offset` vs current file).

## Storage & retrieval model: lake + reverse indexes

**The lake (system of record).** The annotation corpus is immutable,
append-only, per-session-partitioned. In v0 it lives in the
`session_annotations` SQLite table; post-v0 it can also materialize as
per-session blob files (`~/.synchronize/annotations/<agent>/<date>/<binding_id>.parquet|jsonl`)
that DuckDB/Polars/Tantivy read directly. Either way the rows are the source of
truth, and **everything else is a derived, rebuildable reverse index over them.**

**Reverse indexes (derived, disposable, many).** A reverse index maps a
predicate → postings of `(binding_id, seq)` back into the lake. There are
several kinds, added as needed; the lake makes each one rebuildable from scratch:

- **Metadata indexes** — exact-match facets (`tool`, `category`, `kind`,
  `normalized_tool`, `role`, `is_error`, `ts_ms`, `turn_index`). In v0 these are
  just **SQLite B-tree indexes** on the columns. That *is* the reverse index for
  `where tool = 'bridge_reply'`.
- **Content indexes** — body terms ("messages with `debugging` in the body").
  v0 serves this with a `LIKE` scan (narrowed by a metadata index first). The
  foundation for a real content reverse index is **FTS5** (SQLite's built-in
  inverted index, still no new dependency) and later **Tantivy** (tokenized +
  ranked, cross-corpus) — both rebuilt from the lake, neither needed in v0.
- **Vector / graph indexes** — semantic + entity retrieval, fused via RRF
  (K=60). Post-v0; keyed by the same `(binding_id, seq)` so they compose.

**Two grains, one session** — why we carry both `seq` and `turn_index`:

```
SESSION binding_id = claude:abc
│ turn_index   seq   kind                (one message → many annotation rows)
├─ 0 ───────── 0 ──  user_message
├─ 1 ──┬────── 1 ──  assistant_thinking
│      ├────── 2 ──  assistant_text
│      └────── 3 ──  shell_tool_call      tool=Bash
├─ 2 ───────── 4 ──  tool_result          is_error=0
├─ 3 ──┬────── 5 ──  mcp_tool_call        normalized_tool=bridge_reply
│      └────── 6 ──  assistant_text
└─ …
   "find the call ±2 MESSAGES"  → window on turn_index  (3±2 ⇒ turns 1..5)
   "find the call ±2 BLOCKS"    → window on seq         (5±2 ⇒ seq 3..7)
   "what happened 13:40–13:43"  → range on ts_ms
```

**Ordering keys make windows engine-portable.** We store atoms + the keys any
chunker/window needs — `seq` (annotation grain), `turn_index` (message grain,
what "N messages" counts on), `ts_ms` (wall clock) — and assemble spans at query
time. No precomputed chunks (chunking strategy will churn). Stable doc id
`binding_id || ':' || seq` is the future Tantivy/ES `_id`. So adding any external
index is a denormalizing `SELECT` (facet row + text + `agent_sessions` columns →
one flat doc), never a schema change. `// ponytail: lake is truth; indexes are rebuildable projections; add each when its query class is real`.

## v0 query layer

**Approach: an engine-neutral query spec, SQLite executor in v0.** The
foundational decision is not *which engine* — it's defining the query contract so
a future Tantivy/vector backend swaps in **without changing the API or callers**.
v0 implements only AgentMemory's cheap `recall` tier (exact filters + body match
+ window); the hybrid `smart_search` tier is the later rung against the same spec.

```ts
type AnnotationQuery = {
  session?: string;     // session_id | alias | binding_id → resolved to binding_id via agent_sessions
  where?: { field: Dimension; op: "eq" | "like"; value: string }[];  // field allowlisted to known columns
  window?: number;      // ±N rows around each match, by seq
  limit?: number;       // bounded output by default (the query funnel)
};
```

`field` is validated against a fixed column allowlist (the injection boundary);
values are always parameterized. The three first-class sample queries:

```text
all messages in session abc where tool = "bridge_reply"
all messages in def where body like '%DEBUG%'
find message and ±N rows where tool = "bridge_reply" and body LIKE '%beads-'
```

map to specs/SQL:

```sql
-- (1) session + exact facet  → indexed
SELECT * FROM session_annotations WHERE binding_id = :b AND tool = 'bridge_reply' ORDER BY seq LIMIT :lim;

-- (2) session + body substring → LIKE (v0 semantic is literal substring, not tokenized)
SELECT * FROM session_annotations WHERE binding_id = :b AND text LIKE '%DEBUG%' ORDER BY seq LIMIT :lim;

-- (3) hit (exact facet AND body) + ±N window — one CTE
WITH hits AS (
  SELECT binding_id, seq FROM session_annotations
  WHERE tool = 'bridge_reply' AND text LIKE '%beads-%'      -- metadata index narrows before LIKE
)
SELECT a.*, h.seq AS hit_seq
FROM hits h JOIN session_annotations a
  ON a.binding_id = h.binding_id AND a.seq BETWEEN h.seq - :N AND h.seq + :N
ORDER BY h.binding_id, h.seq, a.seq;
```

The window CTE is the load-bearing shape: when a content index arrives, **only
the `hits` CTE is replaced** by an index lookup returning `(binding_id, seq)`;
the seq-range expansion stays identical SQL forever. ("Index finds, SQLite does
adjacency" — in v0 SQLite does both halves.)

```
query 3:  tool='bridge_reply' AND text LIKE '%beads-'   window N=2
                                                    │
  hits CTE  ─────────────────────────────────────▶ seq = 5   (binding claude:abc)
                                  expand a.seq BETWEEN 5-2 AND 5+2
   seq:    3        4       [ 5 ]        6        7
         ┌──────┬──────┬═══════════┬──────────┬──────┐
         │shell │tool_ │   HIT     │assistant │ (next│   ← returned as ONE window
         │_call │result│bridge_repl│  _text   │ row) │     hit_seq=5 marks centre
         └──────┴──────┴═══════════┴──────────┴──────┘
   later: replace only the hits CTE with `idx.search(...) → (binding_id,seq)`;
          this expansion block is unchanged.
```

**Worked example — spec in, rows out (query 3):**

```jsonc
// request
{ "where": [ { "field": "normalized_tool", "op": "eq",   "value": "bridge_reply" },
             { "field": "text",            "op": "like", "value": "%beads-%" } ],
  "window": 2, "limit": 50 }

// response  (grouped per hit; each row is a full annotation; hit_seq flags the centre)
[ { "hit_seq": 5, "rows": [
      { "seq": 3, "kind": "shell_tool_call",  "tool": "Bash",         "summary": "git log -S beads-" },
      { "seq": 4, "kind": "tool_result",      "is_error": 0,          "summary": "3 commits matched" },
      { "seq": 5, "kind": "mcp_tool_call",    "normalized_tool": "bridge_reply", "summary": "reply: found it" },
      { "seq": 6, "kind": "assistant_text",                           "summary": "I'll patch the prefix check" },
      { "seq": 7, "kind": "shell_tool_call",  "tool": "Edit",         "summary": "edit pre-push hook" } ] } ]
```

The same spec with `window` omitted returns just the hit rows; with `session`
set it scopes to one binding; with only a `where` of `op:"eq"` it is a pure
indexed facet filter (query 1).

**Deliberate v0 calls (ponytail):** `LIKE` substring is the literal v0 semantic
(`%DEBUG%`, `%beads-`); **not** FTS5 (which does tokenized match, not arbitrary
substring, so it wouldn't even serve these). No string DSL — the structured spec
covers all three; a `tool=x and body~y` parser→spec is a clean later add. `text`
inline (above) so `LIKE` needs no join.

**Wiring (follows the existing daemon pattern — CLI is a thin REST client):**

- `src/annotate/query.ts` — spec → SQL builder + executor (allowlist, params, the CTE) + a **session resolver** (session_id | alias | binding_id → binding_id via `agent_sessions`).
- `src/daemon/routes/annotations.ts` — `POST /annotations/query` (body = spec) and `POST /agent-sessions/:binding/annotate` (ingest from offset); wired into `src/daemon/routing.ts` via the `tryHandle…` pattern.
- `src/client.ts` — `queryAnnotations(spec)`, `annotateSession(binding)`.
- `src/cli/commands/annotate.ts` — `synchronize annotate <session>` (ingest) and `synchronize annotate query …` (query); dispatch case in `src/cli/index.ts`, help in `src/cli/schema.ts`.

## Parser core (new `src/annotate/`)

```
 host_session_file ──read from annotated_offset──▶ reader.ts (JsonlTail)
   (resume; tolerate partial trailing line)            │  {line, line_number}
                                                        ▼
                                       decoder = DECODERS[host_tool]      ← only agent-specific part
                                          decode(record, ctx) → Annotation[]   (format-only fields:
                                                        │                        category/kind/role/tool/…)
                                                        ▼
                              writer (index.ts) assigns the cross-cutting keys
                              seq++  ·  turn_index (bump per top-level message)
                              ts_ms  ·  est_tokens  ·  text inline
                                                        │  ONE transaction
                                         ┌──────────────┴───────────────┐
                                         ▼                               ▼
                              session_annotations rows      session_annotation_state
                                                            (advance offset, refresh rollups)
```

- `types.ts` — `Annotation` interface (canonical fields above), `Decoder` type, `Diagnostic`.
- `classify.ts` — shared tool classifier parameterized by a per-agent taxonomy table; shared synchronize XML extractor (`CHANNEL_RE` + `SYNC_EVENT_RE`).
- `reader.ts` — incremental, offset-based JSONL reader (port `JsonlTail`; handles partial trailing line + records parse diagnostics).
- `decoders/claude.ts` — `decode(record, ctx) => Annotation[]` (port `claude.py` record-type handlers).
- `decoders/pi.ts` — `decode(record, ctx) => Annotation[]` (port `annotation.py`; map `entry_id`→`uuid`, `parent_id`→`parent_uuid`).
- `index.ts` — `const DECODERS: Record<HostTool, Decoder> = { claude, pi }`; `annotateSession(bindingId)` reads `host_session_file` from `annotated_offset`, decodes, writes rows in a transaction, advances offset, updates the catalog rollups. The writer owns the cross-cutting ordering keys (decoders stay format-only): assign `seq` (running counter), bump `turn_index` per top-level message record, normalize timestamps to `ts_ms`, compute `est_tokens`, and write `text` inline on the row (v0).

**Pluggability = add `decoders/<agent>.ts` + one map entry + a taxonomy.** No
base class, no plugin registry — a typed map and a fixed function signature.

(The route + CLI + client wiring for ingest and query is in **v0 query layer**
above.)

## Out of scope for v0

- **Content reverse index** (FTS5/Tantivy) and tokenized/ranked body search — v0 uses `LIKE`. FTS5 is the no-dependency next rung; Tantivy (Rust sidecar, per the research) is the cross-corpus rung. Both rebuilt from the lake.
- **Vector / graph indexes, RRF fusion, the hybrid `smart_search` tier, reranking, embeddings.** v0 ships only the cheap `recall`-equivalent.
- **Per-session blob files (Parquet/JSONL lake materialization).** v0's lake is the SQLite table; blob files are an additive export when corpus scale or external-tool (DuckDB/Tantivy) access demands it — schema already supports it.
- **Consolidation / derived-rollup tier** (session summaries, per-project profiles, cross-session insights) and version/supersede chains — batch passes over the lake, post-v0.
- Live tailing of active sessions (v0 is on-demand / stop-hook-triggered; the offset reader makes live tail a cheap later add).
- Codex and other agents' decoders (they slot in later with one module each).
- Re-homing the Pi prototype out of the AOE harness — the harness keeps its own copy for integration assertions; the product parser is the new TS core.

## Open questions

1. Exact Claude `~/.claude/projects/<encoded-cwd>/` encoding for the fallback locator.
2. Ingest trigger for v0: explicit `synchronize annotate` only, vs auto-annotate on the SessionEnd/stop hook. (Lean: on-demand first, hook-triggered as a fast follow.)
3. Whether to drop the git-tracked absolute-path `summary.json` samples now or leave them as dated historical artifacts.
4. `project` slug derivation — reuse `launch_intents`/group context, or derive from `cwd` repo root? (Must stay distinct from the `cwd` path — AgentMemory burned a corruption-repair effort conflating them.)

## Verification

Port the two prototypes' test fixtures as TS golden tests:
`scripts/tests/test_claude_session_annotation.py` (5-record synthetic session)
and `test_pi_session_watcher.py::test_annotation_report_classifies_full_pi_session_shapes`.
A passing port = the TS decoders reproduce the Python classification exactly.
