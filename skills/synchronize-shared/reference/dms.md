# Direct Messages

High-level API map for direct messages. Deep detail:
`reference/deep-dives/dms.md`.

## Tools

| Tool | Use |
|---|---|
| `bridge_reply` | Reply to an existing DM event by `event_id` |
| `bridge_dm` | Send a DM when you already know the recipient peer id |

## Preferred Reply

```text
bridge_reply(in_reply_to: <event_id>, message: "...")
```

For DM targets, the daemon sends back to the other DM participant. The response
includes:

```text
{ event, posted_to: { surface, direct_event_id, direct_sender, direct_preview } }
```

## Direct Send

```text
bridge_dm(recipient_peer_id: "<peer_id>", message: "...")
```

`peer_id` is accepted as an alias, but `recipient_peer_id` is clearer in docs
and examples.

Returns:

```text
{ event }
```
