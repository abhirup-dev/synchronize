# Issue Tracker

This repo tracks work with Beads (`bd`), not GitHub Issues.

Use `bd` for all issue creation, triage, dependency tracking, claiming, and closure. Do not create markdown TODO files for durable task tracking.

## Common Commands

```bash
bd prime
bd ready
bd list --status=open
bd show <id>
bd create --title="..." --description="..." --type=task|bug|feature --priority=0
bd update <id> --claim
bd update <id> --notes="..."
bd dep add <issue> <depends-on>
bd close <id> --reason="..."
bd dolt push
```

## Skill Guidance

When a skill asks to create issues, create Beads with `bd create`.

When a skill asks to triage issues, inspect and update Beads with `bd show`, `bd update`, `bd label`, and dependency commands as needed.

When a skill asks to convert a plan into issues, prefer a small set of independently actionable Beads with clear acceptance criteria.

Before ending a work session, follow the repo's Beads session-close workflow in `AGENTS.md`.
