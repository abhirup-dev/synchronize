import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { useAgents, useMe, useRemoveDraftAttachment, useRooms, useSendMessage, useSkillCatalog, useStageAttachment } from "../data/context.tsx";
import type { Agent, AgentLaunchTool, MessageAttachment, SkillCatalogEntry } from "../data/types.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { inkFor } from "./primitives.tsx";
import { AttachmentPreviewList } from "./AttachmentPreview.tsx";

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
    const files = Array.from(e.clipboardData.files ?? []);
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
    if (mentionQuery !== null && candidates.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % candidates.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIdx((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = candidates[mentionIdx];
        if (picked) commitMention(picked);
        return;
      }
      if (e.key === "Escape") { setMentionQuery(null); return; }
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
      <div className="composer composer-collapsed">
        <button
          type="button"
          className="composer-collapsed-stub"
          onClick={() => {
            setCollapsed(false);
            queueMicrotask(() => taRef.current?.focus());
          }}
          aria-label="expand composer"
          title="expand composer"
        >
          <span className="composer-collapsed-text">
            {value.trim() ? value.trim().slice(0, 80) + (value.length > 80 ? "…" : "") : "message the room… click to expand"}
          </span>
          <span className="composer-collapse-toggle" aria-hidden>▲</span>
        </button>
      </div>
    );
  }

  return (
    <div className="composer">
      <button
        type="button"
        className="composer-collapse-btn"
        onClick={() => setCollapsed(true)}
        aria-label="collapse composer"
        title="collapse composer"
      >
        ▼
      </button>
      <div className="composer-toolbar">
        <button className="ct-btn" title="bold" disabled>B</button>
        <button className="ct-btn" title="italic" disabled><i>I</i></button>
        <button className="ct-btn" title="code" disabled>{"</>"}</button>
        <button className="ct-btn" title="link" disabled>↗</button>
        <button className="ct-btn" title="mention">@</button>
        <button className={`ct-btn${skillPickerOpen ? " active" : ""}`} title="use skills" onClick={() => openSkillPicker()}>/</button>
        <button type="button" className="ct-btn" title="attach file" aria-label="attach file" onClick={() => fileInputRef.current?.click()}>📎</button>
        <input ref={fileInputRef} className="composer-file-input" type="file" multiple onChange={handleFileInput} />
      </div>
      {selectedSkills.length > 0 && (
        <div className="composer-skill-chips" aria-label="selected skills">
          {selectedSkills.map((skillName) => (
            <button
              key={skillName}
              type="button"
              className="composer-skill-chip"
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
      <div className="composer-input-wrap" ref={wrapRef}>
        <textarea
          ref={taRef}
          className="composer-input"
          placeholder="message the room… use @ to tag an agent"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          rows={3}
        />
      </div>
      {mentionQuery !== null && candidates.length > 0 && popRect && (
        <div
          className="mention-pop"
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
              type="button"
              className={`mention-row${i === mentionIdx ? " focused" : ""}`}
              onClick={() => commitMention(a)}
              onMouseEnter={() => setMentionIdx(i)}
            >
              <span className="mention-av" style={{ background: a.color, color: inkFor(a.color) }}>{a.avatar}</span>
              <span className="mention-meta">
                <span className="mention-name">{a.name}</span>
                <span className="mention-handle">@{a.handle}</span>
              </span>
              <span className="mention-note">{a.statusNote ?? a.role}</span>
            </button>
          ))}
        </div>
      )}
      {skillPickerOpen && popRect && (
        <div
          className="skill-pop"
          style={{
            position: "fixed",
            left: popRect.left,
            bottom: popRect.bottom + 6,
            width: Math.min(popRect.width, 520),
          }}
        >
          <div className="skill-pop-head">
            <input
              ref={skillInputRef}
              className="skill-search"
              value={skillQuery}
              onChange={(event) => {
                setSkillQuery(event.target.value);
                setSkillIdx(0);
              }}
              onKeyDown={handleSkillKey}
              placeholder="filter skills"
              aria-label="filter skills"
            />
            <div className="skill-runtime-filter" role="group" aria-label="skill runtime filter">
              {(["all", "claude", "pi"] as const).map((runtime) => (
                <button
                  key={runtime}
                  type="button"
                  className={skillRuntime === runtime ? "active" : ""}
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
          <div className="skill-results">
            {skillCandidates.length > 0 ? skillCandidates.map((skill, i) => (
              <button
                key={`${skill.name}:${skill.runtimes.join(",")}`}
                type="button"
                className={`skill-row${i === skillIdx ? " focused" : ""}`}
                onClick={() => commitSkill(skill)}
                onMouseEnter={() => setSkillIdx(i)}
              >
                <span className="skill-name">/{skill.name}</span>
                <span className="skill-desc">{skill.description || "No description"}</span>
                <span className="skill-runtimes">{skill.runtimes.join(" + ")}</span>
              </button>
            )) : (
              <div className="skill-empty">No matching skills</div>
            )}
          </div>
        </div>
      )}
      <div className="composer-foot">
        {onOpenCommunity ? (
          <button
            type="button"
            className="thread-scan-btn community-open-btn"
            onClick={onOpenCommunity}
            title="open communities"
            aria-label="open communities"
          >
            <span className="community-icon" aria-hidden />
          </button>
        ) : null}
        {onToggleThreadSummary ? (
          <button
            type="button"
            className={`thread-scan-btn${threadSummaryOpen ? " active" : ""}`}
            onClick={onToggleThreadSummary}
            aria-pressed={threadSummaryOpen}
            title={threadSummaryOpen ? "hide the thread summary panel" : "show thread summaries"}
          >
            ☰ {threadSummaryOpen ? "HIDE SUMMARY" : "THREADS"}
          </button>
        ) : null}
        <span className="composer-hint">
          <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline · <kbd>@</kbd> tag
          {addingAttachments ? " · attaching..." : ""}
        </span>
        <button className="composer-send" onClick={submit} disabled={addingAttachments || (!value.trim() && attachments.length === 0)} aria-label="send message">
          <span className="composer-send-label">SEND</span>
          <span className="composer-send-icon" aria-hidden />
        </button>
      </div>
    </div>
  );
}
