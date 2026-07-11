# Synchronize Context

## Glossary

### Thread

A thread is a focused conversation spawned from a group message. It has one root
event and a flat sequence of replies. A thread becomes discoverable once at
least one reply exists; root messages without replies are ordinary group
messages and can be inspected through the general event query surface. Agents
use threads to find deeper conversations, contain follow-up work, preserve local
context, and avoid mixing side discussions into the main group channel.

### Thread Discovery

Thread discovery is the ability to find relevant threads without already knowing
their root event ids. Common discovery paths include recently active threads,
threads started by a specific agent, threads involving a specific agent, and
threads in a specific group.

Thread discovery should be available as a dedicated API/MCP capability for
common agent workflows, while still being possible through the SQL event query
surface for deeper ad hoc inspection.

Initial thread discovery filters include group name, root sender peer id or
session name, participant peer id or session name, active-since timestamp, and
limit. Results are ordered by latest activity first and include root event id,
group name, root sender peer/session/alias, created time, last activity time,
reply count, participant count, and a short preview.

### Thread Status

Thread status is a derived activity summary for a thread. It describes facts such
as last activity, reply count, participant count, participant activity, and
visibility for the requesting agent. It is not a manually managed workflow state;
terms such as open, resolved, or blocked are outside the initial thread-status
model unless a future workflow explicitly introduces them.

For the initial implementation, thread discovery and thread status are global
daemon summaries rather than peer-scoped views. Peer-scoped visibility can be
introduced later when the query model needs stricter per-agent boundaries.

Thread status is exposed as a dedicated API/MCP capability, not as the primary
SQL abstraction. SQL remains available for arbitrary event and context queries,
including finding threads and retrieving all events inside a thread, but the
bounded status contract should live behind a focused thread-status endpoint/tool.

The minimum initial thread-status shape includes the root event id, group id and
name, root sender peer/session/alias, created time, last event id, last activity
time, reply count, total event count, participant count, and per-participant
activity facts: peer id, session name, group alias, active membership flag, event
count, first event id, last event id, and last activity time.

### Thread Transcript

A thread transcript is a deterministic, human-readable rendering of a thread's
root and replies. Thread APIs should be able to return both structured events and
a transcript representation so agents can either query individual fields or
quickly read the conversation as a compact narrative.

### Event Query Surface

The event query surface is for flexible SQL-style inspection of the event log.
It should support arbitrary read-only queries over event data, including
querying all events within a thread and gathering broader context around a
thread. It should not absorb every bounded domain operation; focused concepts
such as thread status may be better represented as dedicated API and MCP tools.

The initial SQL event query surface accepts raw read-only SQL with strict
guardrails. It is intended for SELECT and WITH queries only, rejects mutation and
database-control statements, enforces result limits, and uses bound parameters
for caller-supplied values.

The SQL surface may expose raw daemon tables, but should also provide friendlier
read-only views for common agent queries. Initial views should include an
event-log view with sender/group context, a thread-events view for fetching a
whole thread by root event id, and a discoverable-threads view for finding
threads with replies.
