import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useArchiveCommands, useArchivedSessions, useRooms } from "../data/context.tsx";
import type { Agent, ArchivePreview, ArchivedSession, ResumePreview, Room } from "../data/types.ts";
import { useToast } from "./Toast.tsx";
import { copyText } from "../utils/clipboard.ts";

interface ArchiveWorkflow {
  openConsole(): void;
  archiveGroup(room: Room): void;
  resumeGroup(room: Room): void;
  archiveSession(agent: Agent): void;
  resumeSession(agent: Agent): void;
}

const ArchiveWorkflowCtx = createContext<ArchiveWorkflow | null>(null);

/**
 * Archive console/dialog/details chrome migrated off styles.css `.archive-*`
 * to inline Tailwind utilities + CVA (tokens bridged via tw.css `@theme
 * inline`). `modal-backdrop` (skin-glass hook, shared with SpawnAgentDialog)
 * and `shell-overlay-close` (shared with App.tsx) are left untouched.
 */
const dialogShell = cva(
  [
    "flex max-h-[min(760px,calc(100vh-40px))] flex-col gap-[14px] overflow-auto",
    "bg-paper p-[16px] text-ink [border:var(--line-md)] rounded-lg shadow-lg",
  ],
  {
    variants: {
      variant: {
        console: "w-[min(980px,calc(100vw-40px))]",
        dialog: "w-[min(760px,calc(100vw-40px))]",
        details: "fixed right-[28px] top-1/2 -translate-y-1/2 z-[calc(var(--z-modal)+1)] w-[min(440px,calc(100vw-56px))]",
      },
    },
  },
);

const archiveHead = "flex items-start justify-between gap-[16px] [border-bottom:var(--line-xs)] pb-[10px]";
const archiveHeadTitle = "m-0 font-display text-[length:var(--text-22)] tracking-[var(--tracking-xs)]";
const archiveHeadSub = "mx-0 mb-0 mt-[4px] text-ink-soft text-[length:var(--text-12)]";
const archiveInput = "min-h-[36px] w-full bg-paper-2 px-[10px] text-ink [border:var(--line-xs)] rounded-sm font-ui";
const archiveTable = "grid gap-[6px]";
const archiveRow = "grid grid-cols-[minmax(160px,1.6fr)_minmax(74px,0.55fr)_minmax(92px,0.8fr)_minmax(132px,1fr)] items-center gap-[10px] min-h-[36px] px-[9px] py-[7px] bg-paper-2 [border:var(--line-hair)] rounded-sm text-[length:var(--text-12)]";
const archiveRowHead = "min-h-[30px] bg-ink text-paper font-display text-[length:var(--text-9)] tracking-[var(--tracking-md)]";
const archiveBtn = "min-h-[30px] px-[10px] bg-paper text-ink [border:var(--line-xs)] rounded-sm shadow-xs font-ui font-bold";
const archiveActions = "flex items-center justify-end gap-[8px]";
const archiveNotice = "p-[16px] bg-paper-2 text-ink-soft [border:var(--line-dashed-xs)] rounded-sm";
const archiveField = "grid gap-[6px] text-[length:var(--text-12)] text-ink-soft";

type PreviewState =
  | { kind: "archive"; target: "group"; title: string; group: string; reason: string; loading: boolean; preview?: ArchivePreview; error?: string }
  | { kind: "archive"; target: "session"; title: string; peerId: string; reason: string; loading: boolean; preview?: ArchivePreview; error?: string }
  | { kind: "resume"; target: "group"; title: string; group: string; force: boolean; loading: boolean; preview?: ResumePreview; error?: string }
  | { kind: "resume"; target: "session"; title: string; peerId: string; force: boolean; loading: boolean; preview?: ResumePreview; error?: string };

