# Session Annotation Architecture v1

Status: design plan, 2026-07-04
Tracker: sync-4v00

This plan describes the full architecture for session annotation in
Synchronize. It starts from the current proof-of-concept work for Claude and Pi
session transcripts, but the target architecture is broader: pluggable host
tools, incremental annotation, delayed human/model overlays, full-text indexes,
on-demand cross-machine status, and a path toward future distributed annotation
workers.

The immediate implementation should remain local-first and pragmatic. The code
should not pretend to be a distributed indexing platform in v1. The goal is to
choose interfaces and ownership boundaries that let us grow horizontally later
without rewriting the lake, decoders, query contract, or delayed annotation
model.

## Summary

The system has four kinds of data:

1. Host transcripts: raw files owned by tools such as Claude, Pi, Codex,
   Cursor, Gemini, or future custom agents.
2. Base annotations: immutable facts decoded from transcripts and stored in an
   annotation lake.
3. Derived annotations: computed facts such as model changes, effort changes,
   token usage deltas, active tool state, and status summaries.
4. Overlay annotations: mutable delayed annotations created by humans, models,
   rules, or imports, such as bookmarks, saved responses, tags, and notes.

Indexes are projections over this data. They are never the source of truth.

```text
                 host-owned transcripts
       Claude | Pi | Codex | Cursor | Gemini | custom
          \       |      |       |        |       /
           \      |      |       |        |      /
            v     v      v       v        v     v
        +---------------------------------------------+
        | transcript adapters                         |
        | locate, stat, read, fingerprint             |
        +---------------------+-----------------------+
                              |
                              v
        +---------------------------------------------+
        | annotation pipeline                         |
        | decode raw records -> derive runtime facts  |
        +---------------------+-----------------------+
                              |
                 +------------+------------+
                 |                         |
                 v                         v
        +-------------------+     +-------------------+
        | annotation lake   |     | overlay layer     |
        | immutable facts   |     | tags/bookmarks    |
        +---------+---------+     +---------+---------+
                  |                         |
                  +------------+------------+
                               |
                               v
        +---------------------------------------------+
        | query, status, retrieval, RAG projections    |
        +---------------------------------------------+
```

## Motivations

Synchronize is becoming a Slack-like workspace for long-running coding agents:
agents have rooms, threads, direct messages, identities, work state, launch
history, and eventually durable memory. The missing piece is a reliable way to
turn each agent's private host transcript into shared, queryable workspace
knowledge.

Today, the bus knows that an agent exists and may know what it sent through
Synchronize. The host transcript knows much more: what the user asked, what the
agent reasoned about, which tools it called, which MCP servers it used, how much
context it consumed, what model was active, where it compacted, which errors it
hit, and which pieces of bus traffic were injected into the session. Those facts
are trapped in host-specific log formats.

Session annotation exists to bridge that gap.

```text
without annotation:

  Synchronize room
      |
      | sees messages, peers, events
      v
  "agent said it is working"

  host transcript
      |
      | hidden inside Claude/Pi/Codex log format
      v
  actual tools, prompts, model, context, failures, decisions

with annotation:

  Synchronize room + host transcript
      |
      v
  shared annotation lake
      |
      v
  workspace memory, status, search, bookmarks, tags, retrieval
```

The architecture should encode several motivations.

### Make Long-running Agents Inspectable

A long-running coding agent may run for hours or days. It may compact context,
switch models, run hundreds of tools, receive bus messages, spawn subagents, or
keep working while the human is away. The workspace needs a passive inspection
surface that can answer:

- What is this agent doing right now?
- What was the last concrete file/tool/action it touched?
- Is it blocked, looping, waiting, or making progress?
- Which request or bus event triggered the current work?
- Did it change model, effort, or token profile midway?
- Which transcript region explains its current state?

This should be answerable without sending the agent a message and perturbing its
workflow.

```text
parent/user asks:
  "what is worker-3 doing?"
          |
          v
  annotation ensure/status
          |
          v
  latest transcript facts
          |
          v
  compact current activity view
```

### Make The Workspace Remember Work, Not Just Chat

Slack remembers messages. Synchronize needs to remember work.

Coding-agent work is not only chat text. It includes tool calls, diffs, failed
commands, hidden runtime metadata, model behavior, MCP interactions, generated
artifacts, and decisions spread across turns. A useful memory layer needs these
as structured facts, not just a giant transcript blob.

```text
message memory:
  "agent said: I will fix tests"

work memory:
  user request
  reasoning summary
  Bash command
  failing output
  Edit tool call
  test command
  passing output
  final response
  linked bus thread
  model and token usage
```

The annotation lake is the raw material for future memory, retrieval, handoffs,
and knowledge graphs.

### Preserve Host Diversity Without Forking Product Logic

Claude, Pi, Codex, Cursor, Gemini, and future custom agents will not share one
log format. A Slack-like multi-agent workspace cannot afford a separate
annotation/query/tagging/search stack per tool.

The product needs a single workspace-level model:

```text
Claude tool_use      \
Pi toolCall           \
Codex response item    --->  normalized annotation: tool call
Cursor action         /

Claude usage         \
Pi usage              --->  normalized annotation: token usage
future provider usage/

Claude channel text  \
Pi injected event     --->  normalized annotation: synchronize event
```

The host adapter should absorb format differences. The rest of the system
should stay shared.

### Support Human Curation And Model Curation

Long sessions contain many moments that matter later:

- a decision,
- a useful debugging trace,
- a reusable command,
- a subtle failure mode,
- a design discussion,
- a working prompt,
- a rejected approach,
- a final implementation checkpoint.

