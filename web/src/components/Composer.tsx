import { useEffect, useId, useLayoutEffect, useRef, useState, useMemo } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useAgents, useMe, useRemoveDraftAttachment, useRooms, useSendMessage, useSkillCatalog, useStageAttachment } from "../data/context.tsx";
import type { Agent, AgentLaunchTool, MessageAttachment, SkillCatalogEntry } from "../data/types.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { isSelfAgent } from "../data/identity.ts";
import { IdentityBadge, roomNameText } from "./primitives.tsx";
import { AttachmentPreviewList } from "./AttachmentPreview.tsx";
import { useToast } from "./Toast.tsx";
import { useIsCompact } from "../shell-mode.tsx";
import { IconButton } from "./IconButton.tsx";
import { Paperclip, AtSign, Slash, ArrowUp, ListTree } from "lucide-react";

interface ComposerProps {
  roomId: string;
  parentMessageId?: string;
  /** When true, the composer mounts in collapsed state. Used by ChatView to
   *  reclaim vertical real estate when a thread pane is open. */
  collapsedDefault?: boolean;
  /** When provided, render the Thread Summary toggle in the footer. */
  threadSummaryOpen?: boolean;
  onToggleThreadSummary?(): void;
}

const MENTION_TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;
type SkillRuntimeFilter = "all" | AgentLaunchTool;

const SR_ONLY_STYLE: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function filesFromClipboard(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? []);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (files.some((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.type === file.type)) continue;
    files.push(file);
  }
  return files;
}

function normalizeMentionHandle(handle: string): string {
  return handle.replace(MENTION_TRAILING_PUNCTUATION_RE, "");
}

function fuzzyNameScore(value: string, query: string): number | null {
  let idx = 0;
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  let gapPenalty = 0;
  let lastMatch = -1;
  for (const char of haystack) {
    if (char === needle[idx]) {
      if (lastMatch >= 0) gapPenalty += Math.max(0, idx - lastMatch - 1);
      lastMatch = idx;
      idx += 1;
    }
    if (idx === needle.length) return Math.max(10, 36 - gapPenalty);
  }
  if (idx !== needle.length) return null;
  return Math.max(10, 36 - gapPenalty);
}

function skillMatchScore(skill: SkillCatalogEntry, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 92;
  if (name.includes(q)) return 84;
  if (name.split(/[-_\s:]+/).some((token) => token.startsWith(q))) return 72;
  if (description.includes(q)) return 48;
  return q.length >= 3 ? fuzzyNameScore(name, q) : null;
}

// Quiet 26px toolbar glyphs (ref .cbar span) and pill footer chips (ref .cfoot
// .ck). Font shorthands live unlayered in extra.css (.composer-tool /
// .composer-chip): styles.css's unlayered `button { font: inherit }` beats
// every layered Tailwind font utility.
const toolBtn =
  "composer-tool w-[26px] h-[26px] grid place-items-center p-0 rounded-md bg-transparent [border:var(--line-none)] shadow-none text-ink-faint cursor-pointer hover:enabled:bg-[color:var(--accent-bg)] hover:enabled:text-[color:var(--accent)] disabled:opacity-40 disabled:cursor-default";
const chipBtn =
  "composer-chip [border:1px_solid_var(--rule-2)] rounded-pill bg-transparent px-[10px] py-[3px] text-ink-faint whitespace-nowrap cursor-pointer hover:text-[color:var(--accent)] hover:[border-color:var(--accent)]";

// .mention-row / .skill-row hover+focused background.
const popRow = cva("text-left rounded-[var(--radius-sm)] [border:var(--line-none)] bg-transparent cursor-pointer", {
  variants: { focused: { true: "bg-paper-2", false: "hover:bg-paper-2" } },
  defaultVariants: { focused: false },
});

