// Small, reusable UI primitives shared across the app.

import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import type { Agent, AgentStatus } from "../data/types.ts";
import { isSelfAgent } from "../data/identity.ts";

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

function identityInkFor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? inkFor(color) : "var(--ink)";
}

export function IdentityBadge({
  color,
  ink,
  children,
  className = "",
  size,
  fontSize,
  self = false,
  title,
  style,
  as = "span",
  onContextMenu,
}: {
  color: string;
  ink?: string;
  children?: ReactNode;
  className?: string;
  size?: number;
  fontSize?: number | string;
  self?: boolean;
  title?: string;
  style?: CSSProperties;
  as?: "span" | "div";
  onContextMenu?: MouseEventHandler;
}) {
  const Element = as;
  const identityStyle = {
    ...style,
    ...(size !== undefined ? { "--identity-size": `${size}px` } : null),
    ...(fontSize !== undefined ? { "--identity-font-size": typeof fontSize === "number" ? `${fontSize}px` : fontSize } : null),
    "--identity-color": self ? "var(--paper-3)" : color,
    "--identity-ink": self ? "var(--ink)" : ink ?? identityInkFor(color),
  } as CSSProperties;
  return (
    <Element
      className={`${className ? `${className} ` : ""}identity-tint${self ? " identity-self" : ""}`}
      style={identityStyle}
      title={title}
      onContextMenu={onContextMenu}
    >
      {children}
    </Element>
  );
}

export function IdentityText({
  color,
  className = "",
  children,
}: {
  color: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`${className ? `${className} ` : ""}identity-text-tint`} style={{ "--identity-color": color } as CSSProperties}>
      {children}
    </span>
  );
}

export function Avatar({
  agent,
  size = 32,
  showStatus = false,
}: {
  agent: Agent;
  size?: number;
  showStatus?: boolean;
}) {
  // Self-marker ring uses the centralized identity check (id "you" or a web
  // client role); `me` isn't needed here since those signals are self-contained.
  const isYou = isSelfAgent(agent);
  return (
    <IdentityBadge
      as="div"
      // `.identity-icon` is the styled hook (styles.css + [data-theme] overrides;
      // also targeted by room-icon / ts-avatars). The legacy `.avatar` /
      // `.avatar-ring` classes carried no CSS in any sheet, so they are dropped.
      className="identity-icon"
      color={agent.color}
      ink={inkFor(agent.color)}
      self={isYou}
      size={size}
      fontSize={Math.round(size * 0.45)}
      title={`${agent.name} · ${agent.handle}`}
    >
      {agent.avatar}
      {showStatus && <StatusDot status={agent.status} className="identity-status-dot" pulse />}
    </IdentityBadge>
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
    <IdentityBadge
      className={`mention-chip${isSelfAgent(agent) ? " mention-chip-self" : ""}`}
      color={agent.color}
      ink={inkFor(agent.color)}
    >
      @{agent.handle}
    </IdentityBadge>
  );
}

export function CountChip({ n }: { n: number }) {
  return <span className="count-chip">{n}</span>;
}
