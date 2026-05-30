import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSpawnAgent } from "../data/context.tsx";
import type { AgentLaunchTool, Room } from "../data/types.ts";
import { useToast } from "./Toast.tsx";

const TOOL_OPTIONS: Array<{ value: AgentLaunchTool; label: string; meta: string }> = [
  { value: "claude", label: "Claude", meta: "Haiku" },
  { value: "pi", label: "Pi", meta: "gpt-5.4-mini" },
];

interface SpawnAgentDialogProps {
  room: Room;
  onClose(): void;
}

export function SpawnAgentDialog({ room, onClose }: SpawnAgentDialogProps) {
  const spawnAgent = useSpawnAgent();
  const toast = useToast();
  const [tool, setTool] = useState<AgentLaunchTool>("pi");
  const [name, setName] = useState(() => defaultAgentName("pi", room));
  const [path, setPath] = useState(() => room.paths?.[0]?.path ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const title = useMemo(() => `Spawn into #${room.name}`, [room.name]);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!nameTouched) setName(defaultAgentName(tool, room));
  }, [nameTouched, room, tool]);

  useEffect(() => {
    const paths = room.paths ?? [];
    if (paths.some((candidate) => candidate.path === path)) return;
    setPath(paths[0]?.path ?? "");
  }, [path, room]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,10}$/.test(trimmed)) {
      setError("Name must be 1-11 chars: lowercase letters, numbers, dashes");
      return;
    }
    if (!path) {
      setError("Path is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await spawnAgent({ roomId: room.id, tool, name: trimmed, path });
      toast.show(`${result.sessionName} is launching in #${result.group}`, { kind: "success" });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="spawn-agent-dialog"
        aria-label={title}
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="spawn-agent-head">
          <div>
            <div className="spawn-agent-kicker">agent</div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="spawn-agent-close" aria-label="close" onClick={onClose}>x</button>
        </div>

        <div className="spawn-agent-field">
          <label htmlFor="spawn-agent-name">Name</label>
          <input
            id="spawn-agent-name"
            ref={nameRef}
            maxLength={11}
            value={name}
            onChange={(event) => {
              setNameTouched(true);
              setName(normalizeAliasDraft(event.target.value));
            }}
            disabled={submitting}
          />
        </div>

        <fieldset className="spawn-tool-field">
          <legend>Runtime</legend>
          <div className="spawn-tool-options">
            {TOOL_OPTIONS.map((option) => (
              <label key={option.value} className={`spawn-tool-option${tool === option.value ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="spawn-agent-tool"
                  value={option.value}
                  checked={tool === option.value}
                  disabled={submitting}
                  onChange={() => setTool(option.value)}
                />
                <span className="spawn-tool-copy">
                  <span className="spawn-tool-label">{option.label}</span>
                  <span className="spawn-tool-meta">{option.meta}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="spawn-tool-field">
          <legend>Path</legend>
          <div className="spawn-path-options">
            {(room.paths ?? []).map((option) => (
              <label key={option.id} className={`spawn-path-option${path === option.path ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="spawn-agent-path"
                  value={option.path}
                  checked={path === option.path}
                  disabled={submitting}
                  onChange={() => setPath(option.path)}
                />
                <span className="spawn-path-copy">
                  <span className="spawn-path-label">{option.label ?? pathLabel(option.path)}</span>
                  <span className="spawn-path-value">{option.path}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <div className="spawn-agent-error" role="alert">{error}</div>}

        <div className="spawn-agent-actions">
          <button type="button" className="spawn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="spawn-primary" disabled={submitting}>
            {submitting ? "Spawning..." : "Spawn"}
          </button>
        </div>
      </form>
    </div>
  );
}

function defaultAgentName(tool: AgentLaunchTool, room: Room): string {
  const slug = room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
  return normalizeAliasDraft(`${tool}-${slug}`).replace(/^-+|-+$/g, "") || tool;
}

function pathLabel(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function normalizeAliasDraft(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/--+/g, "-").slice(0, 11);
}
