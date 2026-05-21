# Domain Docs

This is a single-context repo.

## Before Exploring, Read These When Present

- `CONTEXT.md` at the repo root
- `docs/adr/` for architectural decisions relevant to the area being changed

If these files do not exist, proceed silently. Do not create them just because they are absent; producer workflows such as `grill-with-docs` can create them when terminology or decisions need to be captured.

## Vocabulary

When writing issue titles, refactor proposals, hypotheses, or tests, use the project vocabulary from `CONTEXT.md` if it exists.

If a concept is missing from the glossary, either use the terminology already present in code and README, or note the gap for a future domain-doc pass.

## ADR Conflicts

If a proposed change contradicts an existing ADR, call that out explicitly and explain why the decision should be revisited.