Humans should be able to bookmark or tag those regions. Models should also be
able to do delayed post-processing and add suggested tags. Those annotations
must remain filterable and retrievable without rewriting the base transcript.

```text
base annotation:
  seq 180..194 = assistant response about daemon routing

human overlay:
  bookmark "saved"
  tag "architecture/routing"

model overlay:
  tag "failure-mode/stale-thread-id"
  confidence 0.82
```

This gives Synchronize an Obsidian-like layer over agent work: human-readable
tags, saved responses, and later knowledge organization.

### Enable Passive Coordination Across Machines

Synchronize already points toward multi-machine agent collaboration. A parent
agent on one machine may need to inspect a worker running on another machine.
It should not need to DM the worker just to ask "what are you doing?" That kind
of message changes the worker's transcript and may distract it from the task.

Annotation gives the platform a control-plane path:

```text
Machine A parent
  asks Synchronize for worker status
        |
        v
Machine B daemon
  incrementally annotates worker transcript
        |
        v
Machine A receives status/query result
  no bus message sent to worker
```

This is a precursor to distributed execution, but does not require v1 to become
a distributed indexing service.

### Avoid Rework And Preserve Incremental Truth

The same active transcript may be inspected repeatedly by the UI, a parent
agent, a monitoring model, and a human. The system must not reparse the whole
file every time.

The architecture needs a durable cursor:

```text
first ensure:
  parse bytes 0..50 KB
  store offset 50 KB

second ensure:
  file unchanged
  return cached result

third ensure:
  file grew to 65 KB
  parse only bytes 50..65 KB
```

Incremental annotation is not an optimization afterthought. It is what makes
on-demand status cheap enough to use frequently.

### Prepare For Retrieval And RAG Without Locking Into One Engine

The product will eventually need search and retrieval over large bodies of
agent work:

- find all failures involving `bridge_reply`,
- find sessions where a model compacted after a token spike,
- retrieve the exact tool-output window around a test failure,
- summarize all decisions tagged `architecture/v1`,
- build a project memory from saved responses and implementation checkpoints.

SQLite filters are enough for v1. FTS5, Tantivy, vector search, and hybrid RAG
should be projections over the same lake, not rewrites of the data model.

## Use Cases Unlocked

### 1. Passive "What Is This Agent Doing?" Status

A user or parent agent opens a workspace and sees live agent activity without
interrupting the workers.

```text
agent row in UI:
  worker-api
  working on: session annotation query API
  active tool: Bash
  last command: bun test tests/session-annotation.test.ts
  model: claude-opus-4-8
  tokens recent: 42K input, 1.2K output
  freshness: 3 seconds
```

This turns opaque long-running sessions into inspectable workspace actors.

### 2. Cross-machine Worker Supervision

A lead agent spawns workers across machines and can inspect their progress
through Synchronize.

```text
lead on laptop
  |
  +-- worker A on laptop
  +-- worker B on desktop
  +-- worker C on remote VM

lead asks annotation status for all workers
  |
  v
one dashboard of current work, recent tools, blockers, and tags
```

No worker has to be nudged by a chat message just to report status.

### 3. Handoff And Resume With Evidence

When a human or agent resumes a long task, the platform can assemble a useful
handoff from annotations:

```text
handoff query:
  latest user request
  final assistant response
  recent failed tool calls
  edits made
  tests run
  saved decisions
  tags matching architecture/*
```

This is stronger than a summary-only handoff because the recipient can drill
back into exact transcript windows.

### 4. Searchable Work History

Users can search across sessions by semantic work units, not only chat text.

Examples:

```text
find:
  normalized_tool = bridge_reply
  text contains "stale thread"
  tag = failure-mode/threading

find:
  kind = runtime_model_change
  current = claude-sonnet

find:
  category = tool
  is_error = true
  window = 3
```

This enables workspace forensics: "where did we see this before?"

### 5. Human-curated Knowledge

A human can save an agent response or tag a transcript range:

```text
bookmark:
  saved/debugging-recipe

tags:
  architecture/v1
  ui-design/acme
  launch-lifecycle
  failure-mode/mcp-delivery
```

Later, those tags become filters for search, handoff, RAG, docs generation, and
memory consolidation.

### 6. Model-assisted Session Librarian

A background model can scan finished or active sessions and propose delayed
tags:

```text
model suggestions:
  tag: architecture/session-annotation
  tag: decision/defer-tantivy
  tag: open-question/federated-routing
  bookmark: implementation-checkpoint
```

Humans can accept, edit, or ignore these overlays. The base transcript remains
unchanged.

### 7. Debugging Agent Behavior

When an agent behaves oddly, annotations expose the runtime trail:

```text
timeline:
  user asked for parser
  model changed from A to B
  effort changed to low
  compaction at 260K tokens
  bus event injected
  tool call failed
  agent repeated same command 5 times
```

This helps distinguish model behavior, tool failure, bad instructions, and
Synchronize delivery issues.

### 8. Cost And Context Observability

Token annotations unlock cost and context analysis:

```text
per session:
  total input/output/cache tokens
  token spikes
  compaction boundaries
  expensive tool loops
  model/effort choices over time
```

This can eventually power workspace-level dashboards: which agents are burning
context, which tasks are expensive, and which workflows need better prompts or
handoffs.

### 9. Workspace-level Memory And RAG

The annotation lake becomes the substrate for durable memory:

```text
raw transcript
  -> annotations
  -> saved/tagged regions
  -> retrieval chunks
  -> project memory
  -> future agents retrieve prior work
```

The memory system should not have to parse raw Claude/Pi/Codex logs itself. It
should consume normalized annotations and overlays.

### 10. Auditability And Trust

For important changes, users need to answer:

