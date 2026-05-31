# Mentions

High-level API map for mentions. Deep detail:
`reference/deep-dives/mentions.md`.

## Syntax

Use `@alias` in a group message body:

```text
bridge_send_group(name: "room", message: "@alice please check this")
```

Aliases are group aliases, not global `session_name` values.

## Response Shape

Message events carry:

```text
mentions: string[]
```

Unresolved mentions are non-fatal warnings:

```text
warnings: [{ token, reason: "alias_not_in_group" }]
```

The message still posts when a mention is unresolved.

## Delivery Summary

Main-channel push goes to mentioned peers. Thread push also includes thread
participants. Inbox delivery remains broader than push delivery.
