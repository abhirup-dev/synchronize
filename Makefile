DEMO_HOME := $(CURDIR)/.demo-synchronize
DEV_SYNC_HOME := $(CURDIR)/.dev-synchronize
SYNC_HOME ?= $(HOME)/.synchronize

# Demo peers are seeded once and never heartbeat, so the demo daemon runs with a
# far-future lease (≈10y) — otherwise the production 60s lease would flap every
# seeded peer offline. Override path is SYNCHRONIZE_LEASE_MS (see constants.ts).
DEMO_LEASE_MS := 315360000000

MCP_BIN      := synchronize-mcp
CLAUDE_DIR   ?= $(HOME)/.claude
CODEX_DIR    ?= $(HOME)/.codex
PI_AGENT_DIR ?= $(HOME)/.pi/agent

.PHONY: setup demo demo-top demo-json demo-clean \
        daemon-kill daemon-relaunch clean-slate \
        dev-daemon-kill dev-daemon-relaunch dev-clean-slate \
        reinstall-books dev-reset \
        doctor inspect-daemon inspect-peers inspect-groups inspect-events \
        link install-claude install-codex install-pi install-all \
        uninstall-claude uninstall-codex uninstall-pi uninstall-all

setup:
	@bun install
	@cd web && bun install
	@echo "Installed root and web dependencies"

demo: demo-clean
	@mkdir -p "$(DEMO_HOME)"
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run scripts/seed-demo.ts
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run synchronize top --once
	@echo
	@echo "Live dashboard: SYNCHRONIZE_HOME=$(DEMO_HOME) bun run synchronize top"
	@echo "Raw summary:    SYNCHRONIZE_HOME=$(DEMO_HOME) bun run synchronize top --json"

demo-top:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run synchronize top

demo-json:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run synchronize top --json

demo-clean:
	@if [ -f "$(DEMO_HOME)/daemon.json" ]; then \
		pid=$$(jq -r '.pid // empty' "$(DEMO_HOME)/daemon.json"); \
		if [ -n "$$pid" ]; then kill "$$pid" 2>/dev/null || true; fi; \
	fi
	@rm -rf "$(DEMO_HOME)"

# daemon-kill stops the daemon but preserves runtime state (DB, media, logs).
# Use `clean-slate` when you actually want to wipe state. This split matters
# because production debugging sessions need to stop/restart the daemon
# without losing peers, groups, and message history.
daemon-kill:
	@if [ -f "$(SYNC_HOME)/daemon.json" ]; then \
		pid=$$(jq -r '.pid // empty' "$(SYNC_HOME)/daemon.json"); \
		if [ -n "$$pid" ] && kill -0 "$$pid" 2>/dev/null; then \
			kill "$$pid" 2>/dev/null || true; \
			sleep 0.5; \
			kill -0 "$$pid" 2>/dev/null && kill -9 "$$pid" 2>/dev/null || true; \
			echo "Killed synchronize daemon pid $$pid"; \
		fi; \
	fi
	@pkill -f "$(CURDIR)/src/daemon.ts" 2>/dev/null || true

clean-slate: daemon-kill
	@rm -rf "$(SYNC_HOME)"
	@echo "Removed synchronize runtime $(SYNC_HOME)"

daemon-relaunch: daemon-kill
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bun run synchronize status

dev-daemon-kill:
	@if [ -f "$(DEV_SYNC_HOME)/daemon.json" ]; then \
		pid=$$(jq -r '.pid // empty' "$(DEV_SYNC_HOME)/daemon.json"); \
		if [ -n "$$pid" ] && kill -0 "$$pid" 2>/dev/null; then \
			kill "$$pid" 2>/dev/null || true; \
			sleep 0.5; \
			kill -0 "$$pid" 2>/dev/null && kill -9 "$$pid" 2>/dev/null || true; \
			echo "Killed dev synchronize daemon pid $$pid"; \
		fi; \
	fi

dev-clean-slate: dev-daemon-kill
	@rm -rf "$(DEV_SYNC_HOME)"
	@echo "Removed dev synchronize runtime $(DEV_SYNC_HOME)"

dev-daemon-relaunch: dev-daemon-kill link reinstall-books
	@SYNCHRONIZE_HOME="$(DEV_SYNC_HOME)" bun run synchronize status

