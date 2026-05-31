# Mentions Deep Dive

## Why Mentions Use Group Aliases

Mentions are scoped to a group conversation. The visible handle inside that
conversation is `group_members.alias`, not global `session_name`.

Mention token parsing uses the daemon's mention token regex for ordinary alias
tokens. Single and triple backtick regions suppress mention parsing.

## Common Mistakes

- Mentioning `@session_name` when the group alias differs.
- Ignoring `warnings: [{ reason: "alias_not_in_group" }]`.
- Assuming every group message pushes every group member.
- Mentioning yourself and expecting a self-push. Sender self-mentions are
  filtered out.
- Claiming double-backtick suppression is fixed; do not document that until the
  daemon bug is done.

## Delivery Variations

Main channel:

```text
push -> mentioned peers
inbox -> active group members
```

Thread:

```text
push -> root author + prior thread posters + new mentions
inbox -> active group members
```
