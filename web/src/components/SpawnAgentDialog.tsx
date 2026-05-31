import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useSpawnAgent } from "../data/context.tsx";
import type { AgentLaunchTool, Room } from "../data/types.ts";
import { useToast } from "./Toast.tsx";

// Styles migrated from styles.css (.spawn-* family) to inline Tailwind v4
// utilities. `.spawn-agent-dialog` is retained as a class because it is a
// [data-skin="glass"] hook in skin-glass.css; its base declaration was removed
// from styles.css and reproduced here via utilities.

// .spawn-agent-kicker / .spawn-agent-field label / .spawn-tool-field legend
const labelKicker =
  "font-display text-[length:var(--text-10)] tracking-[var(--tracking-lg)] text-ink-soft uppercase";

// .spawn-tool-option / .spawn-model-option / .spawn-path-option (+ selected/disabled)
const optionCard = cva(
  "flex items-center gap-[10px] min-h-[48px] p-[9px_10px] rounded-sm cursor-pointer",
  {
    variants: {
      selected: {
        true: "bg-paper border-blue shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--blue)_35%,transparent)]",
        false: "bg-paper-2 [border:var(--line-xs-faint)]",
      },
      disabled: {
        true: "opacity-[0.52] cursor-not-allowed",
        false: "",
      },
    },
    defaultVariants: { selected: false, disabled: false },
  },
);

// .spawn-tool-copy / .spawn-model-copy / .spawn-path-copy
const optionCopy = "min-w-0 grid gap-[2px]";
// .spawn-tool-label / .spawn-model-label / .spawn-path-label
const optionLabel = "font-display text-[length:var(--text-14)]";
// .spawn-tool-meta / .spawn-model-meta / .spawn-path-value
const optionMeta =
  "min-w-0 overflow-hidden text-ellipsis font-mono text-[length:var(--text-11)] text-ink-soft whitespace-nowrap";

// .spawn-secondary / .spawn-primary
const actionBtn = cva(
  "min-w-[86px] min-h-[34px] [border:var(--line-xs)] rounded-sm p-[7px_12px] font-display text-[length:var(--text-12)] disabled:opacity-[0.55] disabled:cursor-wait",
  {
    variants: {
      kind: {
        secondary: "bg-paper-2 text-ink",
        primary: "bg-blue text-on-accent",
      },
    },
  },
);

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
  { value: "letta", label: "Letta" },
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
  letta: [
    { id: "letta-glm-47", tool: "letta", label: "GLM 4.7", model: "zai/glm-4.7" },
  ],
};

const DEFAULT_MODEL_ID: Record<AgentLaunchTool, string> = {
  claude: "claude-sonnet",
  pi: "pi-gpt-55-medium",
  letta: "letta-glm-47",
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className="modal-backdrop"
          style={{ userSelect: "auto", WebkitUserSelect: "auto" }}
        >
          <Dialog.Popup
            initialFocus={nameRef}
            render={
              <form
                className={cn(
                  "spawn-agent-dialog",
                  "w-[min(460px,100%)] max-h-[min(680px,calc(100vh-40px))] overflow-auto flex flex-col gap-[14px] bg-paper text-ink [border:var(--line-md)] rounded-lg shadow-lg p-[16px]",
                )}
                onSubmit={submit}
              />
            }
          >
        <div className="flex items-start justify-between gap-[16px]">
          <div>
            <div className={labelKicker}>agent</div>
            <Dialog.Title render={<h2 className="mt-[3px] font-display text-[length:var(--text-22)] leading-[1.05]" />}>{title}</Dialog.Title>
          </div>
          <button
            type="button"
            className="w-[30px] h-[30px] grid place-items-center bg-paper-2 text-ink [border:var(--line-xs)] rounded-sm shadow-xs font-mono font-black"
            aria-label="close"
            onClick={onClose}
          >x</button>
        </div>

        <div className="grid gap-[6px]">
          <label htmlFor="spawn-agent-name" className={labelKicker}>Name</label>
          <input
            id="spawn-agent-name"
            ref={nameRef}
            className="w-full bg-paper-2 text-ink [border:var(--line-xs)] rounded-sm p-[9px_10px] font-mono text-[length:var(--text-14)]"
            maxLength={11}
            value={name}
            onChange={(event) => {
              setNameTouched(true);
              setName(normalizeAliasDraft(event.target.value));
            }}
            disabled={submitting}
          />
        </div>

        <fieldset className="grid gap-[8px] p-0 m-0 border-0">
          <legend className={labelKicker}>Runtime</legend>
          <div className="grid gap-[8px] grid-cols-2">
            {TOOL_OPTIONS.map((option) => {
              const availability = room.launchTools?.[option.value];
              const available = isToolAvailable(room, option.value);
              return (
              <label key={option.value} className={optionCard({ selected: tool === option.value, disabled: !available })}>
                <input
                  type="radio"
                  name="spawn-agent-tool"
                  className="accent-blue"
                  value={option.value}
                  checked={tool === option.value}
                  disabled={submitting || !available}
                  onChange={() => {
                    setTool(option.value);
                    setModelId(DEFAULT_MODEL_ID[option.value]);
                  }}
                />
                <span className={optionCopy}>
                  <span className={optionLabel}>{option.label}</span>
                  <span className={optionMeta}>{available ? availability?.path ?? "installed" : "not installed"}</span>
                </span>
              </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="grid gap-[8px] p-0 m-0 border-0">
          <legend className={labelKicker}>Model</legend>
          <div className="grid gap-[8px] grid-cols-[repeat(auto-fit,minmax(118px,1fr))]">
            {modelOptions.map((option) => (
              <label key={option.id} className={optionCard({ selected: modelId === option.id })}>
                <input
                  type="radio"
                  name="spawn-agent-model"
                  className="accent-blue"
                  value={option.id}
                  checked={modelId === option.id}
                  disabled={submitting}
                  onChange={() => setModelId(option.id)}
                />
                <span className={optionCopy}>
                  <span className={optionLabel}>{option.label}</span>
                  <span className={optionMeta}>{modelMeta(option)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-[8px] p-0 m-0 border-0">
          <legend className={labelKicker}>Path</legend>
          <div className="grid gap-[8px]">
            {(room.paths ?? []).map((option) => (
              <label key={option.id} className={optionCard({ selected: path === option.path })}>
                <input
                  type="radio"
                  name="spawn-agent-path"
                  className="accent-blue"
                  value={option.path}
                  checked={path === option.path}
                  disabled={submitting}
                  onChange={() => setPath(option.path)}
                />
                <span className={optionCopy}>
                  <span className={optionLabel}>{option.label ?? pathLabel(option.path)}</span>
                  <span className={optionMeta}>{option.path}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <div
            className="p-[8px_10px] bg-[color-mix(in_srgb,var(--red)_18%,var(--paper))] [border:var(--line-xs)] border-red rounded-sm font-mono text-[length:var(--text-12)]"
            role="alert"
          >{error}</div>
        )}

        <div className="flex justify-end gap-[8px]">
          <button type="button" className={actionBtn({ kind: "secondary" })} onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className={actionBtn({ kind: "primary" })} disabled={submitting}>
            {submitting ? "Spawning..." : "Spawn"}
          </button>
        </div>
          </Dialog.Popup>
        </Dialog.Backdrop>
      </Dialog.Portal>
    </Dialog.Root>
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
  if (tool === "claude") return "Claude";
  if (tool === "letta") return "Letta";
  return "Pi";
}

function modelMeta(option: ModelOption): string {
  return option.thinking ? `${option.model} / ${option.thinking}` : option.model;
}