- Why did the agent make this edit?
- Which prompt or bus message caused it?
- Which command proved it?
- Which model produced the decision?
- Was this tagged by a human or inferred by a model?

Annotations provide the evidence chain.

```text
decision
  -> assistant response seq
  -> user prompt seq
  -> tool calls seq range
  -> synchronize event id
  -> bookmark/tag overlays
```

## Product Fit For Synchronize

Session annotation is not a side parser. It is the foundation for a workspace
where coding agents are long-lived teammates rather than disposable chat tabs.

The Synchronize product direction needs:

- rooms and DMs for live collaboration,
- launch/resume/archive for agent lifecycle,
- work state for current activity,
- annotations for transcript truth,
- overlays for human/model curation,
- search/retrieval for memory,
- cross-machine routing for distributed teams of agents.

```text
Slack-like workspace:
  messages + rooms + threads

Synchronize workspace:
  messages + rooms + threads
  + agent lifecycle
  + host transcript annotations
  + tags/bookmarks
  + search/RAG
  + passive status
  + cross-machine coordination
```

This is why the architecture is intentionally layered. The immediate feature is
annotation. The larger product unlock is durable, inspectable, searchable,
curated work history for teams of coding agents.

## Goals

- Parse rich agent transcripts into a common annotation model.
- Support Claude and Pi first, but make new host tools additive.
- Avoid duplicate logic across host tools.
- Support incremental append so the same transcript is not reparsed repeatedly.
- Allow on-demand annotation of active sessions for status and retrieval.
- Preserve a path to cross-machine and later distributed annotation.
- Store human/model delayed annotations such as bookmarks, tags, notes, and
  saved responses without mutating base transcript facts.
- Keep query and retrieval engine-neutral, with SQLite first and FTS/Tantivy
  as rebuildable projections.
- Make model, token, effort, and runtime state changes first-class derived
  annotations.
- Support future RAG without forcing v1 to solve ranking, vector search, or
  global distribution.

## Non-goals For v1

- No central Kubernetes annotation service in v1.
- No mandatory replication of all remote annotation rows in v1.
- No vector database in v1.
- No Tantivy dependency in the initial merge unless a later phase explicitly
  selects it.
- No attempt to parse every historical transcript format perfectly on day one.
- No mutation of host transcripts.
- No use of absolute transcript paths as portable identity.

## Design Principles

### The lake is truth

The source of truth is `session_annotations` plus its related state rows.
Indexes can be deleted and rebuilt.

```text
truth:
  session_annotations
  session_annotation_state
  annotation_marks

derived/rebuildable:
  SQLite FTS5
  Tantivy
  vector index
  graph index
  rollup caches
```

### Location is not identity

Identity must be portable across machines. Transcript paths are local machine
facts.

```text
portable identity:
  host_tool + host_session_id -> binding_id

local locator:
  host_session_file
  machine_id
  runtime home
```

### Tool-specific code stays at the edge

Host-specific code should only handle locating, reading, and decoding host
formats.

```text
agent-specific:
  Claude transcript locator
  Claude JSONL decoder
  Pi transcript locator
  Pi JSONL decoder

shared:
  annotation schema
  incremental state
  runtime derivation
  tag/bookmark overlays
  query
  index projection
  status projection
  cross-machine routing
```

### Distributed-ready, not distributed-first

The first implementation should run inside the local daemon and annotate local
transcripts. Future modes should use the same coordinator and store interfaces.

```text
v1 embedded:
  local daemon annotates local transcripts

v2 federated:
  daemon A asks daemon B to annotate/query B-owned transcript

v3 delegated:
  annotation worker coordinates jobs, transcript owner still reads files

v4 replicated:
  annotation deltas can be copied between machines for cache/search
```

## Terminology

```text
host tool
  The product or runtime that owns the transcript. Examples: claude, pi, codex.

binding_id
  Synchronize's stable session binding. Usually derived from host_tool and
  host_session_id.

transcript
  Raw host session log. Usually JSONL, but the architecture must not require
  all future tools to use JSONL.

base annotation
  Fact decoded from the transcript. Immutable except full reparse correction.

derived annotation
  Fact computed from base annotations, such as model changes or token deltas.

overlay annotation
  Mutable delayed annotation created after the base transcript is parsed, such
  as a bookmark or tag.

projection
  Rebuildable index or rollup over the lake.
```

## High-level Components

```text
+---------------------------------------------------------------+
| AnnotationCoordinator                                          |
| ensureAnnotated, query, status, route local/remote requests     |
+-----------------------------+---------------------------------+
                              |
+-----------------------------v---------------------------------+
| AnnotationPipeline                                             |
| choose append/reparse, read, decode, derive, persist            |
+-----------------------------+---------------------------------+
                              |
        +---------------------+----------------------+
        |                     |                      |
        v                     v                      v
+---------------+    +----------------+     +------------------+
| Transcript    |    | SessionDecoder |     | DerivationPass   |
| Locator/Source|    | per host tool  |     | shared passes    |
+---------------+    +----------------+     +------------------+
                              |
+-----------------------------v---------------------------------+
| AnnotationStore                                                |
| lake, state, jobs, overlays, transactions                       |
+-----------------------------+---------------------------------+
                              |
+-----------------------------v---------------------------------+
| Query and Projection Layer                                     |
| SQLite filters, FTS5, Tantivy later, status/RAG projectors      |
+---------------------------------------------------------------+
```

## Module Layout

Target structure:

```text
src/annotate/
  coordinator.ts
  pipeline.ts
  registry.ts
  types.ts
  state.ts
  jobs.ts
  store.ts
  query.ts
  overlays.ts
  status.ts
  projections/
    sqlite-fts.ts
    tantivy.ts
    vector.ts
  derivation/
    runtime.ts
    tool-state.ts
    summarize.ts
  adapters/
    claude/
      locator.ts
      reader.ts
      decoder.ts
    pi/
      locator.ts
      reader.ts
      decoder.ts
    codex/
      locator.ts
      reader.ts
      decoder.ts
```

