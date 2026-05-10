DEMO_HOME := $(CURDIR)/.demo-synchronize

.PHONY: demo demo-top demo-json demo-clean

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
