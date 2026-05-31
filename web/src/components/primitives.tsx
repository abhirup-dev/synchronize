// Small, reusable UI primitives shared across the app.

import type { CSSProperties } from "react";
import type { Agent, AgentStatus } from "../data/types.ts";

// WCAG-style relative luminance; used to pick black-or-white text on a tinted
// background so colored chips stay readable across every agent color.
function relLum(hex: string): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function inkFor(bgHex: string): string {
  return relLum(bgHex) > 0.55 ? "#111111" : "#FFFFFF";
}

export function Avatar({
  agent,
  size = 32,
  ring = false,
  showStatus = false,
}: {
  agent: Agent;
  size?: number;
  ring?: boolean;
  showStatus?: boolean;
}) {
  const isYou = agent.id === "you";
  return (
    <div
      className={`avatar identity-icon${ring ? " avatar-ring" : ""}`}
      style={{
        "--identity-size": `${size}px`,
        "--identity-font-size": `${Math.round(size * 0.45)}px`,
        background: isYou ? "var(--paper-3)" : agent.color,
        color: isYou ? "var(--ink)" : inkFor(agent.color),
      } as CSSProperties}
      title={`${agent.name} · ${agent.handle}`}
    >
      {agent.avatar}
      {showStatus && <StatusDot status={agent.status} className="identity-status-dot" pulse />}
    </div>
  );
}

export function StatusDot({
  status,
  size = 12,
  className = "",
  pulse = false,
}: {
  status: AgentStatus;
  size?: number;
  className?: string;
  pulse?: boolean;
}) {
  const fill = (
    {
      online: "var(--lime)",
      busy: "var(--pink)",
      idle: "var(--yellow)",
      offline: "var(--muted)",
    } as const
  )[status];
  // Only active presence throbs: online (ready, green) and busy (working, pink).
  // Idle (amber) and offline (grey) are steady — a pulsing dot reads as "live
  // and engaged", which idle/offline explicitly are not.
  const animated = pulse && (status === "online" || status === "busy");
  return (
    <span
      className={`status-dot status-${status}${className ? ` ${className}` : ""}`}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--radius-pill)",
        background: fill,
        border: "2px solid var(--status-dot-border, var(--rule))",
        animation: animated ? "status-badge-pulse 1.8s infinite ease-in-out" : undefined,
      }}
    />
  );
}

export function Sticker({ label, color, tilt = -2 }: { label: string; color?: string; tilt?: number }) {
  return (
    <span
      className="sticker"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "var(--space-sticker-pad)",
        background: color ?? "var(--paper-3)",
        border: "var(--line-sm)",
        borderRadius: "var(--radius-none)",
        boxShadow: "var(--shadow-hover)",
        fontFamily: "var(--font-display)",
        fontSize: "var(--text-11)",
        letterSpacing: "var(--tracking-lg)",
        color: "var(--ink)",
        textTransform: "uppercase",
        transform: `rotate(${tilt}deg)`,
      }}
    >
      {label}
    </span>
  );
}

export function MentionChip({ agent }: { agent: Agent }) {
  return (
    <span
      className={`mention-chip${agent.handle === "you" ? " mention-chip-self" : ""}`}
      style={{ "--mention-color": agent.color, "--mention-ink": inkFor(agent.color) } as CSSProperties}
    >
      @{agent.handle}
    </span>
  );
}

export function CountChip({ n }: { n: number }) {
  return <span className="count-chip">{n}</span>;
}
