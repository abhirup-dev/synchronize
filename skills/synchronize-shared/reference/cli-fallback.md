# CLI Fallback

High-level CLI fallback map. Deep detail:
`reference/deep-dives/cli-fallback.md`.

Prefer MCP tools. CLI fallback creates a separate terminal peer and does not
attach the current MCP channel subscription.

## Commands

```bash
synchronize register --name NAME --purpose "what this session is doing"
synchronize peers
synchronize dm PEER_ID "message"
synchronize inbox --ack
synchronize group create GROUP --as NAME [--description "topic"]
synchronize group describe GROUP "topic"
synchronize group join GROUP --as NAME
synchronize group join GROUP --as NAME --fresh
synchronize group rename GROUP NEW_ALIAS --as NAME
synchronize group send GROUP --as NAME [--in-reply-to EVENT_ID] "message"
synchronize group history GROUP --as NAME
synchronize threads list --group GROUP
synchronize threads status ROOT_EVENT_ID
synchronize threads show ROOT_EVENT_ID --format transcript
synchronize query --format table 'select * from thread_events where thread_root_event_id = 123'
```

When you use CLI fallback, tell the user real-time channel injection will not
work for that CLI peer; only inbox polling/checking works.