The current POC can map into this shape gradually. It does not need to be
renamed in one large refactor, but new code should follow these boundaries.

## Core Interfaces

These interfaces are intentionally small. They isolate host-specific behavior
and make local, federated, or delegated execution share the same orchestration
logic.

```ts
export interface SessionSelector {
  bindingId?: string;
  hostTool?: string;
  hostSessionId?: string;
  peerId?: string;
  sessionName?: string;
}

export interface TranscriptHandle {
  bindingId: string;
  hostTool: string;
  hostSessionId: string;
  ownerMachineId: string;
  uri: string;
  source: TranscriptSource;
}

export interface TranscriptStat {
  size: number;
  mtimeMs: number | null;
  fingerprint: string | null;
}

export interface TranscriptSource {
  stat(): Promise<TranscriptStat>;
  readFrom(offset: number): AsyncIterable<RawRecordChunk>;
  fingerprint(): Promise<string | null>;
}

export interface TranscriptLocator {
  hostTool: string;
  canResolve(selector: SessionSelector): boolean;
  resolve(selector: SessionSelector): Promise<TranscriptHandle | null>;
}

export interface SessionDecoder {
  hostTool: string;
  version: string;
  decode(record: unknown, ctx: DecodeContext): Annotation[];
}

export interface DerivationPass {
  name: string;
  version: string;
  apply(input: DerivationInput, state: DerivationState): Annotation[];
}

export interface AnnotationStore {
  getState(bindingId: string): AnnotationState | null;
  replaceSession(input: ReplaceSessionInput): Promise<AnnotationResult>;
  appendSession(input: AppendSessionInput): Promise<AnnotationResult>;
  query(spec: AnnotationQuery): Promise<AnnotationQueryResult>;
}
```

## Data Model

### Base lake

`session_annotations` stores one row per normalized annotation.

```sql
CREATE TABLE session_annotations (
  binding_id      TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  turn_index      INTEGER NOT NULL,
  ts_ms           INTEGER,
  line_number     INTEGER NOT NULL,
  byte_start      INTEGER,
  byte_end        INTEGER,
  category        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  record_type     TEXT,
  role            TEXT,
  uuid            TEXT,
  parent_uuid     TEXT,
  content_index   INTEGER,
  tool            TEXT,
  normalized_tool TEXT,
  tool_call_id    TEXT,
  tool_server     TEXT,
  source          TEXT,
  is_error        INTEGER,
  summary         TEXT,
  text            TEXT,
  est_tokens      INTEGER,
  data_json       TEXT,
  origin_json     TEXT,
  PRIMARY KEY (binding_id, seq)
);
```

Important fields:

- `seq`: stable order within a parsed session.
- `turn_index`: coarse turn/message group.
- `byte_start` and `byte_end`: used for incremental safety and reattachment.
- `origin_json`: optional locator back to raw record/block, such as JSON path,
  line number, host id, or tool call id.

### Annotation state

`session_annotation_state` is the per-session cursor and catalog row.

```sql
CREATE TABLE session_annotation_state (
  binding_id             TEXT PRIMARY KEY,
  project                TEXT,
  schema_version         INTEGER NOT NULL,
  parser_version         TEXT NOT NULL,
  decoder_version        TEXT NOT NULL,
  derivation_version     TEXT NOT NULL,
  source_uri             TEXT,
  source_fingerprint     TEXT,
  file_size              INTEGER,
  file_mtime_ms          INTEGER,
  annotated_offset       INTEGER NOT NULL DEFAULT 0,
  annotated_lines        INTEGER NOT NULL DEFAULT 0,
  last_seq               INTEGER NOT NULL DEFAULT -1,
  last_turn_index        INTEGER NOT NULL DEFAULT -1,
  tail_hash              TEXT,
  annotation_count       INTEGER NOT NULL DEFAULT 0,
  diagnostics_count      INTEGER NOT NULL DEFAULT 0,
  ts_min                 INTEGER,
  ts_max                 INTEGER,
  by_category_json       TEXT,
  by_kind_json           TEXT,
  by_tool_json           TEXT,
  overlay_rollup_json    TEXT,
  annotated_at           TEXT,
  stale_reason           TEXT
);
```

This row supports incremental append and cached summaries. It should not become
the source of truth for tags/bookmarks; only rollups belong here.

### Jobs

`annotation_jobs` prevents duplicate work and gives on-demand calls a shared
execution record.

```sql
CREATE TABLE annotation_jobs (
  job_id                 TEXT PRIMARY KEY,
  binding_id             TEXT NOT NULL,
  owner_machine_id       TEXT,
  requested_by_peer_id   TEXT,
  requested_by_machine_id TEXT,
  mode                   TEXT NOT NULL,
  status                 TEXT NOT NULL,
  freshness_ms           INTEGER,
  target_offset          INTEGER,
  started_at             TEXT,
  completed_at           TEXT,
  error                  TEXT,
  result_json            TEXT
);

CREATE UNIQUE INDEX idx_annotation_jobs_active
  ON annotation_jobs(binding_id)
  WHERE status IN ('queued', 'running');
```

### Overlays

Bookmarks, saved responses, tags, model suggestions, and notes belong in
overlay tables.

