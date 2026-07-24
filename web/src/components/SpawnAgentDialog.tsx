import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useLaunchProfiles, useSpawnAgent } from "../data/context.tsx";
import type { AgentLaunchProfile, AgentLaunchTool, Room } from "../data/types.ts";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS, type ModelOption } from "../data/models.ts";
import { useToast } from "./Toast.tsx";
import { roomNameText } from "./primitives.tsx";

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

interface RuntimeTarget {
  id: string;
  kind: "tool" | "profile";
  tool: AgentLaunchTool;
  profileName?: string;
  label: string;
  meta: string;
  available: boolean;
}


const TOOL_OPTIONS: ToolOption[] = [
  { value: "claude", label: "Claude" },
  { value: "pi", label: "Pi" },
  { value: "letta", label: "Letta" },
];


interface SpawnAgentDialogProps {
  room: Room;
  onClose(): void;
}

export function SpawnAgentDialog({ room, onClose }: SpawnAgentDialogProps) {
  const spawnAgent = useSpawnAgent();
  const launchProfiles = useLaunchProfiles();
  const toast = useToast();
  const [targetId, setTargetId] = useState("tool:pi");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID.pi);
  const [name, setName] = useState(() => defaultAgentName("pi", room));
  const [path, setPath] = useState(() => room.paths?.[0]?.path ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const roomLabel = useMemo(() => roomNameText(room.kind, room.name), [room.kind, room.name]);
  const title = useMemo(() => `Spawn into ${roomLabel}`, [roomLabel]);
  const profiles = useMemo(
    () => mergeLaunchProfiles(launchProfiles, room.launchProfiles ?? []),
    [launchProfiles, room.launchProfiles],
  );
  const targets = useMemo(() => runtimeTargets(room, profiles), [room, profiles]);
  const selectedTarget = targets.find((target) => target.id === targetId) ?? targets[0] ?? fallbackRuntimeTarget();
  const modelOptions = useMemo(() => modelOptionsForTarget(profiles, selectedTarget), [profiles, selectedTarget]);
  const selectedModel = modelOptions.find((option) => option.id === modelId) ?? modelOptions[0];

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    if (!profiles.some((profile) => profile.name === selectedTarget.profileName)) return;
    if (!modelOptions.some((option) => option.id === modelId)) {
      setModelId(modelOptions[0]?.id ?? DEFAULT_MODEL_ID[selectedTarget.tool]);
    }
  }, [modelId, modelOptions, profiles, selectedTarget.profileName, selectedTarget.tool]);

  useEffect(() => {
    if (!nameTouched) setName(defaultAgentName(selectedTarget.profileName ?? selectedTarget.tool, room));
  }, [nameTouched, room, selectedTarget]);

  useEffect(() => {
    if (!modelOptions.some((option) => option.id === modelId)) {
      setModelId(modelOptions[0]?.id ?? DEFAULT_MODEL_ID[selectedTarget.tool]);
    }
  }, [modelId, modelOptions, selectedTarget.tool]);

  useEffect(() => {
    if (selectedTarget.available) return;
    const fallback = targets.find((target) => target.available);
    if (!fallback) return;
    setTargetId(fallback.id);
    setModelId(modelOptionsForTarget(profiles, fallback)[0]?.id ?? DEFAULT_MODEL_ID[fallback.tool]);
  }, [profiles, selectedTarget, targets]);

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
      setError(`Alias '${trimmed}' is already in ${roomLabel}`);
      return;
    }
    if (!path) {
      setError("Path is required");
      return;
    }
    if (!selectedTarget.available) {
      setError(`${selectedTarget.label} is not available`);
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
        tool: selectedTarget.tool,
        ...(selectedTarget.profileName ? { profileName: selectedTarget.profileName } : {}),
        name: trimmed,
        path,
        ...(selectedModel.model ? { model: selectedModel.model } : {}),
        ...(selectedModel.thinking ? { thinking: selectedModel.thinking } : {}),
      });
      toast.show(`${result.sessionName} is launching in ${roomNameText("group", result.group)}`, { kind: "success" });
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
            {targets.map((option) => (
              <label key={option.id} className={optionCard({ selected: targetId === option.id, disabled: !option.available })}>
                <input
                  type="radio"
                  name="spawn-agent-tool"
                  className="accent-blue"
                  value={option.id}
                  checked={targetId === option.id}
                  disabled={submitting || !option.available}
                  onChange={() => {
                    setTargetId(option.id);
                    setModelId(modelOptionsForTarget(profiles, option)[0]?.id ?? DEFAULT_MODEL_ID[option.tool]);
                  }}
                />
                <span className={optionCopy}>
                  <span className={optionLabel}>{option.label}</span>
                  <span className={optionMeta}>{option.meta}</span>
                </span>
              </label>
            ))}
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

function defaultAgentName(tool: string, room: Room): string {
  const slug = room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
  return normalizeAliasDraft(`${tool}-${slug}`).replace(/^-+|-+$/g, "") || tool;
}

function pathLabel(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function normalizeAliasDraft(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/--+/g, "-").slice(0, 11);
}

function runtimeTargets(room: Room, profiles: AgentLaunchProfile[]): RuntimeTarget[] {
  const builtinTargets = TOOL_OPTIONS.map((option) => {
    const availability = room.launchTools?.[option.value];
    const available = availability?.available ?? true;
    return {
      id: `tool:${option.value}`,
      kind: "tool" as const,
      tool: option.value,
      label: option.label,
      meta: available ? availability?.path ?? "installed" : "not installed",
      available,
    };
  });
  const profileTargets = profiles.map((profile) => ({
    id: `profile:${profile.name}`,
    kind: "profile" as const,
    tool: profile.tool,
    profileName: profile.name,
    label: profile.name,
    meta: profile.available
      ? `profile / ${profile.tool}${profile.model ? ` / ${profile.model}` : ""}`
      : profile.disabledReason ?? "not available",
    available: profile.available,
  }));
  return [...builtinTargets, ...profileTargets];
}

function fallbackRuntimeTarget(): RuntimeTarget {
  return {
    id: "tool:pi",
    kind: "tool",
    tool: "pi",
    label: "Pi",
    meta: "installed",
    available: true,
  };
}

function modelOptionsForTarget(profiles: AgentLaunchProfile[], target: RuntimeTarget): ModelOption[] {
  if (target.kind === "tool") return MODEL_OPTIONS[target.tool];
  const profile = profiles.find((candidate) => candidate.name === target.profileName);
  return [
    {
      id: `${target.id}:default`,
      tool: target.tool,
      label: profile?.model ? "Profile model" : "Profile default",
      ...(profile?.model ? { model: profile.model } : {}),
      ...(profile?.thinking ? { thinking: profile.thinking } : {}),
    },
  ];
}

function mergeLaunchProfiles(...sources: AgentLaunchProfile[][]): AgentLaunchProfile[] {
  const byName = new Map<string, AgentLaunchProfile>();
  for (const profiles of sources) {
    for (const profile of profiles) byName.set(profile.name, profile);
  }
  return [...byName.values()];
}

function isAliasInUse(room: Room, alias: string): boolean {
  return Object.values(room.memberAliases ?? {}).some((existing) => normalizeAliasDraft(existing) === alias);
}

function modelMeta(option: ModelOption): string {
  if (!option.model) return "from profile env/config";
  return option.thinking ? `${option.model} / ${option.thinking}` : option.model;
}
