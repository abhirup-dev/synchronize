# Glass Skin Revamp — Sync Pull Handoff

Direction: **remote → local** (claude.ai/design → `ds-bundle/`).

- **Remote project:** claude.ai/design `41739566-4de3-4dda-90bc-a7777d50b42d`
- **Local root:** `ds-bundle/` (gitignored, generated-output dir — `.gitignore:41`)
- **Method:** `DesignSync(get_file)` → harness auto-persist → `bun /tmp/ds_extract.mjs` (byte-perfect; no content through the model).
- Files under the harness persist threshold and large binary PNGs do **not** auto-persist and were not copied down (per instruction: don't write inline, leave big binaries remote).
- **These remaining files need no pull** — every one of them is readable directly on the claude.ai/design website (open the project, or `DesignSync(get_file)` on demand). They're listed below only so you can see exactly what is and isn't on disk locally.

Remote path == local path under `ds-bundle/` for every entry.

## ✅ Synced locally (byte-perfect) — 19 files

**Templates (5)**
- `templates/glass-skin-revamp/glass-variants.css`
- `templates/glass-skin-revamp/support.js`
- `templates/glass-skin-revamp-e2e/glass-variants.css`
- `templates/glass-skin-revamp-e2e/support.js`
- `templates/glass-coverage-audit/support.js`

**Screenshots (12 of 17)**
- `glassSkinV2Screenshots/01-chat-room.png`
- `glassSkinV2Screenshots/02-board-kanban.png`
- `glassSkinV2Screenshots/03-activity-grouped.png`
- `glassSkinV2Screenshots/04-activity-collapsed.png`
- `glassSkinV2Screenshots/05-room-ml-ranking.png`
- `glassSkinV2Screenshots/06-dm-direct-message.png`
- `glassSkinV2Screenshots/07-chat-light.png`
- `glassSkinV2Screenshots/08-activity-light.png`
- `glassSkinV2Screenshots/09-mobile-chat.png`
- `glassSkinV2Screenshots/10-mobile-activity.png`
- `glassSkinV2Screenshots/15-closeup-activity-group.png`
- `glassSkinV2Screenshots/16-closeup-activity-rhythm.png`

**Uploads PNG (2 of ~49)**
- `uploads/pasted-1782503585331-0.png`
- `uploads/pasted-1782503784123-0.png`

## 📄 Not on local disk — readable directly on the website (no pull needed)

**Root + docs**
- `_ds_manifest.json`
- `_adherence.oxlintrc.json`
- `handoffs/handoff-implemented-expanding-rail-buttons.md`
- `handoffs/handoff-implemented-minimal-surfaces.md`
- `uploads/design-sync-handoff.md`
- `uploads/button-language-explore.html`
- `glassSkinV2Screenshots/index.html`

**Templates — text**
- `templates/glass-skin-revamp/GlassSkinRevamp.dc.html`
- `templates/glass-skin-revamp/ds-base.js`
- `templates/glass-skin-revamp/app.html`
- `templates/glass-skin-revamp-e2e/GlassSkinRevampE2E.dc.html`
- `templates/glass-skin-revamp-e2e/app.html`
- `templates/glass-skin-revamp-e2e/app.jsx`
- `templates/glass-skin-revamp-e2e/glass-e2e.css`
- `templates/glass-skin-revamp-e2e/seed-e2e.js`
- `templates/glass-skin-revamp-e2e/ARCHITECTURE.md`
- `templates/glass-skin-revamp-e2e/revised/AgentProfile.jsx`
- `templates/glass-skin-revamp-e2e/revised/ArtifactsView.jsx`
- `templates/glass-skin-revamp-e2e/revised/RosterPanel.jsx`
- `templates/glass-skin-revamp-e2e/revised/SettingsSheet.jsx`
- `templates/glass-coverage-audit/GlassCoverageAudit.dc.html`
- `templates/glass-coverage-audit/ds-base.js`

**Screenshots — inline, not written (5)**
- `glassSkinV2Screenshots/11-closeup-sidebar.png`
- `glassSkinV2Screenshots/12-closeup-topbar.png`
- `glassSkinV2Screenshots/13-closeup-compose.png`
- `glassSkinV2Screenshots/14-closeup-nav-dock.png`
- `glassSkinV2Screenshots/17-closeup-agents-pill.png`

**Uploads PNG — inline / truncated / not pulled (~46)**
- `uploads/draw-01c69b5e-31fd-4376-ad7d-aba30a9b3e29.png` (inline, very large)
- `uploads/draw-2a60bf22-d09a-4afc-a5a8-747fc7a9b7d4.png` (inline, very large)
- `uploads/pasted-1782504063757-0.png` (**truncated** — exceeds 256 KiB `get_file` cap; needs chunked/alternate fetch)
- `uploads/pasted-1782504494894-0.png` … `uploads/pasted-1783053077007-0.png` (remaining ~43)

**Thumbnails (3, small binary)**
- `templates/glass-skin-revamp/.thumbnail`
- `templates/glass-skin-revamp-e2e/.thumbnail`
- `templates/glass-coverage-audit/.thumbnail`

## Notes
- The 48 component dirs, `_ds_bundle.*`, `_vendor/`, `styles.css`, `README.md`, `_ds_sync.json` already match between remote and local (generated from the same source) — not part of this pull.
- `ds-bundle/` is gitignored; a `package-build.mjs` rebuild may wipe non-output dirs, so re-pull may be needed after a rebuild.
- Every file in the "not on local disk" list above is directly readable on the claude.ai/design website or via `DesignSync(get_file)` on demand — nothing is stranded or lost.