```sql
CREATE TABLE annotation_marks (
  mark_id        TEXT PRIMARY KEY,
  binding_id     TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  seq_start      INTEGER,
  seq_end        INTEGER,
  turn_index     INTEGER,
  event_id       INTEGER,
  kind           TEXT NOT NULL,
  label          TEXT,
  value          TEXT,
  source         TEXT NOT NULL,
  created_by     TEXT,
  confidence     REAL,
  anchor_json    TEXT,
  data_json      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
```

For v1, `label` can hold paths such as `architecture/v1` or
`ui-design/acme`. A normalized tag dictionary can come later.

## Incremental Append

The annotation pipeline should avoid reparsing a transcript when only new lines
were appended.

```text
ensureAnnotated(binding_id)
        |
        v
+---------------------+
| load state          |
| offset, seq, hash   |
+----------+----------+
           |
           v
+---------------------+
| stat transcript     |
| size, mtime, fp     |
+----------+----------+
           |
   +-------+---------+
   |                 |
   v                 v
append-safe       unsafe/stale
   |                 |
   v                 v
read from offset  full reparse
   |                 |
   +--------+--------+
            v
       decode records
            |
            v
       derivation passes
            |
            v
       write transaction
            |
            v
       update state
```

Append is safe only when:

- source URI is unchanged,
- parser/decoder/derivation versions match,
- file size is greater than or equal to `annotated_offset`,
- tail hash matches the bytes previously read,
- no previous diagnostic marked the state as unsafe,
- the transcript source supports byte offsets.

Fallback to full reparse when:

- file shrank,
- transcript path changed,
- parser or decoder version changed,
- tail hash mismatch,
- the reader cannot resume cleanly,
- the host adapter marks the transcript as non-appendable.

Partial final lines must not advance the cursor.

```text
raw file:
  line 1\n
  line 2\n
  line 3 without newline

commit:
  parse line 1 and line 2
  annotated_offset points after line 2 newline
  line 3 waits for next pass
```

## Decoder And Adapter Model

Each host tool registers an adapter bundle.

```text
HostAdapter
  hostTool: "claude"
  locator: ClaudeLocator
  reader: JsonlReader
  decoder: ClaudeDecoder
  capabilities:
    appendable: true
    byteOffsets: true
    stableMessageIds: true
    rawUsage: true
```

Claude and Pi both use JSONL today, but the registry should not assume JSONL
for all future tools.

```text
future host examples:
  codex       JSONL rollout summaries or local session files
  cursor      SQLite or JSON exports
  gemini      provider-specific stream logs
  local agent custom event log
```

Reader and decoder are separate because a future host may read from SQLite,
HTTP, object storage, or a compressed archive while still emitting decoded
records.

## Runtime Derivation

Decoders should emit raw facts. Shared derivation passes should infer canonical
runtime events.

```text
raw annotations
  message.model
  message.usage
  advisorModel
  Pi model_change
  Pi thinking_level_change
  compaction tokensBefore
        |
        v
+-------------------------------+
| RuntimeDerivationPass         |
| compare previous/current      |
| normalize field names         |
+---------------+---------------+
                |
                v
derived annotations
  runtime_model_observed
  runtime_model_change
  runtime_effort_observed
  runtime_effort_change
  runtime_usage_observed
  runtime_token_delta
  runtime_compaction_token_snapshot
```

Derived annotations should include:

```text
source_seq
source_kind
previous
current
scope: session | assistant | advisor | message
confidence: explicit | observed | inferred
source_field
```

Examples:

```text
Pi explicit model_change:
  kind = runtime_model_change
  confidence = explicit
  previous = prior known model
  current = record.modelId

Claude consecutive assistant messages with different model:
  kind = runtime_model_change
  confidence = inferred
  previous = claude-opus-4-7
  current = claude-opus-4-8

Message usage record:
  kind = runtime_usage_observed
  confidence = observed
  data = raw usage plus normalized token fields
```

### Runtime status dimensions

The runtime derivation layer should produce a consistent status vocabulary
across host tools. The status projector and query layer should not need to know
whether a field came from Claude JSONL, Pi JSONL, Codex response records, or a
future host adapter.

```text
dimension          canonical meaning
-----------------  ---------------------------------------------------------
model              model that generated or is configured for the response
advisor_model      secondary/advisor model when the host distinguishes it
effort             requested reasoning/effort/thinking level
thinking_state     observed thinking blocks, signatures, or hidden reasoning
usage              raw provider usage object attached to a response
tokens             normalized input/output/cache/total token counters
compaction         context compaction boundary and token count before compact
service_tier       provider tier/speed/latency class when available
active_tool        latest open tool call or unresolved tool result
runtime_error      provider, tool, or host runtime error
```

The canonical annotations should be deliberately verbose enough to support both
status and historical search:

```text
runtime_model_observed
runtime_model_change
runtime_advisor_model_observed
runtime_advisor_model_change
runtime_effort_observed
runtime_effort_change
runtime_thinking_observed
runtime_usage_observed
runtime_token_snapshot
runtime_token_delta
runtime_compaction_token_snapshot
runtime_service_tier_observed
runtime_service_tier_change
runtime_active_tool_observed
runtime_runtime_error
```

### Host source mapping

Claude and Pi should map into the same status vocabulary even though their raw
fields differ.

```text
Claude transcript source                  canonical annotation
----------------------------------------  ---------------------------------
message.model                             runtime_model_observed
record.advisorModel                       runtime_advisor_model_observed
message.usage.input_tokens                runtime_token_snapshot.input
message.usage.output_tokens               runtime_token_snapshot.output
message.usage.cache_read_input_tokens     runtime_token_snapshot.cache_read
message.usage.cache_creation_input_tokens runtime_token_snapshot.cache_write
message.usage.service_tier                runtime_service_tier_observed
message.usage.speed                       runtime_service_tier_observed
content[].type = thinking                 runtime_thinking_observed
tool_use without matching result yet      runtime_active_tool_observed
```