reinstall-books: install-claude install-pi

dev-reset: dev-daemon-relaunch

# --- diagnostics -----------------------------------------------------------
# All targets honor SYNCHRONIZE_HOME; in dev-server mode call as
# `SYNCHRONIZE_HOME=$(DEV_SYNC_HOME) make doctor` to target the dev runtime.

doctor:
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bash scripts/doctor.sh all

inspect-daemon:
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bash scripts/doctor.sh daemon

inspect-peers:
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bash scripts/doctor.sh peers

inspect-groups:
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bash scripts/doctor.sh groups

inspect-events:
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" N="$(N)" bash scripts/doctor.sh events

# --- install targets -------------------------------------------------------

link: setup
	@bun link >/dev/null
	@command -v $(MCP_BIN) >/dev/null || { echo "$(MCP_BIN) not on PATH after 'bun link'"; exit 1; }
	@echo "linked $(MCP_BIN) -> $$(readlink $$(command -v $(MCP_BIN)))"

install-claude: link
	@command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
	@claude mcp remove synchronize -s user 2>/dev/null || true
	@cmd="$$(bun run scripts/resilient-mcp-command.ts)"; \
		claude mcp add synchronize --scope user -e SYNCHRONIZE_MCP_MODE=claude -- sh -c "$$cmd"
	@bun run scripts/claude-hooks-config.ts $(CLAUDE_DIR)/settings.json
	@mkdir -p $(CLAUDE_DIR)/skills
	@rm -rf $(CLAUDE_DIR)/skills/synchronize
	@cp -R skills/synchronize-claude $(CLAUDE_DIR)/skills/synchronize
	@echo "Claude: MCP server registered + hook configured + skill copied to $(CLAUDE_DIR)/skills/synchronize"

install-codex: link
	@command -v codex >/dev/null || { echo "codex CLI not found"; exit 1; }
	@codex mcp remove synchronize 2>/dev/null || true
	@codex mcp add --env SYNCHRONIZE_MCP_MODE=codex synchronize -- $(MCP_BIN)
	@mkdir -p $(CODEX_DIR)/skills
	@rm -rf $(CODEX_DIR)/skills/synchronize
	@cp -R skills/synchronize-codex $(CODEX_DIR)/skills/synchronize
	@echo "Codex: MCP server registered + skill copied to $(CODEX_DIR)/skills/synchronize"

install-pi: link
	@mkdir -p $(PI_AGENT_DIR)/extensions $(PI_AGENT_DIR)/skills
	@bun run scripts/pi-mcp-config.ts $(PI_AGENT_DIR)/mcp.json
	@printf '%s\n' \
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";' \
		'import synchronizeExtension from "$(CURDIR)/extensions/pi-synchronize/src/index.ts";' \
		'' \
		'export default function (pi: ExtensionAPI) {' \
		'  synchronizeExtension(pi as unknown as Parameters<typeof synchronizeExtension>[0]);' \
		'}' \
		> $(PI_AGENT_DIR)/extensions/synchronize.ts
	@rm -rf $(PI_AGENT_DIR)/skills/synchronize
	@cp -R skills/synchronize-pi $(PI_AGENT_DIR)/skills/synchronize
	@echo "Pi: mcp.json updated + extension shim written + skill copied to $(PI_AGENT_DIR)/skills/synchronize"

install-all: install-claude install-codex install-pi

uninstall-claude:
	@command -v claude >/dev/null && claude mcp remove synchronize -s user 2>/dev/null || true
	@bun run scripts/claude-hooks-config.ts --remove $(CLAUDE_DIR)/settings.json
	@rm -rf $(CLAUDE_DIR)/skills/synchronize
	@echo "Claude: removed"

uninstall-codex:
	@command -v codex >/dev/null && codex mcp remove synchronize 2>/dev/null || true
	@rm -rf $(CODEX_DIR)/skills/synchronize
	@echo "Codex: removed"

uninstall-pi:
	@bun run scripts/pi-mcp-config.ts --remove $(PI_AGENT_DIR)/mcp.json
	@rm -f $(PI_AGENT_DIR)/extensions/synchronize.ts
	@rm -rf $(PI_AGENT_DIR)/skills/synchronize
	@echo "Pi: removed"

uninstall-all: uninstall-claude uninstall-codex uninstall-pi
