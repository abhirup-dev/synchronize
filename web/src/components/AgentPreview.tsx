import { Dialog } from "@base-ui-components/react/dialog";
import { Brain, Check, ClipboardList, Copy, FolderGit2, Monitor, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { useAgentWorkStateHistory } from "../data/context.tsx";
import type { Agent, AgentRuntimeDetails, AgentWorkStateHistoryEntry } from "../data/types.ts";
import { Avatar } from "./primitives.tsx";
import { formatRelativeTime, historyLabel, phaseLabel } from "../workState.ts";

export interface AgentPreviewDetails extends Partial<AgentRuntimeDetails> {
  tool?: string;
  model?: string;
  thinking?: "low" | "medium" | "high" | "xhigh" | string;
  agentType?: string;
  machine?: string;
  cwd?: string;
  gitBranch?: string;
  gitDirty?: boolean;
  source?: string;
  hostSessionId?: string;
}

export interface AgentPreviewProps {
  agent: Agent;
  details?: AgentPreviewDetails;
  density?: "default" | "compact";
}

const cardBase =
  "agent-preview min-w-0 bg-surface text-fg [border:var(--card-border)] rounded-card overflow-hidden [box-shadow:var(--message-card-shadow-offset,4px)_var(--message-card-shadow-offset,4px)_0_var(--message-card-shadow-color,var(--rule))]";

const sectionTitle =
  "font-display text-[length:var(--text-10)] tracking-[var(--tracking-lg)] uppercase text-ink-soft";

const labelClass =
  "font-mono text-[length:var(--text-10)] uppercase tracking-[var(--tracking-sm)] text-ink-faint";

const valueBaseClass =
  "min-w-0 font-mono text-[length:var(--text-11)] text-ink";

export function AgentPreview({ agent, details, density = "default" }: AgentPreviewProps) {
  const runtimeDetails = details ?? agent.runtimeDetails;
  const machine = details?.machine ?? runtimeDetails?.machineId;
  const state = runtimeDetails?.launchState ?? agent.launchLifecycle?.state ?? agent.lifecycleState ?? "active";
  const compact = density === "compact";
  const loadHistory = useAgentWorkStateHistory();
  const [history, setHistory] = useState<AgentWorkStateHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    void loadHistory(agent.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Could not load recent work");
      });
    return () => { cancelled = true; };
  }, [agent.id, loadHistory]);

  return (
    <article className={cn(cardBase, compact ? "w-[320px]" : "w-[min(660px,100%)]")}>
      <header className="flex min-w-0 items-start gap-[var(--space-10)] bg-surface-raised p-[12px] [border-bottom:var(--line-sm)]">
        <Avatar agent={agent} size={compact ? 38 : 42} showStatus />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-[var(--space-8)]">
            <h3 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[length:var(--text-17)] leading-[1.05]">
              {agent.name}
            </h3>
            <span className="inline-flex items-center rounded-pill bg-surface px-[7px] py-[2px] font-mono text-[length:var(--text-10)] text-ink-soft [border:var(--control-border)]">
              {agent.status}
            </span>
          </div>
          {agent.statusNote ? (
            <p className="mt-[7px] mb-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[length:var(--text-10-5)] text-ink-soft">
              {agent.statusNote}
            </p>
          ) : null}
        </div>
      </header>

      <div className={cn("grid gap-[10px] p-[12px]", compact ? "grid-cols-1" : "grid-cols-2")}>
        <Section title="Runtime" icon={<Brain size={15} />}>
          <Detail compact={compact} label="tool" value={runtimeDetails?.tool ?? agent.role ?? "unknown"} />
          <Detail compact={compact} label="model" value={runtimeDetails?.model ?? "unknown"} />
          <Detail compact={compact} label="thinking" value={runtimeDetails?.thinking ?? "unknown"} />
          <Detail compact={compact} label="source" value={runtimeDetails?.source ?? runtimeDetails?.profileName ?? "unknown"} />
        </Section>

        <Section title="Host" icon={<Monitor size={15} />}>
          <Detail compact={compact} label="machine" value={machine ?? "unknown"} />
          <Detail compact={compact} label="session" value={runtimeDetails?.hostSessionId ?? "unknown"} />
          <Detail compact={compact} label="state" value={state} />
        </Section>

        <Section {...(compact ? {} : { className: "col-span-2" })} title="Current Work" icon={<ClipboardList size={15} />}>
          {agent.workState ? (
            <>
              <Detail compact={compact} label="phase" value={phaseLabel(agent.workState.phase)} />
              <Detail compact={compact} label="summary" value={agent.workState.summary} />
              <Detail compact={compact} label="task" value={agent.workState.task ?? "none"} />
              <Detail compact={compact} label="scope" value={agent.workState.scope ? `${agent.workState.scope.kind}:${agent.workState.scope.value}` : "none"} />
            </>
          ) : (
            <Detail compact={compact} label="state" value={agent.workStateStatus?.state === "stale" ? "expired" : "none"} />
          )}
        </Section>

        <Section {...(compact ? {} : { className: "col-span-2" })} title="Workspace" icon={<FolderGit2 size={15} />}>
          <Detail compact={compact} label="cwd" value={runtimeDetails?.cwd ?? "unknown"} />
          <Detail compact={compact} label="branch" value={runtimeDetails?.gitBranch ?? "unknown"} />
          <Detail compact={compact} label="git" value={runtimeDetails?.gitDirty === undefined ? "unknown" : runtimeDetails.gitDirty ? "dirty" : "clean"} />
        </Section>

        <Section {...(compact ? {} : { className: "col-span-2" })} title="Recent Work" icon={<ClipboardList size={15} />}>
          <RecentWorkList history={history} error={historyError} compact={compact} />
        </Section>
      </div>
    </article>
  );
}