```text
Pi transcript source                      canonical annotation
----------------------------------------  ---------------------------------
record.type = model_change                runtime_model_change explicit
record.type = thinking_level_change       runtime_effort_change explicit
message.model                             runtime_model_observed
message.usage.input                       runtime_token_snapshot.input
message.usage.output                      runtime_token_snapshot.output
message.usage.cacheRead                   runtime_token_snapshot.cache_read
message.usage.cacheWrite                  runtime_token_snapshot.cache_write
message.usage.totalTokens                 runtime_token_snapshot.total
record.type = compaction tokensBefore     runtime_compaction_token_snapshot
content block type = thinking             runtime_thinking_observed
toolCall without matching toolResult      runtime_active_tool_observed
```

Future adapters should provide the same mapping table in their decoder module
or tests. If a host does not expose a dimension, it should omit it rather than
inventing low-confidence data.

### Confidence and status semantics

Runtime status needs to distinguish hard host facts from inference.

```text
confidence = explicit
  Host emitted a direct event, e.g. Pi model_change or thinking_level_change.

confidence = observed
  Host attached a raw field to a message, e.g. Claude message.model or usage.

confidence = inferred
  Synchronize compared adjacent observations, e.g. Claude model changed between
  two assistant messages without a first-class change event.
```

The status projector should use the highest-confidence latest value per
dimension, while preserving the full timeline as queryable annotations.

```text
timeline:
  seq 10 runtime_model_observed claude-opus-4-7 observed
  seq 88 runtime_model_observed claude-opus-4-8 observed
  seq 89 runtime_model_change   4-7 -> 4-8 inferred

status:
  model = claude-opus-4-8
  model_confidence = observed
  last_model_change_seq = 89
```

## Delayed Tags And Bookmarks

Delayed annotations are first-class. They should not mutate base annotation
rows.

```text
base transcript already annotated
        |
        v
human/model/rule scans session later
        |
        v
select target:
  seq range
  turn
  sync event
  assistant response
        |
        v
create overlay mark:
  bookmark
  tag
  note
  model_suggestion
```

Target examples:

```text
save one assistant response:
  target_type = response
  turn_index = 42
  seq_start = 180
  seq_end = 194
  kind = bookmark
  label = saved

tag a design discussion:
  target_type = range
  seq_start = 220
  seq_end = 260
  kind = tag
  label = ui-design/acme

tag one synchronize bus event:
  target_type = sync_event
  event_id = 918
  kind = tag
  label = architecture/v1
```

Overlay anchors should be reattachable after a full reparse.

```json
{
  "uuid": "host message id when available",
  "parent_uuid": "parent id when available",
  "line_number": 1234,
  "byte_start": 990201,
  "byte_end": 991804,
  "turn_index": 42,
  "tool_call_id": "toolu_...",
  "event_id": 918,
  "text_quote": "short selected text",
  "text_hash": "sha256 normalized selected text"
}
```

Reattachment order:

```text
1. exact host uuid or event_id
2. tool_call_id within binding
3. byte range if source fingerprint is same
4. line_number plus text_hash
5. fuzzy quote match
6. mark as detached, keep visible for repair
```

## Query And Retrieval

The query contract should be engine-neutral. Query execution has two stages:
hit selection and hydration/windowing.

```text
AnnotationQuery
  session
  facets
  text
  tags
  bookmarks
  source
  window
  limit
        |
        v
+--------------------+
| hit selection      |
| SQLite / FTS5 /    |
| Tantivy / vector   |
+---------+----------+
          |
          v
hit keys: binding_id, seq
          |
          v
+--------------------+
| hydrate from lake  |
+---------+----------+
          |
          v
+--------------------+
| join overlays      |
+---------+----------+
          |
          v
+--------------------+
| expand windows     |
| apply token budget |
+--------------------+
```

The result object should preserve enough information for agents and UI:

```text
rows
  annotation fields
  hit_seq
  mark summaries
  rank score
  source engine
  window group id

rollups
  by_category
  by_kind
  by_tool
  by_tag
```

## FTS5 And Tantivy

FTS/Tantivy should be projections over the lake.

```text
                         source of truth
                  +-------------------------+
                  | session_annotations     |
                  | binding_id, seq, text   |
                  +------------+------------+
                               |
                  rebuild/append projection
                               |
              +----------------+----------------+
              |                                 |
              v                                 v
    +--------------------+           +----------------------+
    | SQLite FTS5 index  |           | Tantivy index         |
    | local, simple      |           | larger scale BM25     |
    +---------+----------+           +----------+-----------+
              |                                 |
              +---------------+-----------------+
                              |
                              v
                    hit keys: binding_id, seq
```

FTS5 near-term unlocks:

- token search instead of `%LIKE%`,
- phrase search,
- prefix search,
- ranking,
- faster body search over many sessions.

Tantivy later unlocks:

- stronger BM25 ranking,
- boosted multi-field search,
- fast fields for range/facet filters,
- large local indexes,
- cleaner path to hybrid retrieval.

Recommended timing:

```text
1. incremental append
2. runtime derivation
3. overlays
4. on-demand status
5. SQLite FTS5
6. Tantivy
7. vector/hybrid RAG
```

Do not block v1 on Tantivy.

## On-demand Annotation

Agents and UI need to request fresh status without sending a bus message to the
target agent.

```text
Machine A                         Machine B
parent agent                      child session lives here
    |                                   |
    v                                   |
daemon A -- ensureAnnotated(remote) --> daemon B
    |                                   |
    |                       local incremental parse
    |                                   |
    | <----- status/query result -------+
    v
parent sees child status without a bus message
```

API shape:

```text
POST /annotations/ensure
{
  "selector": "peer_id | binding_id | session_name | host_session_id",
  "freshness_ms": 5000,
  "mode": "summary | status | query | delta",
  "query": optional AnnotationQuery
}
```

Local flow:

```text
ensure request
      |
      v
resolve binding
      |
      v
same machine owns transcript?
      |
      v
incremental annotate if stale
      |
      v
return status/query result
```

Remote flow:

```text
ensure request on daemon A
      |
      v
resolve binding owner machine
      |
      v
route control-plane request to daemon B
      |
      v
daemon B annotates local transcript
      |
      v
daemon B returns compact result
```

The target agent is not interrupted. This is not a DM or group message.

## Cross-machine And Future Distributed Modes

The first version should store enough ownership metadata to make remote routing
possible later.

```text
agent_sessions
  binding_id
  host_tool
  host_session_id
  host_session_file
  machine_id
  peer_id

session_annotation_state
  binding_id
  owner_machine_id
  annotated_offset
  annotated_at
  parser_version
```

Mode 1: embedded local

```text
daemon
  reads local transcript
  writes local lake
  serves local query/status
```

Mode 2: federated daemon-to-daemon

```text
daemon A
  wants status for remote binding
        |
        v
daemon B
  owns transcript
  runs incremental annotation
  returns summary/hits
```

Mode 3: delegated coordinator

```text
annotation coordinator
  receives jobs
  routes job to owner machine or worker
  tracks status

owner machine
  provides transcript source or runs local parser
```

Mode 4: central worker with replicated input

```text
worker pod
  receives transcript chunks or object-store URI
  annotates in central infra
  writes lake or returns deltas
```

Mode 4 should not be designed in detail now. The seam is enough:

```text
TranscriptSource can be local file, remote daemon stream, object storage, or DB.
AnnotationStore can be local SQLite now, remote service later.
AnnotationCoordinator decides where the job executes.
```

## Status Projector

For "what is this other agent doing right now?" return a compact status view.
Do not return the whole annotation lake by default.

```text
latest annotations
      |
      v
+----------------------+
| StatusProjector      |
| latest N turns       |
| current tool state   |
| model/token/effort   |
+----------+-----------+
           |
           v
current_activity
```

Status fields:

```text
binding_id
host_tool
host_session_id
peer_id
owner_machine_id
last_annotated_at
freshness_ms
latest_user_prompt
latest_assistant_text
active_tool_call
recent_tool_results
recent_synchronize_events
model
effort
token_usage_recent
tags
bookmarks
```

This is the surface parent agents should use for passive observation.

## API Surface

Initial local APIs:

```text
POST /annotations/ensure
POST /annotations/query
GET  /annotations/status/:binding_id
POST /annotations/marks
PATCH /annotations/marks/:mark_id
DELETE /annotations/marks/:mark_id
```

CLI:

```text
synchronize annotate ensure <session>
synchronize annotate status <session>
synchronize annotate query --session <session> kind=tool_result text~error
synchronize annotate mark <session> --seq 120 --tag architecture/v1
synchronize annotate bookmark <session> --turn 42 --label saved
```

MCP tools can come later after the daemon/API path is stable:

```text
bridge_annotation_status
bridge_annotation_query
bridge_annotation_mark
```

## Integration With Synchronize Concepts

Annotations should cross-link to existing bus state when available:

```text
session annotation row
  binding_id
  seq
  source = synchronize_channel
  data_json.event_id = 918
        |
        v
events table
  event_id = 918
  group_id
  parent_event_id
  sender_peer_id
```

This enables:

- status by peer/session,
- querying bus events embedded in transcripts,
- tagging a synchronize event and seeing the tag in transcript context,
- navigating from transcript row to bus event and back.

## Versioning

Use explicit versions in state:

```text
schema_version
parser_version
decoder_version
derivation_version
projection_version
```

Version change policy:

```text
decoder behavior changed:
  mark state stale, full reparse needed

derivation behavior changed:
  base rows can remain, derived rows can be rebuilt

projection behavior changed:
  drop/rebuild projection only

overlay schema changed:
  migrate overlay rows, do not touch base transcript facts
```

Consider marking derived annotations:

```text
category = runtime
source = derived.runtime.v1
data_json.derivation_version = ...
```

## Testing Strategy

Unit tests:

- tool classification,
- synchronize envelope extraction,
- each decoder on small fixtures,
- runtime derivation transitions,
- overlay reattachment,
- query predicate builder.

Golden tests:

- existing Claude complex transcript,
- existing Pi complex transcript,
- exact count/category parity with prototype output where intended.

Incremental tests:

```text
write transcript lines 1..N
ensure annotation
append lines N+1..M
ensure annotation
assert only new lines decoded
assert seq continues
assert state offset advances
```

Reparse fallback tests:

- file shrink,
- tail hash mismatch,
- decoder version change,
- partial final line,
- corrupted JSONL record.

Cross-machine tests:

```text
daemon A with no transcript
daemon B with transcript
A requests ensure/status
B annotates locally
A receives result
target agent receives no bus message
```

Overlay tests:

- create bookmark on turn,
- tag range,
- query by tag,
- soft-delete mark,
- full reparse and reattach mark.

Projection tests:

- FTS projection returns hit keys,
- hydration and window expansion remain SQLite-backed,
- projection can be rebuilt from lake.

## Implementation Phases

### Phase 0: Preserve the current POC branch

Keep `feat/session-annotation-v0` as evidence and a migration source. Do not
merge it blindly if master has moved. Rebase or port intentionally.

### Phase 1: Local unified lake

Deliver:

- base schema,
- shared annotation types,
- Claude and Pi decoders,
- local `ensureAnnotated`,
- query by exact facets and text LIKE,
- golden tests.

