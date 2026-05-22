import type { Poll } from "../data/types.ts";
import { useAgents } from "../data/context.tsx";
import { inkFor } from "./primitives.tsx";

interface PollWidgetProps {
  poll: Poll;
  me: string;
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

export function PollWidget({ poll, me, onVote }: PollWidgetProps) {
  const agents = useAgents();
  const totalEligible = poll.eligible.length;
  const totalVotes = poll.options.reduce((acc, o) => acc + o.voters.length, 0);
  const myVote = poll.options.find((o) => o.voters.includes(me))?.id;

  return (
    <div className="poll-widget">
      <div className="poll-head">
        <span className="poll-label">POLL</span>
        <span className="poll-question">{poll.question}</span>
      </div>
      <div className="poll-options">
        {poll.options.map((opt) => {
          const pct = totalVotes === 0 ? 0 : Math.round((opt.voters.length / totalVotes) * 100);
          const picked = myVote === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={`poll-option${picked ? " picked" : ""}`}
              onClick={() => onVote?.(opt.id)}
            >
              <span
                className="poll-option-icon"
                style={{
                  background: picked ? "var(--lime)" : "var(--paper-3)",
                  color: picked ? "var(--ink)" : "var(--ink-soft)",
                }}
              >
                {opt.icon ?? "•"}
              </span>
              <span className="poll-option-label">{opt.label}</span>
              <span
                className="poll-option-fill"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="poll-option-count">{opt.voters.length}</span>
              <span className="poll-option-voters">
                {opt.voters.slice(0, 5).map((vid) => {
                  const a = agents.find((x) => x.id === vid);
                  if (!a) return null;
                  return (
                    <span
                      key={vid}
                      className="poll-voter"
                      title={a.name}
                      style={{ background: a.color, color: inkFor(a.color) }}
                    >
                      {a.avatar}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <span className="poll-progress">
          <strong>{totalVotes} of {totalEligible} voted</strong>
        </span>
        <span className="poll-sep">·</span>
        <span>{closesLabel(poll.closesAt)}</span>
        <span className="poll-sep">·</span>
        <span>click an option to vote</span>
      </div>
    </div>
  );
}
