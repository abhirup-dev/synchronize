DEMO_HOME := $(CURDIR)/.demo-synchronize
SYNC_HOME ?= $(HOME)/.synchronize

.PHONY: demo demo-top demo-json demo-clean daemon-kill daemon-relaunch

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
