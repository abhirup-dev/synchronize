DEMO_HOME := $(CURDIR)/.demo-synchronize
DEV_SYNC_HOME := $(CURDIR)/.dev-synchronize
SYNC_HOME ?= $(if $(SYNCHRONIZE_HOME),$(SYNCHRONIZE_HOME),$(HOME)/.synchronize)

# Demo peers are seeded once and never heartbeat, so the demo daemon runs with a
# far-future lease (≈10y) — otherwise the production 60s lease would flap every
# seeded peer offline. Override path is SYNCHRONIZE_LEASE_MS (see constants.ts).
DEMO_LEASE_MS := 315360000000

MCP_BIN      := synchronize-mcp
CLAUDE_DIR   ?= $(HOME)/.claude
CODEX_DIR    ?= $(HOME)/.codex
PI_AGENT_DIR ?= $(HOME)/.pi/agent

.PHONY: help setup check-deps \
        demo demo-up demo-top demo-json demo-clean demo-spawn demo-down demo-profile \
        daemon-kill daemon-relaunch clean-slate \
        dev-daemon-kill dev-daemon-relaunch dev-clean-slate \
        reinstall-books dev-reset \
        doctor inspect-daemon inspect-peers inspect-groups inspect-events \
        link install-claude install-codex install-pi install-all \
        uninstall-claude uninstall-codex uninstall-pi uninstall-all

# `make` with no target prints help.
.DEFAULT_GOAL := help

help:
	@echo "synchronize — make targets"
	@echo
	@echo "Setup:"
	@echo "  setup            Install root + web deps and check tooling (run this first; also bootstraps a fresh worktree)"
	@echo "  check-deps       Report required/optional CLI tools and how to install them"
	@echo "Install agents (writes to your real ~/.claude, ~/.codex, ~/.pi):"
	@echo "  install-claude | install-codex | install-pi | install-all"
	@echo "  uninstall-claude | uninstall-codex | uninstall-pi | uninstall-all"
	@echo "Demo (isolated runtime under $(DEMO_HOME), never touches your real daemon):"
	@echo "  demo             Seed sample data and show the dashboard once"
	@echo "  demo-up          Reliably start the demo daemon (retries a slow cold start)"
	@echo "  demo-spawn       Launch a demo agent session via AOE into a demo group (needs aoe + install-claude)"
	@echo "  demo-top         Live dashboard for the demo runtime"
	@echo "  demo-profile     Print the AOE profile name backing the demo runtime"
	@echo "  demo-down        Stop demo daemon, delete its AOE profile, wipe the demo runtime"
	@echo "Runtime control (default home $(SYNC_HOME)):"
	@echo "  daemon-relaunch  Restart the daemon, preserving state"
	@echo "  clean-slate      Stop daemon, delete its AOE profile, wipe the runtime"
	@echo "  dev-daemon-relaunch | dev-clean-slate   Same for the dev runtime ($(DEV_SYNC_HOME))"
	@echo "Diagnostics:"
	@echo "  doctor | inspect-daemon | inspect-peers | inspect-groups | inspect-events"

setup:
	@echo "==> Installing dependencies (root + web)"
	@bun install
	@cd web && bun install
	@echo "==> Checking tooling"
	@$(MAKE) --no-print-directory check-deps || true
	@echo "==> Setup complete. 'make help' lists all targets; 'make install-claude' wires up an agent."

# Verify the CLI tooling the project leans on. Required tools fail the check;
# optional ones (needed only for launch/agent features) are reported, not fatal.
check-deps:
	@missing=0; \
	for t in bun jq; do \
		if command -v $$t >/dev/null 2>&1; then echo "  ✓ $$t"; else echo "  ✗ $$t  (REQUIRED)"; missing=1; fi; \
	done; \
	for t in tmux aoe uv claude codex pi; do \
		if command -v $$t >/dev/null 2>&1; then echo "  ✓ $$t"; else echo "  ○ $$t  (optional — needed for launch/agent features)"; fi; \
	done; \
	if [ $$missing -ne 0 ]; then \
		echo; echo "Missing REQUIRED tools. On macOS: brew install bun jq"; \
		echo "tmux + aoe are needed for 'spawn'/launch: brew install tmux && brew install agent-of-empires"; \
		exit 1; \
	fi