export function AgentProfileDialog({ agent, onClose }: { agent: Agent | null; onClose(): void }) {
  return (
    <Dialog.Root open={Boolean(agent)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop fixed inset-0 z-[var(--z-modal)] grid items-start justify-items-center overflow-y-auto bg-[color-mix(in_srgb,var(--ink)_32%,transparent)] p-[24px_16px]">
          <Dialog.Popup className="relative w-[min(620px,calc(100vw-32px))] overflow-visible outline-none">
            {agent ? (
              <div className="relative w-full">
                <button
                  type="button"
                  className="absolute right-[10px] top-[10px] z-[1] inline-grid h-[26px] w-[26px] place-items-center rounded-control bg-surface-raised/90 text-fg-faint shadow-none [border:var(--line-none)] [transition:color_140ms_ease,background-color_140ms_ease,transform_140ms_ease] hover:-translate-y-px hover:bg-surface hover:text-fg focus-visible:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rule"
                  aria-label="close profile"
                  onClick={onClose}
                >
                  <X size={16} aria-hidden="true" />
                </button>
                <Dialog.Title className="sr-only">{agent.name} profile</Dialog.Title>
                <AgentPreview agent={agent} />
              </div>
            ) : null}
          </Dialog.Popup>
        </Dialog.Backdrop>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function canShowAgentPreview(agent: Agent): boolean {
  if (agent.name === "You" || agent.role === "web") return false;
  return Boolean(agent.runtimeDetails || agent.workState || agent.workStateStatus);
}

function Section({ title, icon, children, className }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-control bg-surface-raised p-[9px] [border:var(--control-border)] [box-shadow:2px_2px_0_var(--message-card-shadow-color,var(--rule))]", className)}>
      <div className="mb-[7px] flex items-center gap-[var(--space-6)]">
        {icon}
        <span className={sectionTitle}>{title}</span>
      </div>
      <div className="grid gap-[5px]">{children}</div>
    </section>
  );
}

function Detail({ label, value, compact }: { label: string; value: string | number; compact: boolean }) {
  const [copied, setCopied] = useState(false);
  const stringValue = String(value);
  const canCopy = stringValue !== "unknown";
  const displayValue = compact && stringValue.length > 22 ? `${stringValue.slice(0, 22)}...` : stringValue;

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyValue() {
    if (!canCopy) return;
    let copiedValue = false;
    try {
      await navigator.clipboard?.writeText(stringValue);
      copiedValue = true;
    } catch {
      const target = document.createElement("textarea");
      target.value = stringValue;
      target.setAttribute("readonly", "");
      target.style.position = "fixed";
      target.style.left = "-9999px";
      document.body.appendChild(target);
      target.select();
      copiedValue = document.execCommand("copy");
      target.remove();
    }
    if (copiedValue) setCopied(true);
  }

  return (
    <div className={cn("group grid min-w-0 grid-cols-[72px_minmax(0,1fr)_18px] gap-[var(--space-8)]", compact ? "items-center" : "items-start")}>
      <span className={labelClass}>{label}</span>
      <span
        className={cn(
          valueBaseClass,
          compact
            ? "overflow-hidden text-ellipsis whitespace-nowrap"
            : "whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.35]",
        )}
        title={stringValue}
      >
        {displayValue}
      </span>
      <button
        type="button"
        className={cn(
          "inline-flex h-[18px] w-[18px] items-center justify-center rounded-none bg-transparent p-0 text-fg-faint shadow-none [border:var(--line-none)] [transition:opacity_140ms_ease,color_140ms_ease,transform_140ms_ease]",
          canCopy
            ? cn(
                copied ? "opacity-100" : "opacity-0 group-hover:opacity-70",
                "hover:-translate-y-px hover:text-fg hover:opacity-100 focus-visible:opacity-100 focus-visible:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rule",
              )
            : "cursor-default opacity-25",
        )}
        aria-label={`Copy ${label}: ${stringValue}`}
        title={copied ? "Copied" : `Copy ${label}: ${stringValue}`}
        disabled={!canCopy}
        onClick={copyValue}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </div>
  );
}

function RecentWorkList({ history, error, compact }: { history: AgentWorkStateHistoryEntry[] | null; error: string | null; compact: boolean }) {
  if (error) return <div className={cn(valueBaseClass, "text-danger")}>{error}</div>;
  if (history === null) return <div className={cn(valueBaseClass, "text-ink-soft")}>loading</div>;
  if (history.length === 0) return <div className={cn(valueBaseClass, "text-ink-soft")}>none</div>;
  return (
    <div className="grid gap-[6px]">
      {history.slice(0, compact ? 3 : 5).map((entry) => (
        <div key={entry.historyId} className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)] gap-[var(--space-8)]">
          <span className={labelClass}>{historyLabel(entry)}</span>
          <span className={cn(valueBaseClass, "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap")} title={entry.summary}>
            {entry.task ?? entry.summary}
            <span className="text-ink-faint"> · {formatRelativeTime(entry.updatedAt)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
