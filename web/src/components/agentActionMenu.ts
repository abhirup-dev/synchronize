import type { MouseEvent } from "react";
import type { Agent } from "../data/types.ts";
import { copyText } from "../utils/clipboard.ts";
import type { MenuEntry } from "./ContextMenu.tsx";
import { canShowAgentPreview } from "./AgentPreview.tsx";

interface ToastApi {
  show(message: string, options?: { kind?: "success" | "error" | "info" }): void;
}

interface ArchiveApi {
  archiveSession(agent: Agent): void;
  resumeSession(agent: Agent): void;
}

export interface AgentActionMenuOptions {
  agent: Agent;
  toast: ToastApi;
  archive: ArchiveApi;
  onOpenDm?(): void;
  onViewProfile?(): void;
  onChangeColor?(position: { x: number; y: number }): void;
}

export function agentActionMenuItems(
  event: MouseEvent,
  {
    agent,
    toast,
    archive,
    onOpenDm,
    onViewProfile,
    onChangeColor,
  }: AgentActionMenuOptions,
): MenuEntry[] {
  const canViewProfile = Boolean(onViewProfile && canShowAgentPreview(agent));
  const copyAoeCommand = agent.aoeSession
    ? async () => {
        const copied = await copyText(agent.aoeSession!.attachCommand);
        toast.show(copied ? "AOE command copied" : "Could not copy AOE command", {
          kind: copied ? "success" : "error",
        });
      }
    : () => {};

  const items: MenuEntry[] = [];
  if (onOpenDm) items.push({ label: "Open DM", onSelect: onOpenDm });
  if (canViewProfile && onViewProfile) items.push({ label: "View profile", onSelect: onViewProfile });
  items.push(
    { divider: true },
    {
      label: agent.aoeSession ? "Copy AOE attach command" : "AOE session unavailable",
      ...(agent.aoeSession ? { shortcut: agent.aoeSession.title } : {}),
      disabled: !agent.aoeSession,
      onSelect: copyAoeCommand,
    },
    { divider: true },
    {
      label: "Archive session...",
      disabled: agent.id === "you" || agent.lifecycleState === "archived",
      onSelect: () => archive.archiveSession(agent),
    },
    {
      label: "Resume session...",
      disabled: agent.lifecycleState !== "archived",
      onSelect: () => archive.resumeSession(agent),
    },
  );
  if (onChangeColor) {
    items.push(
      { divider: true },
      { label: "Change color...", onSelect: () => onChangeColor({ x: event.clientX, y: event.clientY }) },
    );
  }
  items.push(
    { divider: true },
    {
      label: "Copy @handle",
      onSelect: async () => {
        const copied = await copyText(`@${agent.handle}`);
        toast.show(copied ? "Handle copied" : "Could not copy handle", {
          kind: copied ? "success" : "error",
        });
      },
    },
    { divider: true },
    { label: "Mute mentions", onSelect: () => console.log("mute", agent.id) },
  );
  return items;
}