export function ArchiveRecoveryProvider({ children }: { children: ReactNode }) {
  const commands = useArchiveCommands();
  const toast = useToast();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const loadArchiveGroup = (room: Room, reason = "") => {
    const next: PreviewState = { kind: "archive", target: "group", title: `Archive #${room.name}`, group: room.name, reason, loading: true };
    setPreview(next);
    void commands.archiveGroupPreview({ group: room.name, reason }).then(
      (result) => setPreview({ ...next, loading: false, preview: result }),
      (error) => setPreview({ ...next, loading: false, error: formatError(error) }),
    );
  };

  const loadArchiveSession = (agent: Agent, reason = "") => {
    const next: PreviewState = { kind: "archive", target: "session", title: `Archive ${agent.name}`, peerId: agent.id, reason, loading: true };
    setPreview(next);
    void commands.archiveSessionPreview({ peerId: agent.id, reason }).then(
      (result) => setPreview({ ...next, loading: false, preview: result }),
      (error) => setPreview({ ...next, loading: false, error: formatError(error) }),
    );
  };

  const loadResumeGroup = (room: Room, force = false) => {
    const next: PreviewState = { kind: "resume", target: "group", title: `Resume #${room.name}`, group: room.name, force, loading: true };
    setPreview(next);
    void commands.resumeGroupPreview({ group: room.name, force }).then(
      (result) => setPreview({ ...next, loading: false, preview: result }),
      (error) => setPreview({ ...next, loading: false, error: formatError(error) }),
    );
  };

  const loadResumeSession = (agent: Agent, force = false) => {
    const next: PreviewState = { kind: "resume", target: "session", title: `Resume ${agent.name}`, peerId: agent.id, force, loading: true };
    setPreview(next);
    void commands.resumeSessionPreview({ peerId: agent.id, force }).then(
      (result) => setPreview({ ...next, loading: false, preview: result }),
      (error) => setPreview({ ...next, loading: false, error: formatError(error) }),
    );
  };

  const workflow = useMemo<ArchiveWorkflow>(() => ({
    openConsole: () => setConsoleOpen(true),
    archiveGroup: (room) => loadArchiveGroup(room),
    resumeGroup: (room) => loadResumeGroup(room),
    archiveSession: (agent) => loadArchiveSession(agent),
    resumeSession: (agent) => loadResumeSession(agent),
  }), []);

  const confirmPreview = async () => {
    if (!preview) return;
    try {
      if (preview.kind === "archive" && preview.target === "group") {
        const result = await commands.confirmArchiveGroup({ group: preview.group, reason: preview.reason });
        toast.show(`Archived ${countAction(result, "archived")} session(s)`, { kind: "success" });
      } else if (preview.kind === "archive") {
        const result = await commands.confirmArchiveSession({ peerId: preview.peerId, reason: preview.reason });
        toast.show(`Archive result: ${result.members[0]?.action ?? "done"}`, { kind: "success" });
      } else if (preview.kind === "resume" && preview.target === "group") {
        await commands.confirmResumeGroup({ group: preview.group, force: preview.force });
        toast.show("Resume requested", { kind: "success" });
      } else {
        await commands.confirmResumeSession({ peerId: preview.peerId, force: preview.force });
        toast.show("Resume requested", { kind: "success" });
      }
      setPreview(null);
      setConsoleOpen(true);
    } catch (error) {
      toast.show(formatError(error), { kind: "error" });
    }
  };

  return (
    <ArchiveWorkflowCtx.Provider value={workflow}>
      {children}
      {consoleOpen && <ArchiveConsole onClose={() => setConsoleOpen(false)} onResumeGroup={loadResumeGroup} onResumeSession={(session) => loadResumeSession(sessionToAgent(session))} />}
      {preview && (
        <ArchivePreviewDialog
          state={preview}
          onClose={() => setPreview(null)}
          onConfirm={confirmPreview}
          onReason={(reason) => {
            if (preview.kind !== "archive") return;
            setPreview({ ...preview, reason });
          }}
          onForce={(force) => {
            if (preview.kind !== "resume") return;
            if (preview.target === "group") loadResumeGroup({ id: preview.group, kind: "group", name: preview.group, color: "#111111", members: [], unread: 0 }, force);
            else loadResumeSession({ id: preview.peerId, name: preview.title.replace(/^Resume /, ""), handle: preview.peerId, color: "#111111", role: "", status: "offline", avatar: "?" }, force);
          }}
        />
      )}
    </ArchiveWorkflowCtx.Provider>
  );
}

export function useArchiveWorkflow() {
  const ctx = useContext(ArchiveWorkflowCtx);
  if (!ctx) throw new Error("ArchiveRecoveryProvider missing");
  return ctx;
}

