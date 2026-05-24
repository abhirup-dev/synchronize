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

export function Avatar({ agent, size = 32, ring = false }: { agent: Agent; size?: number; ring?: boolean }) {
  const isYou = agent.id === "you";
  return (
    <div
      className={`avatar${ring ? " avatar-ring" : ""}`}
      style={{
        width: size,
        height: size,
        background: isYou ? "var(--paper-3)" : agent.color,
        color: isYou ? "var(--ink)" : inkFor(agent.color),
        borderRadius: 5,
        border: "2.5px solid var(--rule)",
        display: "grid",
        placeItems: "center",
        fontFamily: "Archivo Black, sans-serif",
        fontSize: Math.round(size * 0.45),
        boxShadow: "1.5px 1.5px 0 var(--rule)",
        flexShrink: 0,
      }}
      title={`${agent.name} · ${agent.handle}`}
    >
      {agent.avatar}
    </div>
  );
}

export function StatusDot({ status, size = 12 }: { status: AgentStatus; size?: number }) {
  const fill = (
    {
      online: "var(--lime)",
      busy: "var(--pink)",
      idle: "var(--yellow)",
      offline: "var(--muted)",
    } as const
  )[status];
  return (
    <span
      className={`status-dot status-${status}`}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "999px",
        background: fill,
        border: "2px solid var(--rule)",
        animation: status === "busy" ? "pulse-busy 1.6s infinite ease-in-out" : undefined,
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
        padding: "4px 10px",
        background: color ?? "var(--paper-3)",
        border: "2px solid var(--rule)",
        borderRadius: 0,
        boxShadow: "3px 3px 0 var(--rule)",
        fontFamily: "Archivo Black, sans-serif",
        fontSize: 11,
        letterSpacing: "0.08em",
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
      style={{ "--mention-color": agent.color } as CSSProperties}
    >
      @{agent.handle}
    </span>
  );
}

export function CountChip({ n }: { n: number }) {
  return <span className="count-chip">{n}</span>;
}