demo: demo-clean demo-up
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run scripts/seed-demo.ts
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run synchronize top --once
	@echo
	@echo "Live dashboard: SYNCHRONIZE_HOME=$(DEMO_HOME) bun run synchronize top"
	@echo "Raw summary:    SYNCHRONIZE_HOME=$(DEMO_HOME) bun run synchronize top --json"

# Reliably bring up the demo daemon under the isolated demo home. Starts the
# daemon directly in the background and polls /health (the CLI's auto-start path
# is unreliable on a cold start); subsequent demo commands connect to it.
demo-up:
	@mkdir -p "$(DEMO_HOME)"
	@if [ -f "$(DEMO_HOME)/daemon.json" ] && \
		curl -sf "$$(jq -r '.baseUrl // empty' "$(DEMO_HOME)/daemon.json")/health" >/dev/null 2>&1; then \
		echo "demo daemon already up ($(DEMO_HOME))"; exit 0; \
	fi
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_PORT=0 SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" nohup bun run src/daemon.ts >"$(DEMO_HOME)/daemon.out.log" 2>&1 & \
		for i in $$(seq 1 100); do \
			sleep 0.1; \
			[ -f "$(DEMO_HOME)/daemon.json" ] || continue; \
			base=$$(jq -r '.baseUrl // empty' "$(DEMO_HOME)/daemon.json" 2>/dev/null); \
			if [ -n "$$base" ] && curl -sf "$$base/health" >/dev/null 2>&1; then \
				echo "demo daemon up ($(DEMO_HOME))"; exit 0; \
			fi; \
		done; \
		echo "demo daemon failed to start; see $(DEMO_HOME)/daemon.out.log"; exit 1

demo-top:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run synchronize top

demo-json:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" SYNCHRONIZE_LEASE_MS="$(DEMO_LEASE_MS)" bun run synchronize top --json

# Print the AOE profile name backing the demo runtime (matches what the daemon
# computes from SYNCHRONIZE_HOME), so you can `aoe -p <profile> list/attach`.
demo-profile:
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun -e 'import {getRuntimePaths} from "./src/paths.ts"; import {aoeProfileName} from "./src/launch/service.ts"; console.log(aoeProfileName(getRuntimePaths().home))'

# Launch a real demo agent session via the AOE backend into a demo group,
# against the isolated demo runtime. Requires `aoe` + `tmux`, and a one-time
# `make install-claude` so the spawned agent has its synchronize wiring.
demo-spawn: demo-up
	@command -v aoe >/dev/null 2>&1 || { echo "aoe not installed — run 'make check-deps'"; exit 1; }
	@command -v claude >/dev/null 2>&1 || { echo "claude not installed — run 'make install-claude' first"; exit 1; }
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun run synchronize spawn claude --name demo-claude --repo "$(CURDIR)" --group demo-room
	@echo
	@echo "Launched demo-claude into group 'demo-room' (demo runtime $(DEMO_HOME))."
	@echo "  Watch it register + auto-join:  make demo-top"
	@echo "  Attach to the live pane:        aoe -p \`make -s demo-profile\` session attach demo-claude-<peer8>"
	@echo "  Tear everything down:           make demo-down"

# Full demo teardown: stop the demo daemon, delete its AOE profile (drops any
# spawned sessions), and wipe the demo runtime. Alias-friendly via demo-clean.
demo-down: demo-clean

demo-clean:
	@if [ -f "$(DEMO_HOME)/daemon.json" ]; then \
		pid=$$(jq -r '.pid // empty' "$(DEMO_HOME)/daemon.json"); \
		if [ -n "$$pid" ]; then kill "$$pid" 2>/dev/null || true; fi; \
	fi
	@SYNCHRONIZE_HOME="$(DEMO_HOME)" bun run scripts/aoe-teardown.ts 2>/dev/null || true
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
	@SYNCHRONIZE_HOME="$(SYNC_HOME)" bun run scripts/aoe-teardown.ts || true
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
	@SYNCHRONIZE_HOME="$(DEV_SYNC_HOME)" bun run scripts/aoe-teardown.ts || true
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
