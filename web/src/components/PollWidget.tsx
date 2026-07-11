import { cva } from "class-variance-authority";
import type { Poll } from "../data/types.ts";
import type { Agent } from "../data/types.ts";
import { cn } from "../lib/cn";
import { IdentityBadge } from "./primitives.tsx";

/**
 * Poll widget styling migrated off extra.css (`.poll-*` family) into Tailwind
 * utilities. The legacy styles.css `.poll` / `.poll-opt*` block is a separate,
 * older markup not rendered here and is left untouched. Token values are
 * reproduced exactly via primitive utilities + var()-referencing arbitraries.
 * Dynamic bits (icon bg/fg, fill width %) stay as inline styles.
 */
const pollOption = cva(
  [
    "relative grid grid-cols-[auto_1fr_auto_auto] items-center gap-[var(--space-10)]",
    "px-[10px] py-[8px] [border:var(--line-sm)] bg-paper rounded-lg cursor-pointer overflow-hidden",
    "text-left font-mono text-[length:var(--text-12)] text-ink",
    "hover:bg-paper-3",
  ],
  {
    variants: {
      picked: {
        true: "border-rule shadow-hover",
        false: null,
      },
    },
    defaultVariants: { picked: false },
  },
);

interface PollWidgetProps {
  poll: Poll;
  me: string;
  agents: Agent[];
  onVote?(optionId: string): void;
}

function closesLabel(closesAt: string | undefined): string {
  if (!closesAt) return "open · no deadline";
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return "closed";
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  return `closes in ${min}m ${sec.toString().padStart(2, "0")}s`;
}

export function PollWidget({ poll, me, agents, onVote }: PollWidgetProps) {
  const totalEligible = poll.eligible.length;
  const totalVotes = poll.options.reduce((acc, o) => acc + o.voters.length, 0);
  const myVote = poll.options.find((o) => o.voters.includes(me))?.id;

  return (
    <div className="mt-[10px] flex flex-col gap-[var(--space-10)] [border:var(--line-sm)] rounded-xl bg-paper-2 p-[var(--space-12)] shadow-sm">
      <div className="flex items-center gap-[var(--space-10)]">
        <span className="font-display text-[length:var(--text-11)] tracking-[var(--tracking-lg)] bg-ink text-on-ink px-[8px] py-[3px] rounded-sm">
          POLL
        </span>
        <span className="font-display text-[length:var(--text-14)] text-ink">{poll.question}</span>
      </div>
      <div className="flex flex-col gap-[var(--space-6)]">
        {poll.options.map((opt) => {
          const pct = totalVotes === 0 ? 0 : Math.round((opt.voters.length / totalVotes) * 100);
          const picked = myVote === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={cn(pollOption({ picked }))}
              onClick={() => onVote?.(opt.id)}
            >
              <span
                className="z-[var(--z-local-base)] grid h-[22px] w-[22px] place-items-center [border:var(--line-xs)] rounded-xs font-display text-[length:var(--text-12)]"
                style={{
                  background: picked ? "var(--lime)" : "var(--paper-3)",
                  color: picked ? "var(--ink)" : "var(--ink-soft)",
                }}
              >
                {opt.icon ?? "•"}
              </span>
              <span className="z-[var(--z-local-base)] font-display text-[length:var(--text-12)] tracking-[var(--tracking-sm)]">
                {opt.label}
              </span>
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 z-[var(--z-local-floor)] [transition:width_240ms_ease]",
                  picked
                    ? "bg-[color-mix(in_srgb,var(--lime)_55%,transparent)]"
                    : "bg-[color-mix(in_srgb,var(--lime)_35%,transparent)]",
                )}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="z-[var(--z-local-base)] font-bold">{opt.voters.length}</span>
              <span className="z-[var(--z-local-base)] inline-flex">
                {opt.voters.slice(0, 5).map((vid) => {
                  const a = agents.find((x) => x.id === vid);
                  if (!a) return null;
                  return (
                    <IdentityBadge
                      key={vid}
                      className="grid h-[18px] w-[18px] place-items-center [border:var(--line-xs)] rounded-xs [font-family:var(--font-avatar)] text-[length:var(--text-9)] -ml-[4px] shadow-xs first:ml-0"
                      color={a.color}
                      {...(a.colorRef ? { colorRef: a.colorRef } : null)}
                      title={a.name}
                    >
                      {a.avatar}
                    </IdentityBadge>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-[var(--space-6)] [border-top:var(--line-dashed-faint)] pt-[var(--space-8)] font-mono text-[length:var(--text-11)] text-ink-soft">
        <span>
          <strong className="text-ink">{totalVotes} of {totalEligible} voted</strong>
        </span>
        <span className="text-ink-faint">·</span>
        <span>{closesLabel(poll.closesAt)}</span>
        <span className="text-ink-faint">·</span>
        <span>click an option to vote</span>
      </div>
    </div>
  );
}