function ArchiveConsole({
  onClose,
  onResumeGroup,
  onResumeSession,
}: {
  onClose(): void;
  onResumeGroup(room: Room, force?: boolean): void;
  onResumeSession(session: ArchivedSession): void;
}) {
  const archived = useArchivedSessions();
  const rooms = useRooms();
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState("all");
  const [selected, setSelected] = useState<ArchivedSession | null>(null);
  const filtered = archived.filter((session) => {
    const haystack = [session.sessionName, session.peerId, session.tool, ...session.aliases.flatMap((alias) => [alias.group, alias.alias])].join(" ").toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (tool === "all" || session.tool === tool);
  });
  const grouped = groupArchived(filtered);
  const tools = [...new Set(archived.map((session) => session.tool))].sort();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={cn(dialogShell({ variant: "console" }))} role="dialog" aria-modal="true" aria-label="archive" onMouseDown={(event) => event.stopPropagation()}>
        <header className={archiveHead}>
          <div>
            <h2 className={archiveHeadTitle}>ARCHIVE</h2>
            <p className={archiveHeadSub}>Archived sessions and reserved group seats</p>
          </div>
          <button type="button" className="shell-overlay-close" onClick={onClose} aria-label="close archive">×</button>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-[10px]">
          <input className={archiveInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archived sessions..." />
          <select className={archiveInput} value={tool} onChange={(event) => setTool(event.target.value)} aria-label="tool filter">
            <option value="all">all tools</option>
            {tools.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className={archiveTable}>
          <div className={cn(archiveRow, archiveRowHead)}>
            <span>GROUP / SESSION</span>
            <span>TOOL</span>
            <span>ARCHIVED</span>
            <span>ACTION</span>
          </div>
          {grouped.map(([group, sessions]) => {
            const room = rooms.find((candidate) => candidate.kind === "group" && candidate.name === group);
            return (
              <div key={group}>
                <div className={cn(archiveRow, "bg-yellow font-bold")}>
                  <strong>#{group}</strong>
                  <span>{sessions.length} archived</span>
                  <span />
                  <button type="button" className={archiveBtn} onClick={() => onResumeGroup(room ?? { id: group, kind: "group", name: group, color: "#111111", members: [], unread: 0 })}>Resume group</button>
                </div>
                {sessions.map((session) => (
                  <div key={session.peerId} className={archiveRow}>
                    <span>@{session.aliases.find((alias) => alias.group === group)?.alias ?? session.sessionName}</span>
                    <span>{session.tool}</span>
                    <span>{relativeTime(session.archivedAt)}</span>
                    <span className={archiveActions}>
                      <button type="button" className={archiveBtn} onClick={() => setSelected(session)}>Details</button>
                      <button type="button" className={archiveBtn} onClick={() => onResumeSession(session)}>Preview</button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          {grouped.length === 0 && <div className={archiveNotice}>No archived sessions match this view.</div>}
        </div>
      </section>
      {selected && <ArchiveDetails session={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ArchivePreviewDialog({
  state,
  onClose,
  onConfirm,
  onReason,
  onForce,
}: {
  state: PreviewState;
  onClose(): void;
  onConfirm(): void;
  onReason(reason: string): void;
  onForce(force: boolean): void;
}) {
  const rows = state.kind === "archive" ? state.preview?.members : state.preview?.members;
  const blocked = state.kind === "resume" && rows?.some((row) => row.action === "blocked" && !("forceAvailable" in row && row.forceAvailable));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={cn(dialogShell({ variant: "dialog" }))} role="dialog" aria-modal="true" aria-label={state.title} onMouseDown={(event) => event.stopPropagation()}>
        <header className={archiveHead}>
          <div>
            <h2 className={archiveHeadTitle}>{state.title}</h2>
            <p className={archiveHeadSub}>{state.kind === "archive" ? "Review the dry run before archiving." : "Review the dry run before resuming."}</p>
          </div>
          <button type="button" className="shell-overlay-close" onClick={onClose} aria-label="close preview">×</button>
        </header>
        {state.loading ? (
          <div className={archiveNotice}>Loading preview...</div>
        ) : state.error ? (
          <div className={cn(archiveNotice, "text-red")}>{state.error}</div>
        ) : (
          <>
            <div className={archiveTable}>
              <div className={cn(archiveRow, archiveRowHead)}>
                <span>SESSION</span>
                <span>TOOL</span>
                <span>RESULT</span>
                <span>NOTES</span>
              </div>
              {rows?.map((row) => (
                <div key={row.peerId} className={archiveRow}>
                  <span>{"alias" in row && row.alias ? `@${row.alias}` : row.sessionName ?? row.peerId}</span>
                  <span>{row.tool}</span>
                  <span>{row.action}</span>
                  <span>{("warning" in row && row.warning) || ("zombie" in row && row.zombie ? "zombie process" : "")}</span>
                </div>
              ))}
            </div>
            {state.kind === "archive" && (
              <label className={archiveField}>
                <span>Reason</span>
                <input className={archiveInput} value={state.reason} onChange={(event) => onReason(event.target.value)} placeholder="optional archive reason" />
              </label>
            )}
            {state.kind === "resume" && rows?.some((row) => "forceAvailable" in row && row.forceAvailable) && (
              <label className={cn(archiveField, "grid-cols-[auto_1fr] items-center")}>
                <input type="checkbox" checked={state.force} onChange={(event) => onForce(event.target.checked)} />
                <span>Force live blocked sessions</span>
              </label>
            )}
          </>
        )}
        <footer className={archiveActions}>
          <button type="button" className={cn(archiveBtn, "disabled:cursor-not-allowed disabled:opacity-50")} onClick={onClose}>Cancel</button>
          <button type="button" className={cn(archiveBtn, "bg-ink text-paper disabled:cursor-not-allowed disabled:opacity-50")} disabled={state.loading || Boolean(state.error) || Boolean(blocked)} onClick={onConfirm}>
            {state.kind === "archive" ? "Confirm archive" : "Confirm resume"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ArchiveDetails({ session, onClose }: { session: ArchivedSession; onClose(): void }) {
  return (
    <section className={cn(dialogShell({ variant: "details" }))} role="dialog" aria-modal="true" aria-label="archive details" onMouseDown={(event) => event.stopPropagation()}>
      <header className={archiveHead}>
        <div>
          <h2 className={archiveHeadTitle}>{session.sessionName}</h2>
          <p className={archiveHeadSub}>{session.tool} archived {relativeTime(session.archivedAt)}</p>
        </div>
        <button type="button" className="shell-overlay-close" onClick={onClose} aria-label="close details">×</button>
      </header>
      <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-[12px] gap-y-[8px] text-[length:var(--text-12)]">
        <dt className="font-display text-[length:var(--text-9)] uppercase tracking-[var(--tracking-md)] text-ink-soft">peer_id</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere] font-mono">{session.peerId}</dd>
        <dt className="font-display text-[length:var(--text-9)] uppercase tracking-[var(--tracking-md)] text-ink-soft">reason</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere] font-mono">{session.archivedReason ?? "none"}</dd>
        <dt className="font-display text-[length:var(--text-9)] uppercase tracking-[var(--tracking-md)] text-ink-soft">source</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere] font-mono">{session.archiveSource ?? "unknown"}</dd>
        <dt className="font-display text-[length:var(--text-9)] uppercase tracking-[var(--tracking-md)] text-ink-soft">aliases</dt><dd className="m-0 min-w-0 [overflow-wrap:anywhere] font-mono">{session.aliases.map((alias) => `${alias.group}/@${alias.alias}`).join(", ") || "none"}</dd>
      </dl>
      <footer className={archiveActions}>
        <button type="button" className={archiveBtn} onClick={() => void copyText(session.peerId)}>Copy peer id</button>
        <button type="button" className={archiveBtn} onClick={onClose}>Close</button>
      </footer>
    </section>
  );
}

function groupArchived(sessions: ArchivedSession[]): Array<[string, ArchivedSession[]]> {
  const groups = new Map<string, ArchivedSession[]>();
  for (const session of sessions) {
    const group = session.aliases[0]?.group ?? "ungrouped";
    const list = groups.get(group);
    if (list) list.push(session);
    else groups.set(group, [session]);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function sessionToAgent(session: ArchivedSession): Agent {
  return {
    id: session.peerId,
    name: session.sessionName,
    handle: session.sessionName.toLowerCase(),
    color: "#111111",
    role: session.tool,
    status: "offline",
    lifecycleState: "archived",
    avatar: (session.sessionName[0] ?? "?").toUpperCase(),
  };
}

function countAction(preview: ArchivePreview, action: string): number {
  return preview.members.filter((member) => member.action === action).length;
}

function relativeTime(value: string | null): string {
  if (!value) return "unknown";
  const delta = Date.now() - Date.parse(value);
  if (!Number.isFinite(delta)) return value;
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
