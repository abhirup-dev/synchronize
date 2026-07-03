#!/usr/bin/env sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
force=0
if [ "${1:-}" = "--force" ]; then
  force=1
fi

if [ "${SYNCHRONIZE_SKIP_THEME_GUARD:-}" = "1" ]; then
  echo "synchronize: skipping theme contract guard (SYNCHRONIZE_SKIP_THEME_GUARD=1)"
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "synchronize: bun is required to run the web theme contract guard" >&2
  exit 1
fi

if [ "$force" -ne 1 ]; then
  staged_paths="$(git diff --cached --name-only --diff-filter=ACMR)"
  if [ -z "$staged_paths" ]; then
    exit 0
  fi

  should_check=0
  while IFS= read -r path; do
    case "$path" in
      web/src/*|\
      web/.storybook/*|\
      web/scripts/check-theme-contract.mjs|\
      web/scripts/theme-contract-policy.mjs|\
      web/scripts/generate-theme-registry.mjs|\
      web/package.json|\
      web/bun.lock)
        should_check=1
        break
        ;;
    esac
  done <<EOF
$staged_paths
EOF

  if [ "$should_check" -ne 1 ]; then
    exit 0
  fi
fi

echo "synchronize: running strict web theme contract guard"
cd "$repo_root/web"
bun run check:theme-contract:strict