export function Composer({
  roomId,
  parentMessageId,
  collapsedDefault = false,
  threadSummaryOpen = false,
  onToggleThreadSummary,
}: ComposerProps) {
  const agents = useAgents();
  const me = useMe();
  const rooms = useRooms();
  const skillCatalog = useSkillCatalog();
  const room = rooms.find((candidate) => candidate.id === roomId);
  const mentionAgents = useMemo(() => room ? roomAgents(agents, room) : agents, [agents, room]);
  const sendMessage = useSendMessage();
  const stageAttachment = useStageAttachment();
  const removeDraftAttachment = useRemoveDraftAttachment();
  const toast = useToast();
  const compact = useIsCompact();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const slashRestorePosRef = useRef<number | null>(null);
  const attachmentsRef = useRef<MessageAttachment[]>([]);
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillIdx, setSkillIdx] = useState(0);
  const [skillRuntime, setSkillRuntime] = useState<SkillRuntimeFilter>("all");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [addingAttachments, setAddingAttachments] = useState(false);
  const [popRect, setPopRect] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  const [mentionAnnouncement, setMentionAnnouncement] = useState("");
  const mentionBaseId = useId();
  const mentionListboxId = `${mentionBaseId}-mention-listbox`;
  const mentionOptionId = (agentId: string) => `${mentionBaseId}-mention-opt-${agentId}`;

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (mentionQuery === null && !skillPickerOpen) {
      setPopRect(null);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPopRect({ left: r.left, bottom: window.innerHeight - r.top, width: r.width });
  }, [mentionQuery, skillPickerOpen, value]);

  useEffect(() => {
    if (mentionQuery === null && !skillPickerOpen) return;
    const onResize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopRect({ left: r.left, bottom: window.innerHeight - r.top, width: r.width });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mentionQuery, skillPickerOpen]);

  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionAgents.filter((a) => a.id !== me.id && (q === "" || a.handle.toLowerCase().startsWith(q))).slice(0, 6);
  }, [mentionQuery, mentionAgents, me.id]);

  const mentionOpen = mentionQuery !== null && candidates.length > 0;

  // ref .cfoot .ctx (`→ #CHECKOUT-REVAMP · 6 AGENTS`) + room-aware placeholder
  // (`message #checkout-revamp — @ tags an agent`). Crew counts agents only.
  const crewCount = useMemo(() => mentionAgents.filter((a) => !isSelfAgent(a, me)).length, [mentionAgents, me]);
  const roomLabel = room ? roomNameText(room.kind, room.name) : "";
  const ctxLabel = room ? `${roomLabel} · ${crewCount} agents` : `${crewCount} agents`;
  const placeholder = compact
    ? "Message…"
    : parentMessageId
      ? "reply in thread…"
      : room
        ? `message ${roomLabel} — @ tags an agent`
        : "message the room — @ tags an agent";

  useEffect(() => {
    if (candidates.length > 0 && mentionIdx >= candidates.length) setMentionIdx(0);
  }, [candidates.length, mentionIdx]);

  useEffect(() => {
    if (!mentionOpen) return;
    setMentionAnnouncement(`${candidates.length} mention suggestion${candidates.length === 1 ? "" : "s"} available`);
  }, [mentionOpen, candidates.length]);

  const skillCandidates = useMemo(() => {
    return skillCatalog
      .filter((skill) => !selectedSkills.includes(skill.name))
      .filter((skill) => skillRuntime === "all" || (skill.runtimes.length === 1 && skill.runtimes.includes(skillRuntime)))
      .map((skill) => ({ skill, score: skillMatchScore(skill, skillQuery) }))
      .filter((item): item is { skill: SkillCatalogEntry; score: number } => item.score !== null)
      .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
      .map((item) => item.skill)
      .slice(0, 80);
  }, [skillCatalog, selectedSkills, skillQuery, skillRuntime]);

  const openSkillPicker = (restoreSlashAt: number | null = null) => {
    slashRestorePosRef.current = restoreSlashAt;
    setSkillPickerOpen(true);
    setMentionQuery(null);
    setSkillQuery("");
    setSkillIdx(0);
    queueMicrotask(() => skillInputRef.current?.focus());
  };

  const closeSkillPicker = () => {
    slashRestorePosRef.current = null;
    setSkillPickerOpen(false);
    setSkillQuery("");
    setSkillIdx(0);
  };

  const restoreLiteralSlashAndClose = () => {
    const preferredPos = slashRestorePosRef.current;
    closeSkillPicker();
    setValue((prev) => {
      const pos = Math.max(0, Math.min(preferredPos ?? prev.length, prev.length));
      queueMicrotask(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(pos + 1, pos + 1);
      });
      return `${prev.slice(0, pos)}/${prev.slice(pos)}`;
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    const caret = e.target.selectionStart;
    const upTo = v.slice(0, caret);
    if (/(^|\s)\/$/.test(upTo)) {
      const next = v.slice(0, caret - 1) + v.slice(caret);
      setValue(next);
      openSkillPicker(caret - 1);
      queueMicrotask(() => {
        const ta = taRef.current;
        if (!ta) return;
        const pos = caret - 1;
        ta.setSelectionRange(pos, pos);
      });
      return;
    }
    setValue(v);
    const m = /@([a-zA-Z0-9._-]*)$/.exec(upTo);
    if (m) {
      setMentionQuery(m[1] ?? "");
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  const addFiles = async (files: File[], sourceHint: "clipboard" | "picker") => {
    if (files.length === 0) return;
    setAddingAttachments(true);
    const staged: MessageAttachment[] = [];
    try {
      for (const file of files) {
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        try {
          staged.push(await stageAttachment({ file, sourceHint, ...(previewUrl ? { previewUrl } : {}) }));
        } catch (error) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          throw error;
        }
      }
      setAttachments((prev) => [...prev, ...staged]);
    } catch (error) {
      console.error("failed to stage attachment", error);
      toast.show(error instanceof Error ? `Could not attach file: ${error.message}` : "Could not attach file", {
        kind: "error",
        duration: 7000,
      });
    } finally {
      setAddingAttachments(false);
    }
  };

  const removeAttachment = (attachment: MessageAttachment) => {
    setAttachments((prev) => prev.filter((candidate) => candidate.id !== attachment.id));
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    void removeDraftAttachment(attachment).catch((error) => {
      console.error("failed to remove draft attachment", error);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files, "clipboard");
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void addFiles(files, "picker");
  };

  const commitMention = (a: Agent) => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = value.slice(0, caret).replace(/@[a-zA-Z0-9._-]*$/, `@${a.handle} `);
    const after = value.slice(caret);
    const next = before + after;
    setValue(next);
    setMentionQuery(null);
    setMentionAnnouncement(`@${a.handle} mention added`);
    queueMicrotask(() => {
      ta.focus();
      const pos = before.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // Compact @ button: insert "@" at the end and open the mention popup, since
  // the desktop toolbar @ is typing-driven and has no handler.
  const insertMention = () => {
    setValue((prev) => (prev.endsWith("@") ? prev : `${prev}@`));
    setMentionQuery("");
    setMentionIdx(0);
    queueMicrotask(() => taRef.current?.focus());
  };

  const commitSkill = (skill: SkillCatalogEntry) => {
    slashRestorePosRef.current = null;
    setSelectedSkills((prev) => prev.includes(skill.name) ? prev : [...prev, skill.name]);
    setSkillQuery("");
    setSkillIdx(0);
    queueMicrotask(() => skillInputRef.current?.focus());
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % candidates.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIdx((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = candidates[mentionIdx];
        if (picked) commitMention(picked);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleSkillKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "/") {
      e.preventDefault();
      restoreLiteralSlashAndClose();
      return;
    }
    if (e.key === "ArrowDown" && skillCandidates.length > 0) {
      e.preventDefault();
      setSkillIdx((i) => (i + 1) % skillCandidates.length);
      return;
    }
    if (e.key === "ArrowUp" && skillCandidates.length > 0) {
      e.preventDefault();
      setSkillIdx((i) => (i - 1 + skillCandidates.length) % skillCandidates.length);
      return;
    }
    if ((e.key === "Enter" || e.key === "Tab") && skillCandidates.length > 0) {
      e.preventDefault();
      const picked = skillCandidates[skillIdx];
      if (picked) commitSkill(picked);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSkillPicker();
      queueMicrotask(() => taRef.current?.focus());
    }
  };

  const submit = async () => {
    const body = value.trim();
    if (!body && attachments.length === 0) return;
    const mentions = Array.from(body.matchAll(/@([a-zA-Z0-9._-]+)/g))
      .map((m) => m[1])
      .filter((h): h is string => Boolean(h))
      .map(normalizeMentionHandle)
      .map((h) => mentionAgents.find((a) => a.handle === h)?.id)
      .filter((id): id is string => Boolean(id));
    setValue("");
    setMentionQuery(null);
    closeSkillPicker();
    const pickedSkills = selectedSkills;
    const pickedAttachments = attachments;
    setSelectedSkills([]);
    setAttachments([]);
    await sendMessage({
      roomId,
      body,
      mentions,
      ...(pickedAttachments.length > 0 && { attachments: pickedAttachments }),
      ...(pickedSkills.length > 0 && { skillDirectives: pickedSkills }),
      ...(parentMessageId !== undefined && { parentMessageId }),
    });
  };

  if (collapsed) {
    return (
      <div className={cn("composer composer-collapsed", "relative flex flex-shrink-0 flex-col [border-top:var(--line)] bg-[color:var(--composer-bg)] px-[28px] py-[6px]")}>
        <button
          type="button"
          // `composer-collapsed-stub`: queried by hooks/useVimNav.ts — kept.
          className={cn("composer-collapsed-stub", "w-full flex items-center justify-between gap-[var(--space-10)] px-0 py-[6px] bg-transparent text-ink-faint [border:var(--line-none)] shadow-none [font:inherit] cursor-pointer text-left hover:text-ink")}
          onClick={() => {
            setCollapsed(false);
            queueMicrotask(() => taRef.current?.focus());
          }}
          aria-label="expand composer"
          title="expand composer"
        >
          <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            {value.trim() ? value.trim().slice(0, 80) + (value.length > 80 ? "…" : "") : "message the room… click to expand"}
          </span>
          <span className="text-[length:var(--text-11)] text-ink" aria-hidden>▲</span>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("composer", "relative flex flex-shrink-0 flex-col [border-top:var(--line)] bg-[color:var(--composer-bg)] px-[28px] pt-[8px] pb-[10px]")}>
      <button
        type="button"
        className="composer-collapse absolute top-[4px] right-[8px] w-[18px] h-[18px] grid place-items-center bg-transparent text-ink-soft [border:var(--line-none)] shadow-none rounded-none p-0 text-[length:var(--text-11)] leading-none cursor-pointer opacity-55 z-[var(--z-local-control)] [transition:opacity_140ms_ease,color_140ms_ease] hover:opacity-100 hover:text-ink"
        onClick={() => setCollapsed(true)}
        aria-label="collapse composer"
        title="collapse composer"
      >
        ▼
      </button>
      <input ref={fileInputRef} className="absolute w-px h-px opacity-0 pointer-events-none" type="file" multiple onChange={handleFileInput} />
      {!compact && (
      <div className="composer-toolbar flex items-center gap-[2px] w-full bg-transparent [border:var(--line-none)] rounded-none pt-[2px] pb-[4px] shadow-none">
        <button type="button" className={toolBtn} title="bold" disabled>B</button>
        <button type="button" className={toolBtn} title="italic" disabled><i>I</i></button>
        <button type="button" className={toolBtn} title="inline code" disabled>{"</>"}</button>
        <button type="button" className={toolBtn} title="mention an agent" onClick={insertMention}>@</button>
        <button
          type="button"
          className={cn(toolBtn, skillPickerOpen && "bg-[color:var(--accent-bg)] text-[color:var(--accent)]")}
          title="use skills"
          onClick={() => openSkillPicker()}
        >
          /
        </button>
        <button type="button" className={toolBtn} title="attach file" aria-label="attach file" onClick={() => fileInputRef.current?.click()}>⌗</button>
      </div>
      )}
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-[var(--space-6)] pt-[4px] pb-[2px]" aria-label="selected skills">
          {selectedSkills.map((skillName) => (
            <button
              key={skillName}
              type="button"
              className="inline-flex items-center gap-[var(--space-4)] max-w-[220px] bg-yellow text-ink [border:var(--line-sm)] rounded-[var(--radius-sm)] shadow-xs px-[8px] py-[4px] font-mono text-[length:var(--text-11)] font-extrabold overflow-hidden text-ellipsis whitespace-nowrap"
              onClick={() => setSelectedSkills((prev) => prev.filter((name) => name !== skillName))}
              title={`remove ${skillName}`}
            >
              /{skillName} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <AttachmentPreviewList attachments={attachments} mode="draft" onRemove={removeAttachment} />
      )}
      {/* ref .crow: input, ⏎ SEND hint, and the inverted SEND button share one row. */}
      <div className="composer-crow flex items-center gap-[12px] min-w-0">
        <div
          className="composer-input-wrap relative flex-1 min-w-0 bg-transparent [border:var(--line-none)] rounded-none shadow-none"
          ref={wrapRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={mentionOpen}
          aria-controls={mentionListboxId}
        >
          <textarea
            ref={taRef}
            // `composer-input`: queried by hooks/useVimNav.ts; the font shorthand
            // is unlayered in extra.css (theme contract).
            className={cn(
              "composer-input w-full block resize-none bg-transparent text-ink [border:var(--line-none)] outline-none placeholder:text-ink-faint",
              compact
                ? "min-h-[44px] max-h-[132px] px-[4px] py-[10px]"
                : "[field-sizing:content] min-h-[30px] max-h-[200px] px-0 py-[6px]",
            )}
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            rows={1}
            aria-autocomplete="list"
            aria-controls={mentionOpen ? mentionListboxId : undefined}
            aria-activedescendant={mentionOpen && candidates[mentionIdx] ? mentionOptionId(candidates[mentionIdx].id) : undefined}
          />
        </div>
        {!compact && (
          <>
            <span className="composer-hint flex-none font-mono text-[length:var(--text-9)] text-ink-faint whitespace-nowrap" aria-hidden>
              ⏎ SEND
            </span>
            {/* `composer-send`: skin hook — colors + mono font live unlayered in extra.css. */}
            <button
              className="composer-send flex-none px-[18px] py-[9px] cursor-pointer hover:opacity-[0.88] disabled:opacity-[0.52] disabled:cursor-default"
              onClick={submit}
              disabled={addingAttachments || (!value.trim() && attachments.length === 0)}
              aria-label="send message"
            >
              SEND
            </button>
          </>
        )}
      </div>
      <div aria-live="polite" role="status" style={SR_ONLY_STYLE}>
        {mentionAnnouncement}
      </div>
      {mentionOpen && popRect && (
        <div
          id={mentionListboxId}
          // `mention-pop` remains the shared mention-overlay skin hook.
          className={cn("mention-pop", "bg-paper [border:var(--line-md)] rounded-[var(--radius-xl)] shadow-md z-[var(--z-mention-overlay)] max-h-[300px] overflow-y-auto p-[var(--space-6)] flex flex-col gap-[var(--space-2)]")}
          role="listbox"
          aria-label="mention suggestions"
          style={{
            position: "fixed",
            left: popRect.left,
            bottom: popRect.bottom + 6,
            width: Math.min(popRect.width, 420),
          }}
        >
          {candidates.map((a, i) => (
            <button
              key={a.id}
              id={mentionOptionId(a.id)}
              type="button"
              role="option"
              aria-selected={i === mentionIdx}
              tabIndex={-1}
              className={cn(popRow({ focused: i === mentionIdx }), "grid grid-cols-[28px_1fr_auto] gap-[var(--space-10)] items-center px-[8px] py-[6px]")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commitMention(a)}
              onMouseEnter={() => setMentionIdx(i)}
            >
              <IdentityBadge
                className="w-[28px] h-[28px] [border:var(--line-sm)] rounded-[var(--radius-md)] grid place-items-center [font-family:var(--font-avatar)] text-[length:var(--text-13)] shadow-xs"
                color={a.color}
                {...(a.colorRef ? { colorRef: a.colorRef } : null)}
              >
                {a.avatar}
              </IdentityBadge>
              <span className="flex flex-col min-w-0">
                <span className="font-semibold text-[length:var(--text-13)] text-ink">{a.name}</span>
                <span className="font-mono text-[length:var(--text-11)] text-ink-soft">@{a.handle}</span>
              </span>
              <span className="font-mono text-[length:var(--text-11)] text-ink-soft mt-[3px] leading-[1.4] max-w-[160px] text-right overflow-hidden text-ellipsis whitespace-nowrap">{a.statusNote ?? a.role}</span>
            </button>
          ))}
        </div>
      )}
      {skillPickerOpen && popRect && (
        <div
          className="bg-paper [border:var(--line-md)] rounded-[var(--radius-xl)] shadow-md z-[var(--z-mention-overlay)] max-h-[360px] overflow-hidden flex flex-col"
          style={{
            position: "fixed",
            left: popRect.left,
            bottom: popRect.bottom + 6,
            width: Math.min(popRect.width, compact ? 420 : 520),
          }}
        >
          {/* `skill-pop-head`: responsive override in extra.css @media(max-width:700px) — class kept. */}
          <div
            className={cn(
              "skill-pop-head gap-[var(--space-8)] items-center p-[var(--space-8)] [border-bottom:var(--line-sm)] bg-paper-2",
              compact ? "flex flex-col items-stretch" : "grid grid-cols-[minmax(0,1fr)_auto]",
            )}
          >
            <input
              ref={skillInputRef}
              className="min-w-0 bg-paper text-ink [border:var(--line-sm)] rounded-[var(--radius-sm)] px-[9px] py-[7px] [font:inherit] text-[length:var(--text-13)] outline-none focus:shadow-[0_0_0_2px_var(--yellow)]"
              value={skillQuery}
              onChange={(event) => {
                setSkillQuery(event.target.value);
                setSkillIdx(0);
              }}
              onKeyDown={handleSkillKey}
              placeholder="filter skills"
              aria-label="filter skills"
            />
            <div className={cn("inline-flex gap-[var(--space-4)]", compact && "justify-stretch")} role="group" aria-label="skill runtime filter">
              {(["all", "claude", "pi"] as const).map((runtime) => (
                <button
                  key={runtime}
                  type="button"
                  className={cn(
                    "[border:var(--line-sm)] rounded-[var(--radius-sm)] px-[8px] py-[6px] font-display text-[length:var(--text-10-5)]",
                    compact && "min-h-[34px] flex-1",
                    skillRuntime === runtime ? "bg-ink text-paper" : "bg-paper text-ink",
                  )}
                  onClick={() => {
                    setSkillRuntime(runtime);
                    setSkillIdx(0);
                    queueMicrotask(() => skillInputRef.current?.focus());
                  }}
                >
                  {runtime === "all" ? "All" : runtime === "claude" ? "Claude" : "Pi"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-[var(--space-2)] p-[var(--space-6)] min-h-0 max-h-[280px] overflow-y-auto overscroll-contain">
            {skillCandidates.length > 0 ? skillCandidates.map((skill, i) => (
              <button
                key={`${skill.name}:${skill.runtimes.join(",")}`}
                type="button"
                // `skill-row`: responsive override in extra.css @media(max-width:700px) — class kept.
                className={cn(
                  popRow({ focused: i === skillIdx }),
                  "skill-row grid gap-[var(--space-10)] items-center px-[8px] py-[7px] text-ink",
                  compact
                    ? "grid-cols-[minmax(0,1fr)_auto] gap-y-[3px] min-h-[52px]"
                    : "grid-cols-[minmax(92px,0.7fr)_minmax(0,1fr)_auto]",
                )}
                onClick={() => commitSkill(skill)}
                onMouseEnter={() => setSkillIdx(i)}
              >
                <span className="font-mono text-[length:var(--text-12)] font-extrabold overflow-hidden text-ellipsis whitespace-nowrap">/{skill.name}</span>
                <span
                  className={cn(
                    "text-ink-soft text-[length:var(--text-11)] overflow-hidden",
                    compact
                      ? "col-span-2 row-start-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [line-height:1.3]"
                      : "text-ellipsis whitespace-nowrap",
                  )}
                >
                  {skill.description || "No description"}
                </span>
                {/* `skill-runtimes`: responsive override in extra.css @media(max-width:700px) — class kept. */}
                <span
                  className={cn(
                    "skill-runtimes text-ink font-mono text-[length:var(--text-10)] uppercase whitespace-nowrap",
                    compact && "col-start-2 row-start-1 justify-self-end",
                  )}
                >
                  {skill.runtimes.join(" + ")}
                </span>
              </button>
            )) : (
              <div className="px-[10px] py-[16px] text-ink-soft text-[length:var(--text-12)] text-center">No matching skills</div>
            )}
          </div>
        </div>
      )}
      {compact ? (
        <div className="composer-foot composer-foot-compact flex items-center gap-[var(--space-4)] px-[8px] py-[6px] [border-top:var(--line-rule-dashed-sm)]">
          {/* Room switching lives in the bottom nav's Chats tab in compact mode,
              so the composer stays focused on message actions. */}
          <IconButton icon={Paperclip} label="attach file" onClick={() => fileInputRef.current?.click()} disabled={addingAttachments} />
          <IconButton icon={AtSign} label="mention an agent" onClick={insertMention} />
          <IconButton icon={Slash} label="use skills" active={skillPickerOpen} onClick={() => openSkillPicker()} />
          {onToggleThreadSummary ? (
            <IconButton
              icon={ListTree}
              label={threadSummaryOpen ? "hide thread summaries" : "show thread summaries"}
              active={threadSummaryOpen}
              onClick={onToggleThreadSummary}
            />
          ) : null}
          <span className="flex-1" />
          <IconButton
            icon={ArrowUp}
            label="send message"
            variant="accent"
            className="rounded-full"
            onClick={() => void submit()}
            disabled={addingAttachments || (!value.trim() && attachments.length === 0)}
          />
        </div>
      ) : (
      // ref .cfoot: dashed rule, quick-action chips, room context right.
      <div className="composer-foot flex items-center gap-[8px] min-w-0 mt-[6px] pt-[7px] [border-top:1px_dashed_var(--rule-2)]">
        <button type="button" className={chipBtn} onClick={insertMention}>@ mention</button>
        <button type="button" className={cn(chipBtn, skillPickerOpen && "text-[color:var(--accent)] [border-color:var(--accent)]")} onClick={() => openSkillPicker()}>/ command</button>
        <button type="button" className={chipBtn} onClick={() => fileInputRef.current?.click()} disabled={addingAttachments}>⌗ attach</button>
        {onToggleThreadSummary ? (
          <button
            type="button"
            // `thread-scan-btn`: vim-nav / flow hook — kept on the chip.
            className={cn("thread-scan-btn", chipBtn, threadSummaryOpen && "text-[color:var(--accent)] [border-color:var(--accent)]")}
            onClick={onToggleThreadSummary}
            aria-pressed={threadSummaryOpen}
            title={threadSummaryOpen ? "hide the thread summary panel" : "show thread summaries"}
          >
            ☰ {threadSummaryOpen ? "hide summary" : "threads"}
          </button>
        ) : null}
        <span className="composer-ctx ml-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[length:var(--text-9)] tracking-[0.06em] uppercase text-ink-faint">
          → {ctxLabel}
          {addingAttachments ? " · attaching…" : ""}
        </span>
      </div>
      )}
    </div>
  );
}
