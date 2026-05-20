DEMO_HOME := $(CURDIR)/.demo-synchronize
SYNC_HOME ?= $(HOME)/.synchronize

MCP_BIN      := synchronize-mcp
CLAUDE_DIR   ?= $(HOME)/.claude
CODEX_DIR    ?= $(HOME)/.codex
PI_AGENT_DIR ?= $(HOME)/.pi/agent

.PHONY: demo demo-top demo-json demo-clean daemon-kill daemon-relaunch \
        link install-claude install-codex install-pi install-all \
        uninstall-claude uninstall-codex uninstall-pi uninstall-all

demo: demo-clean
	@mkdir -p "$(DEMO_HOME)"
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun run scripts/seed-demo.ts
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun run synchronize top --once
	@echo
	@echo "Live dashboard: SYNCHRONIZE_HOME=$(DEMO_HOME) bun run synchronize top"
	@echo "Raw summary:    SYNCHRONIZE_HOME=$(DEMO_HOME) bun run synchronize top --json"

demo-top:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun run synchronize top

demo-json:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun run synchronize top --json

demo-clean:
	@if [ -f "$(DEMO_HOME)/daemon.json" ]; then \
		pid=$$(jq -r '.pid // empty' "$(DEMO_HOME)/daemon.json"); \
		if [ -n "$$pid" ]; then kill "$$pid" 2>/dev/null || true; fi; \
	fi
	@rm -rf "$(DEMO_HOME)"

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
	@rm -rf "$(SYNC_HOME)"
	@echo "Removed synchronize runtime $(SYNC_HOME)"

daemon-relaunch: daemon-kill
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bun run synchronize status

# --- install targets -------------------------------------------------------

link:
	@bun install >/dev/null
	@bun link >/dev/null
	@command -v $(MCP_BIN) >/dev/null || { echo "$(MCP_BIN) not on PATH after 'bun link'"; exit 1; }
	@echo "linked $(MCP_BIN) -> $$(readlink $$(command -v $(MCP_BIN)))"

install-claude: link
	@command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
	@claude mcp remove synchronize -s user 2>/dev/null || true
	@claude mcp add synchronize $(MCP_BIN) --scope user -e SYNCHRONIZE_MCP_MODE=claude
	@mkdir -p $(CLAUDE_DIR)/skills
	@rm -rf $(CLAUDE_DIR)/skills/synchronize
	@cp -R skills/synchronize-claude $(CLAUDE_DIR)/skills/synchronize
	@echo "Claude: MCP server registered + skill copied to $(CLAUDE_DIR)/skills/synchronize"

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
