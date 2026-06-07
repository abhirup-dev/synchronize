import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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
      <section className="archive-console" role="dialog" aria-modal="true" aria-label="archive" onMouseDown={(event) => event.stopPropagation()}>
        <header className="archive-head">
          <div>
            <h2>ARCHIVE</h2>
            <p>Archived sessions and reserved group seats</p>
          </div>
          <button type="button" className="shell-overlay-close" onClick={onClose} aria-label="close archive">×</button>
        </header>
        <div className="archive-controls">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archived sessions..." />
          <select value={tool} onChange={(event) => setTool(event.target.value)} aria-label="tool filter">
            <option value="all">all tools</option>
            {tools.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="archive-table">
          <div className="archive-row archive-row-head">
            <span>GROUP / SESSION</span>
            <span>TOOL</span>
            <span>ARCHIVED</span>
            <span>ACTION</span>
          </div>
          {grouped.map(([group, sessions]) => {
            const room = rooms.find((candidate) => candidate.kind === "group" && candidate.name === group);
            return (
              <div key={group} className="archive-group-block">
                <div className="archive-row archive-group-row">
                  <strong>#{group}</strong>
                  <span>{sessions.length} archived</span>
                  <span />
                  <button type="button" onClick={() => onResumeGroup(room ?? { id: group, kind: "group", name: group, color: "#111111", members: [], unread: 0 })}>Resume group</button>
                </div>
                {sessions.map((session) => (
                  <div key={session.peerId} className="archive-row">
                    <span>@{session.aliases.find((alias) => alias.group === group)?.alias ?? session.sessionName}</span>
                    <span>{session.tool}</span>
                    <span>{relativeTime(session.archivedAt)}</span>
                    <span className="archive-actions">
                      <button type="button" onClick={() => setSelected(session)}>Details</button>
                      <button type="button" onClick={() => onResumeSession(session)}>Preview</button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          {grouped.length === 0 && <div className="archive-empty">No archived sessions match this view.</div>}
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
      <section className="archive-dialog" role="dialog" aria-modal="true" aria-label={state.title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="archive-head">
          <div>
            <h2>{state.title}</h2>
            <p>{state.kind === "archive" ? "Review the dry run before archiving." : "Review the dry run before resuming."}</p>
          </div>
          <button type="button" className="shell-overlay-close" onClick={onClose} aria-label="close preview">×</button>
        </header>
        {state.loading ? (
          <div className="archive-loading">Loading preview...</div>
        ) : state.error ? (
          <div className="archive-error">{state.error}</div>
        ) : (
          <>
            <div className="archive-table archive-preview-table">
              <div className="archive-row archive-row-head">
                <span>SESSION</span>
                <span>TOOL</span>
                <span>RESULT</span>
                <span>NOTES</span>
              </div>
              {rows?.map((row) => (
                <div key={row.peerId} className="archive-row">
                  <span>{"alias" in row && row.alias ? `@${row.alias}` : row.sessionName ?? row.peerId}</span>
                  <span>{row.tool}</span>
                  <span>{row.action}</span>
                  <span>{("warning" in row && row.warning) || ("zombie" in row && row.zombie ? "zombie process" : "")}</span>
                </div>
              ))}
            </div>
            {state.kind === "archive" && (
              <label className="archive-field">
                <span>Reason</span>
                <input value={state.reason} onChange={(event) => onReason(event.target.value)} placeholder="optional archive reason" />
              </label>
            )}
            {state.kind === "resume" && rows?.some((row) => "forceAvailable" in row && row.forceAvailable) && (
              <label className="archive-check">
                <input type="checkbox" checked={state.force} onChange={(event) => onForce(event.target.checked)} />
                <span>Force live blocked sessions</span>
              </label>
            )}
          </>
        )}
        <footer className="archive-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="archive-primary" disabled={state.loading || Boolean(state.error) || Boolean(blocked)} onClick={onConfirm}>
            {state.kind === "archive" ? "Confirm archive" : "Confirm resume"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ArchiveDetails({ session, onClose }: { session: ArchivedSession; onClose(): void }) {
  return (
    <section className="archive-details" role="dialog" aria-modal="true" aria-label="archive details" onMouseDown={(event) => event.stopPropagation()}>
      <header className="archive-head">
        <div>
          <h2>{session.sessionName}</h2>
          <p>{session.tool} archived {relativeTime(session.archivedAt)}</p>
        </div>
        <button type="button" className="shell-overlay-close" onClick={onClose} aria-label="close details">×</button>
      </header>
      <dl>
        <dt>peer_id</dt><dd>{session.peerId}</dd>
        <dt>reason</dt><dd>{session.archivedReason ?? "none"}</dd>
        <dt>source</dt><dd>{session.archiveSource ?? "unknown"}</dd>
        <dt>aliases</dt><dd>{session.aliases.map((alias) => `${alias.group}/@${alias.alias}`).join(", ") || "none"}</dd>
      </dl>
      <footer className="archive-footer">
        <button type="button" onClick={() => void copyText(session.peerId)}>Copy peer id</button>
        <button type="button" onClick={onClose}>Close</button>
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
