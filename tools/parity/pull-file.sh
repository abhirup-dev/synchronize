#!/bin/zsh
# Pull one file from the Claude Design project to disk via a headless
# cheap-model Claude Code run. Bytes never touch the calling session's
# context; the pull is per-file with a complete, minimal prompt (the exact
# tool is named, so the model does zero searching or deciding).
#
# ┌─ SIZE CEILINGS: a cheap model truncates its OWN output ─────────────────┐
# │ A file that does not fit in one model response comes back silently cut   │
# │ off. Each model has a ceiling; pass the file's size (from list_files) as │
# │ the 4th arg and this script HARD-FAILS past the ceiling instead of       │
# │ writing a torso:                                                         │
# │                                                                          │
# │   luna   < 32 KiB   — haiku-class, small output limit (DEFAULT)          │
# │   terra  < 256 KiB  — sonnet-class, big output limit                     │
# │                                                                          │
# │ ≥ 32 KiB  → re-run on terra:                                             │
# │              tools/parity/pull-file.sh <path> <out> terra <size>         │
# │ ≥ 256 KiB → too big for any cheap pull. Pull in the MAIN session with    │
# │              the MCP tool  mcp__claude_design__read_file  (the harness    │
# │              spills the big result to a tool-results JSON on disk), then  │
# │              decode + write with tools/parity/extract-tool-result.mjs.    │
# └──────────────────────────────────────────────────────────────────────────┘
#
# Usage:
#   tools/parity/pull-file.sh <projectPath> [outFile] [model] [expectedBytes]
#     model:         luna (default, VibeProxy) | terra (VibeProxy) | sonnet (Anthropic)
#     expectedBytes: size from list_files. If given, the script refuses past the
#                    model's ceiling and verifies the pulled size afterward.
#
# Prints the pulled file's sha256. Re-run to verify determinism if in doubt.

set -euo pipefail
PROJECT_ID="41739566-4de3-4dda-90bc-a7777d50b42d"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPATH="$1"
OUT="${2:-$ROOT/ds-bundle/$RPATH}"
MODEL="${3:-luna}"
EXPECT="${4:-}"

# Per-model output ceilings (bytes). A cheap model cannot reliably emit a file
# bigger than this in one Write, so refuse up front rather than write a torso.
LUNA_MAX="${LUNA_MAX:-32768}"     # haiku-class: small output limit
TERRA_MAX="${TERRA_MAX:-262144}"  # sonnet-class: ~read_file's 256 KiB cap
case "$MODEL" in
  luna)          CEIL="$LUNA_MAX";  ESCALATE="re-run on terra: tools/parity/pull-file.sh $RPATH ${2:-<out>} terra $EXPECT" ;;
  terra|sonnet)  CEIL="$TERRA_MAX"; ESCALATE="too big for any cheap pull — pull in the MAIN session with mcp__claude_design__read_file, then decode with tools/parity/extract-tool-result.mjs" ;;
esac
if [[ -n "$EXPECT" && "$EXPECT" -ge "$CEIL" ]]; then
  print -r -- "ERROR: $RPATH is $EXPECT bytes (>= $MODEL ceiling ${CEIL}). A cheap model truncates its own output — $ESCALATE" >&2
  exit 2
fi

mkdir -p "$(dirname "$OUT")"
# A pre-existing target trips the child's Write "read the file first" guard.
# A pull replaces the file wholesale, so clear it before delegating.
rm -f "$OUT"

PROMPT="Call the DesignSync tool with method get_file, projectId $PROJECT_ID, path $RPATH. Write the returned content string EXACTLY as-is (byte-for-byte, no reformatting, no added trailing newline beyond what the content has) to $OUT using the Write tool. Then run: shasum -a 256 $OUT — and reply with ONLY that sha line. Do not read any other files. If the tool errors, reply with the error text prefixed ERROR:."

# ── Delegation ────────────────────────────────────────────────────────────
# Reminder: this cheap-model path is for SMALL files only. Large files must be
# pulled in the main session with mcp__claude_design__read_file (see header).
case "$MODEL" in
  luna|terra)
    GPTM="gpt-5.6-$([ "$MODEL" = luna ] && echo luna || echo terra)"
    CLASS="$([ "$MODEL" = luna ] && echo haiku || echo sonnet)"
    print -r -- "$PROMPT" | ANTHROPIC_BASE_URL="${VIBEPROXY_BASE_URL:-http://127.0.0.1:8318}" \
      ANTHROPIC_AUTH_TOKEN="${VIBEPROXY_API_KEY:-vibeproxy-local}" \
      API_TIMEOUT_MS=600000 \
      ANTHROPIC_DEFAULT_HAIKU_MODEL="$GPTM" ANTHROPIC_DEFAULT_SONNET_MODEL="$GPTM" \
      "$HOME/.local/bin/claude" --model "$CLASS" --effort low -p --dangerously-skip-permissions 2>/dev/null | tail -1
    ;;
  sonnet)  # no env needed — native Anthropic
    print -r -- "$PROMPT" | "$HOME/.local/bin/claude" --model sonnet --effort low -p --dangerously-skip-permissions 2>/dev/null | tail -1
    ;;
  *) echo "unknown model: $MODEL (luna|terra|sonnet)" >&2; exit 1 ;;
esac

# Truncation check: if we were told the expected size, a mismatch means the
# model cut its output short — fail loud instead of leaving a torso on disk.
if [[ -n "$EXPECT" ]]; then
  GOT="$(wc -c < "$OUT" | tr -d ' ')"
  if [[ "$GOT" != "$EXPECT" ]]; then
    print -r -- "ERROR: pulled $GOT bytes but expected $EXPECT — likely truncated. Use mcp__claude_design__read_file in the main session instead." >&2
    exit 3
  fi
fi
