import { useEffect, useId, useLayoutEffect, useRef, useState, useMemo } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useAgents, useMe, useRemoveDraftAttachment, useRooms, useSendMessage, useSkillCatalog, useStageAttachment } from "../data/context.tsx";
import type { Agent, AgentLaunchTool, MessageAttachment, SkillCatalogEntry } from "../data/types.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { IdentityBadge } from "./primitives.tsx";
import { AttachmentPreviewList } from "./AttachmentPreview.tsx";
import { useToast } from "./Toast.tsx";

interface ComposerProps {
  roomId: string;
  parentMessageId?: string;
  /** When true, the composer mounts in collapsed state. Used by ChatView to
   *  reclaim vertical real estate when a thread pane is open. */
  collapsedDefault?: boolean;
  /** When provided, render the Thread Summary toggle in the footer. */
  threadSummaryOpen?: boolean;
  onToggleThreadSummary?(): void;
  /** Compact shell hook for opening the room/community navigator. */
  onOpenCommunity?(): void;
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

// Toolbar buttons (B/I/code/link/mention/slash/attach). Base from extra.css
// .ct-btn; .active and :disabled states via variants. Kanagawa dark overrides
// stay in extra.css (:root[data-theme=...]), so no theme-dark: utilities here.
const toolbarBtn = cva(
  "[border:var(--line-sm)] rounded-[var(--radius-sm)] bg-paper-2 px-[9px] py-[6px] text-[length:var(--text-13)] font-extrabold text-ink shadow-chip disabled:opacity-40 disabled:cursor-default hover:enabled:translate-x-[-1px] hover:enabled:translate-y-[-1px] hover:enabled:shadow-[var(--shadow-hover-sm)]",
  {
    variants: {
      active: {
        true: "bg-yellow translate-x-[-1px] translate-y-[-1px] shadow-[var(--shadow-hover-sm)]",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
);

// .composer-send / .thread-scan-btn shared base from extra.css. Kanagawa dark
// overrides stay in extra.css.
const footBtn =
  "inline-flex items-center justify-center [border:var(--line-2)] rounded-[var(--radius-md)] bg-paper-3 px-[18px] py-[9px] font-display text-[length:var(--text-11)] tracking-[var(--tracking-md)] text-ink shadow-sm hover:enabled:translate-x-[-1px] hover:enabled:translate-y-[-1px] hover:enabled:shadow-[var(--shadow-hover)]";

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
  onOpenCommunity,
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
      // `composer` + `composer-collapsed`: skin-glass.css backdrop-filter hooks — kept.
      <div className={cn("composer composer-collapsed", "relative flex flex-shrink-0 flex-col overflow-hidden bg-paper [border:var(--line-md)] [border-top:3.5px_solid_var(--rule)] rounded-[var(--radius-xl)] shadow-md mx-[12px] mt-[6px] mb-[12px] p-[var(--space-button-pad-md)]")}>
        <button
          type="button"
          // `composer-collapsed-stub`: queried by hooks/useVimNav.ts — kept.
          className={cn("composer-collapsed-stub", "w-full flex items-center justify-between gap-[var(--space-10)] p-[var(--space-button-pad-md)] bg-paper-2 text-ink-soft [border:var(--line-sm)] rounded-[var(--radius-md)] shadow-sm [font:inherit] text-[length:var(--text-13)] cursor-pointer text-left hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-hover)] hover:text-ink")}
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
    // `composer`: skin-glass.css backdrop-filter hook — kept.
    <div className={cn("composer", "relative flex flex-shrink-0 flex-col overflow-hidden bg-paper [border:var(--line-md)] [border-top:3.5px_solid_var(--rule)] rounded-[var(--radius-xl)] shadow-md mx-[12px] mt-[6px] mb-[12px]")}>
      <button
        type="button"
        className="absolute top-[6px] right-[10px] w-[18px] h-[18px] grid place-items-center bg-transparent text-ink-soft [border:var(--line-none)] shadow-none rounded-none p-0 text-[length:var(--text-11)] leading-none cursor-pointer opacity-55 z-[var(--z-local-control)] [transition:opacity_140ms_ease,color_140ms_ease] hover:opacity-100 hover:text-ink"
        onClick={() => setCollapsed(true)}
        aria-label="collapse composer"
        title="collapse composer"
      >
        ▼
      </button>
      <div className="flex items-center gap-[var(--space-8)] w-full bg-transparent [border:var(--line-none)] [border-bottom:var(--line-sm)] rounded-none px-[10px] py-[8px] shadow-none">
        <button className={cn(toolbarBtn())} title="bold" disabled>B</button>
        <button className={cn(toolbarBtn())} title="italic" disabled><i>I</i></button>
        <button className={cn(toolbarBtn())} title="code" disabled>{"</>"}</button>
        <button className={cn(toolbarBtn())} title="link" disabled>↗</button>
        <button className={cn(toolbarBtn())} title="mention">@</button>
        <button className={cn(toolbarBtn({ active: skillPickerOpen }))} title="use skills" onClick={() => openSkillPicker()}>/</button>
        <button type="button" className={cn(toolbarBtn())} title="attach file" aria-label="attach file" onClick={() => fileInputRef.current?.click()}>📎</button>
        <input ref={fileInputRef} className="absolute w-px h-px opacity-0 pointer-events-none" type="file" multiple onChange={handleFileInput} />
      </div>
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-[var(--space-6)] px-[10px] pt-[8px]" aria-label="selected skills">
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
      <div className="relative bg-transparent [border:var(--line-none)] rounded-none shadow-none" ref={wrapRef}>
        <textarea
          ref={taRef}
          // `composer-input`: queried by hooks/useVimNav.ts + kanagawa placeholder
          // override in extra.css (:root[data-theme=...]) — class kept.
          className={cn("composer-input", "w-full resize-y min-h-[78px] max-h-[200px] px-[18px] py-[14px] bg-transparent text-ink [border:var(--line-none)] outline-none [font:inherit] text-[length:var(--text-14)] leading-[1.5] placeholder:text-ink-faint")}
          placeholder="message the room… use @ to tag an agent"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          rows={3}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={mentionOpen}
          aria-controls={mentionOpen ? mentionListboxId : undefined}
          aria-activedescendant={mentionOpen && candidates[mentionIdx] ? mentionOptionId(candidates[mentionIdx].id) : undefined}
        />
      </div>
      <div aria-live="polite" role="status" style={SR_ONLY_STYLE}>
        {mentionAnnouncement}
      </div>
      {mentionOpen && popRect && (
        <div
          id={mentionListboxId}
          // `mention-pop`: skin-glass.css backdrop-filter hook — kept.
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
              <IdentityBadge className="w-[28px] h-[28px] [border:var(--line-sm)] rounded-[var(--radius-md)] grid place-items-center font-display text-[length:var(--text-13)] shadow-xs" color={a.color}>{a.avatar}</IdentityBadge>
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
            width: Math.min(popRect.width, 520),
          }}
        >
          {/* `skill-pop-head`: responsive override in extra.css @media(max-width:700px) — class kept. */}
          <div className="skill-pop-head grid grid-cols-[minmax(0,1fr)_auto] gap-[var(--space-8)] items-center p-[var(--space-8)] [border-bottom:var(--line-sm)] bg-paper-2">
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
            <div className="inline-flex gap-[var(--space-4)]" role="group" aria-label="skill runtime filter">
              {(["all", "claude", "pi"] as const).map((runtime) => (
                <button
                  key={runtime}
                  type="button"
                  className={cn(
                    "[border:var(--line-sm)] rounded-[var(--radius-sm)] px-[8px] py-[6px] font-display text-[length:var(--text-10-5)]",
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
                className={cn(popRow({ focused: i === skillIdx }), "skill-row grid grid-cols-[minmax(92px,0.7fr)_minmax(0,1fr)_auto] gap-[var(--space-10)] items-center px-[8px] py-[7px] text-ink")}
                onClick={() => commitSkill(skill)}
                onMouseEnter={() => setSkillIdx(i)}
              >
                <span className="font-mono text-[length:var(--text-12)] font-extrabold overflow-hidden text-ellipsis whitespace-nowrap">/{skill.name}</span>
                <span className="text-ink-soft text-[length:var(--text-11)] overflow-hidden text-ellipsis whitespace-nowrap">{skill.description || "No description"}</span>
                {/* `skill-runtimes`: responsive override in extra.css @media(max-width:700px) — class kept. */}
                <span className="skill-runtimes text-ink font-mono text-[length:var(--text-10)] uppercase whitespace-nowrap">{skill.runtimes.join(" + ")}</span>
              </button>
            )) : (
              <div className="px-[10px] py-[16px] text-ink-soft text-[length:var(--text-12)] text-center">No matching skills</div>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-[var(--space-12)] justify-between px-[14px] py-[10px] [border-top:var(--line-rule-dashed-sm)]">
        {onOpenCommunity ? (
          <button
            type="button"
            className={cn(footBtn, "mr-auto gap-[6px] cursor-pointer flex-shrink-0")}
            onClick={onOpenCommunity}
            title="open communities"
            aria-label="open communities"
          >
            {/* `community-icon`: ::before/::after pseudo-element art in styles.css — class kept. */}
            <span className="community-icon" aria-hidden />
          </button>
        ) : null}
        {onToggleThreadSummary ? (
          <button
            type="button"
            // `thread-scan-btn`: responsive (.shell-compact) + kanagawa .active overrides in CSS — class kept.
            className={cn("thread-scan-btn", footBtn, "mr-auto gap-[6px] cursor-pointer", threadSummaryOpen && "bg-lilac")}
            onClick={onToggleThreadSummary}
            aria-pressed={threadSummaryOpen}
            title={threadSummaryOpen ? "hide the thread summary panel" : "show thread summaries"}
          >
            ☰ {threadSummaryOpen ? "HIDE SUMMARY" : "THREADS"}
          </button>
        ) : null}
        <span className="text-[length:var(--text-10-5)] text-ink-soft">
          <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline · <kbd>@</kbd> tag
          {addingAttachments ? " · attaching..." : ""}
        </span>
        {/* `composer-send`: .shell-compact sizing + kanagawa overrides in CSS — class kept. */}
        <button className={cn("composer-send", footBtn, "disabled:opacity-[0.52] disabled:cursor-default disabled:[filter:grayscale(0.35)]")} onClick={submit} disabled={addingAttachments || (!value.trim() && attachments.length === 0)} aria-label="send message">
          {/* `composer-send-label` / `composer-send-icon`: toggled by .shell-compact in styles.css — classes kept. */}
          <span className="composer-send-label">SEND</span>
          <span className="composer-send-icon" aria-hidden />
        </button>
      </div>
    </div>
  );
}
