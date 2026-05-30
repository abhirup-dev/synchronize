import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { useAgents, useMe, useRooms, useSendMessage } from "../data/context.tsx";
import type { Agent } from "../data/types.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { inkFor } from "./primitives.tsx";

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

function normalizeMentionHandle(handle: string): string {
  return handle.replace(MENTION_TRAILING_PUNCTUATION_RE, "");
}

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
  const room = rooms.find((candidate) => candidate.id === roomId);
  const mentionAgents = useMemo(() => room ? roomAgents(agents, room) : agents, [agents, room]);
  const sendMessage = useSendMessage();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [popRect, setPopRect] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const [collapsed, setCollapsed] = useState(collapsedDefault);

  useLayoutEffect(() => {
    if (mentionQuery === null) {
      setPopRect(null);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPopRect({ left: r.left, bottom: window.innerHeight - r.top, width: r.width });
  }, [mentionQuery, value]);

  useEffect(() => {
    if (mentionQuery === null) return;
    const onResize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopRect({ left: r.left, bottom: window.innerHeight - r.top, width: r.width });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mentionQuery]);

  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionAgents.filter((a) => a.id !== me.id && (q === "" || a.handle.toLowerCase().startsWith(q))).slice(0, 6);
  }, [mentionQuery, mentionAgents, me.id]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    const caret = e.target.selectionStart;
    const upTo = v.slice(0, caret);
    const m = /@([a-zA-Z0-9._-]*)$/.exec(upTo);
    if (m) {
      setMentionQuery(m[1] ?? "");
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
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

  const submit = async () => {
    const body = value.trim();
    if (!body) return;
    const mentions = Array.from(body.matchAll(/@([a-zA-Z0-9._-]+)/g))
      .map((m) => m[1])
      .filter((h): h is string => Boolean(h))
      .map(normalizeMentionHandle)
      .map((h) => mentionAgents.find((a) => a.handle === h)?.id)
      .filter((id): id is string => Boolean(id));
    setValue("");
    setMentionQuery(null);
    await sendMessage({
      roomId,
      body,
      mentions,
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
        <button className="ct-btn" title="attach (disabled in v0)" disabled>📎</button>
      </div>
      <div className="composer-input-wrap" ref={wrapRef}>
        <textarea
          ref={taRef}
          className="composer-input"
          placeholder="message the room… use @ to tag an agent"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
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
      <div className="composer-foot">
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
        </span>
        <button className="composer-send" onClick={submit} disabled={!value.trim()}>
          SEND →
        </button>
      </div>
    </div>
  );
}