Exit criteria:

- Claude and Pi complex samples parse with zero diagnostics,
- current output matches prototype counts where expected,
- no absolute transcript paths are exported as portable identity.

### Phase 2: Incremental append

Deliver:

- state cursor fields,
- append planner,
- partial-line handling,
- tail hash validation,
- full reparse fallback,
- job dedupe.

Exit criteria:

- repeated ensure on unchanged transcript does no decode work,
- append-only transcript parses only new records,
- fallback scenarios are tested.

### Phase 3: Runtime derivation

Deliver:

- model observed/change,
- effort observed/change,
- usage observed/token deltas,
- active tool state,
- derivation versioning.

Exit criteria:

- Pi explicit changes are marked `confidence=explicit`,
- Claude inferred model changes are marked `confidence=inferred`,
- usage records normalize token fields.

### Phase 4: Overlays

Deliver:

- annotation marks table,
- bookmark/tag/note APIs,
- query by tag/bookmark,
- anchor model for reparse safety.

Exit criteria:

- user can bookmark a response,
- user/model can tag a range,
- query can filter by tag,
- reparse can reattach or mark detached.

### Phase 5: On-demand local status

Deliver:

- `POST /annotations/ensure`,
- status projector,
- passive current activity view.

Exit criteria:

- parent agent/UI can request current status of a local session without sending
  a bus message to the target agent.

### Phase 6: Federated ensure

Deliver:

- owner-machine resolution,
- daemon-to-daemon control-plane request,
- remote ensure/status result,
- no target-agent interruption.

Exit criteria:

- daemon A requests status for a session whose transcript is owned by daemon B,
- daemon B incrementally annotates and returns compact status,
- the child agent receives no message.

### Phase 7: FTS5 projection

Deliver:

- rebuildable SQLite FTS table,
- text query executor returning hit keys,
- existing hydration/windowing reused.

Exit criteria:

- phrase/token search works,
- query results can be filtered by facets and overlays,
- deleting/rebuilding FTS does not affect source rows.

### Phase 8: Tantivy/vector

Deliver only if scale or RAG quality requires it:

- Tantivy index projection,
- field boosts,
- fast fields,
- optional vector sidecar,
- hybrid/RRF query executor.

Exit criteria:

- query contract remains unchanged,
- projections remain rebuildable,
- SQLite lake remains source of truth.

## Beads Implementation Breakdown

The implementation work is tracked as Beads epics and child tasks. Each child
issue is intended to be a small implementation slice with context, impact area,
acceptance criteria, verification notes, and dependencies.

```text
sync-xwmn  Build local session annotation lake core
  sync-xwmn.1  Add annotation lake schema and store contracts
  sync-xwmn.2  Create host adapter registry interfaces
  sync-xwmn.3  Port Claude and Pi decoders behind adapters
  sync-xwmn.4  Wire local ensure and query surfaces
  sync-xwmn.5  Add phase one golden coverage

sync-phoz  Add incremental append and annotation jobs
  sync-phoz.1  Extend annotation state cursors
  sync-phoz.2  Implement append planner and safe reader
  sync-phoz.3  Add append and reparse write transactions
  sync-phoz.4  Add annotation job dedupe
  sync-phoz.5  Test incremental fallback matrix

sync-f3j0  Derive runtime status annotations
  sync-f3j0.1  Add derivation pass framework
  sync-f3j0.2  Derive model effort and token status
  sync-f3j0.3  Derive active tool and runtime error status
  sync-f3j0.4  Implement current activity status projector
  sync-f3j0.5  Add runtime derivation golden tests

sync-ehmy  Add delayed annotation overlays
  sync-ehmy.1  Add annotation mark schema and store
  sync-ehmy.2  Implement overlay anchors and reattachment
  sync-ehmy.3  Expose mark APIs and CLI commands
  sync-ehmy.4  Join overlays into annotation queries

sync-er2b  Add search projection architecture
  sync-er2b.1  Define search projection interface
  sync-er2b.2  Add SQLite FTS5 projection
  sync-er2b.3  Integrate FTS hits with query hydration
  sync-er2b.4  Document Tantivy adapter decision

sync-pq2x  Support on-demand and federated annotation
  sync-pq2x.1  Expose annotation ownership metadata
  sync-pq2x.2  Implement local on-demand ensure status
  sync-pq2x.3  Route federated ensure to owner daemon
  sync-pq2x.4  Test no-interruption remote supervision
```

## Risks And Mitigations

Risk: v1 overfits Claude and Pi.

Mitigation: enforce adapter interfaces and keep host-specific logic at the
edge.

Risk: incremental append corrupts ordering.

Mitigation: state cursor, tail hash, transactions, full reparse fallback.

Risk: overlays break after reparse.

Mitigation: store anchors beyond seq ranges and support detached marks.

Risk: distributed design overcomplicates v1.

Mitigation: implement local embedded mode first. Only design seams for remote
routing.

Risk: FTS/Tantivy becomes another truth store.

Mitigation: indexes return keys only; hydrate from lake.

Risk: on-demand annotation becomes a covert bus message.

Mitigation: model it as control-plane API. Do not deliver anything to the
target agent.

## Recommended Next Step

Port or rebase the existing `feat/session-annotation-v0` implementation into
the current master shape, but scope the merge to Phase 1 only. Then add Phase 2
incremental append before adding new host tools or search indexes.

The right first durable merge is:

```text
Phase 1 local lake
  plus clean interfaces
  plus golden tests
  without distributed routing
  without Tantivy
  without overlay UI
```

Once Phase 1 is stable, incremental append and runtime derivation should be the
next two implementation slices.
