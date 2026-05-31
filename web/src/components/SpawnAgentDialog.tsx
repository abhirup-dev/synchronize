import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSpawnAgent } from "../data/context.tsx";
import type { AgentLaunchTool, Room } from "../data/types.ts";
import { useToast } from "./Toast.tsx";

interface ToolOption {
  value: AgentLaunchTool;
  label: string;
}

interface ModelOption {
  id: string;
  tool: AgentLaunchTool;
  label: string;
  model: string;
  thinking?: "low" | "medium" | "high";
}

const TOOL_OPTIONS: ToolOption[] = [
  { value: "claude", label: "Claude" },
  { value: "pi", label: "Pi" },
];

const MODEL_OPTIONS: Record<AgentLaunchTool, ModelOption[]> = {
  claude: [
    { id: "claude-sonnet", tool: "claude", label: "Sonnet", model: "claude-sonnet-4-6-20251114", thinking: "medium" },
    { id: "claude-haiku", tool: "claude", label: "Haiku", model: "claude-haiku-4-5-20251001", thinking: "high" },
    { id: "claude-opus", tool: "claude", label: "Opus", model: "claude-opus-4-8", thinking: "medium" },
  ],
  pi: [
    { id: "pi-gpt-55-high", tool: "pi", label: "5.5 high", model: "gpt-5.5", thinking: "high" },
    { id: "pi-gpt-55-medium", tool: "pi", label: "5.5 medium", model: "gpt-5.5", thinking: "medium" },
    { id: "pi-gpt-55-low", tool: "pi", label: "5.5 low", model: "gpt-5.5", thinking: "low" },
    { id: "pi-gpt-54-mini", tool: "pi", label: "5.4 mini", model: "gpt-5.4-mini", thinking: "high" },
  ],
};

const DEFAULT_MODEL_ID: Record<AgentLaunchTool, string> = {
  claude: "claude-sonnet",
  pi: "pi-gpt-55-medium",
};

interface SpawnAgentDialogProps {
  room: Room;
  onClose(): void;
}

export function SpawnAgentDialog({ room, onClose }: SpawnAgentDialogProps) {
  const spawnAgent = useSpawnAgent();
  const toast = useToast();
  const [tool, setTool] = useState<AgentLaunchTool>("pi");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID.pi);
  const [name, setName] = useState(() => defaultAgentName("pi", room));
  const [path, setPath] = useState(() => room.paths?.[0]?.path ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const title = useMemo(() => `Spawn into #${room.name}`, [room.name]);
  const modelOptions = MODEL_OPTIONS[tool];
  const selectedModel = modelOptions.find((option) => option.id === modelId) ?? modelOptions[0];

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
    if (!MODEL_OPTIONS[tool].some((option) => option.id === modelId)) {
      setModelId(DEFAULT_MODEL_ID[tool]);
    }
  }, [modelId, tool]);

  useEffect(() => {
    if (isToolAvailable(room, tool)) return;
    const fallback = TOOL_OPTIONS.find((option) => isToolAvailable(room, option.value))?.value;
    if (!fallback) return;
    setTool(fallback);
    setModelId(DEFAULT_MODEL_ID[fallback]);
  }, [room, tool]);

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
    if (isAliasInUse(room, trimmed)) {
      setError(`Alias '${trimmed}' is already in #${room.name}`);
      return;
    }
    if (!path) {
      setError("Path is required");
      return;
    }
    if (!isToolAvailable(room, tool)) {
      setError(`${toolLabel(tool)} is not installed`);
      return;
    }
    if (!selectedModel) {
      setError("Model is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await spawnAgent({
        roomId: room.id,
        tool,
        name: trimmed,
        path,
        model: selectedModel.model,
        ...(selectedModel.thinking ? { thinking: selectedModel.thinking } : {}),
      });
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
            {TOOL_OPTIONS.map((option) => {
              const availability = room.launchTools?.[option.value];
              const available = isToolAvailable(room, option.value);
              return (
              <label key={option.value} className={`spawn-tool-option${tool === option.value ? " selected" : ""}${available ? "" : " disabled"}`}>
                <input
                  type="radio"
                  name="spawn-agent-tool"
                  value={option.value}
                  checked={tool === option.value}
                  disabled={submitting || !available}
                  onChange={() => {
                    setTool(option.value);
                    setModelId(DEFAULT_MODEL_ID[option.value]);
                  }}
                />
                <span className="spawn-tool-copy">
                  <span className="spawn-tool-label">{option.label}</span>
                  <span className="spawn-tool-meta">{available ? availability?.path ?? "installed" : "not installed"}</span>
                </span>
              </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="spawn-tool-field">
          <legend>Model</legend>
          <div className="spawn-model-options">
            {modelOptions.map((option) => (
              <label key={option.id} className={`spawn-model-option${modelId === option.id ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="spawn-agent-model"
                  value={option.id}
                  checked={modelId === option.id}
                  disabled={submitting}
                  onChange={() => setModelId(option.id)}
                />
                <span className="spawn-model-copy">
                  <span className="spawn-model-label">{option.label}</span>
                  <span className="spawn-model-meta">{modelMeta(option)}</span>
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

function isToolAvailable(room: Room, tool: AgentLaunchTool): boolean {
  return room.launchTools?.[tool]?.available ?? true;
}

function isAliasInUse(room: Room, alias: string): boolean {
  return Object.values(room.memberAliases ?? {}).some((existing) => normalizeAliasDraft(existing) === alias);
}

function toolLabel(tool: AgentLaunchTool): string {
  return tool === "claude" ? "Claude" : "Pi";
}

function modelMeta(option: ModelOption): string {
  return option.thinking ? `${option.model} / ${option.thinking}` : option.model;
}
