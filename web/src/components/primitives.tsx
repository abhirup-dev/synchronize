// Small, reusable UI primitives shared across the app.

import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import type { Agent, AgentStatus } from "../data/types.ts";
import { isSelfAgent } from "../data/identity.ts";
import {
  identityStyleVars,
  normalizeIdentityColorRef,
  type IdentityColorRef,
} from "../theme/identity.ts";
import { inkForHex, isHexColor } from "../theme/contrast.ts";

// WCAG-style relative luminance; used to pick black-or-white text on a tinted
// background so colored chips stay readable across every agent color.
export function inkFor(bgHex: string): string {
  return isHexColor(bgHex) ? inkForHex(bgHex) : "var(--ink)";
}

export function IdentityBadge({
  color,
  colorRef,
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
  ariaHidden,
}: {
  color?: string;
  colorRef?: IdentityColorRef;
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
  ariaHidden?: boolean;
}) {
  const Element = as;
  const ref = colorRef ?? normalizeIdentityColorRef(color ?? "var(--paper-3)");
  const identityStyle = {
    ...style,
    ...(size !== undefined ? { "--identity-size": `${size}px` } : null),
    ...(fontSize !== undefined ? { "--identity-font-size": typeof fontSize === "number" ? `${fontSize}px` : fontSize } : null),
    ...(self
      ? {
          "--identity-color": "var(--paper-3)",
          "--identity-ink": "var(--ink)",
          "--identity-border": "var(--rule)",
          "--identity-text": "var(--ink)",
        }
      : identityStyleVars(ref)),
    ...(ink !== undefined ? { "--identity-ink": ink } : null),
  } as CSSProperties;
  return (
    <Element
      className={`${className ? `${className} ` : ""}identity-tint${self ? " identity-self" : ""}`}
      style={identityStyle}
      title={title}
      onContextMenu={onContextMenu}
      aria-hidden={ariaHidden}
    >
      {children}
    </Element>
  );
}

export function IdentityLogoTile({
  color,
  colorRef,
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
  ariaHidden,
}: {
  color?: string;
  colorRef?: IdentityColorRef;
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
  ariaHidden?: boolean;
}) {
  const logoClassName = `${className ? `${className} ` : ""}identity-logo-tile`;

  if (color || colorRef) {
    return (
      <IdentityBadge
        as={as}
        className={logoClassName}
        {...(color !== undefined ? { color } : null)}
        {...(colorRef !== undefined ? { colorRef } : null)}
        {...(ink !== undefined ? { ink } : null)}
        {...(self ? { self } : null)}
        {...(size !== undefined ? { size } : null)}
        {...(fontSize !== undefined ? { fontSize } : null)}
        {...(title !== undefined ? { title } : null)}
        {...(style !== undefined ? { style } : null)}
        {...(onContextMenu !== undefined ? { onContextMenu } : null)}
        {...(ariaHidden !== undefined ? { ariaHidden } : null)}
      >
        {children}
      </IdentityBadge>
    );
  }

  const Element = as;
  return (
    <Element className={logoClassName} style={style} title={title} onContextMenu={onContextMenu} aria-hidden={ariaHidden}>
      {children}
    </Element>
  );
}

export function PanelSectionHeader({
  label,
  count,
  actionLabel,
  actionTitle,
  onAction,
  className = "",
}: {
  label: string;
  count?: number;
  actionLabel?: ReactNode;
  actionTitle?: string;
  onAction?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <div className={`${className ? `${className} ` : ""}panel-section-head`}>
      <span className="panel-section-title">
        <span>{label}</span>
        {count !== undefined && <CountChip n={count} />}
      </span>
      {actionLabel !== undefined ? (
        <button
          type="button"
          className="panel-section-action"
          title={actionTitle}
          aria-label={actionTitle ?? String(actionLabel)}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function IdentityText({
  color,
  colorRef,
  className = "",
  children,
}: {
  color?: string;
  colorRef?: IdentityColorRef;
  className?: string;
  children: ReactNode;
}) {
  const ref = colorRef ?? normalizeIdentityColorRef(color ?? "var(--ink)");
  return (
    <span className={`${className ? `${className} ` : ""}identity-text-tint`} style={identityStyleVars(ref) as CSSProperties}>
      {children}
    </span>
  );
}

export function RoomNameInline({
  kind,
  name,
  className = "",
  showPrefix = true,
}: {
  kind: "group" | "dm";
  name: string;
  className?: string;
  showPrefix?: boolean;
}) {
  if (kind === "dm") {
    return <span className={className}>{name}</span>;
  }
  return (
    <span className={`${className ? `${className} ` : ""}room-name-inline`}>
      {showPrefix ? <span className="room-name-hash" aria-hidden="true">#</span> : null}
      <span className="room-name-text">{name}</span>
    </span>
  );
}

export function roomNameText(kind: "group" | "dm", name: string): string {
  return kind === "group" ? `#${name}` : name;
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
      {...(agent.colorRef ? { colorRef: agent.colorRef } : null)}
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
      online: "var(--status-online)",
      busy: "var(--status-busy)",
      idle: "var(--status-idle)",
      offline: "var(--status-offline)",
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
      {...(agent.colorRef ? { colorRef: agent.colorRef } : null)}
    >
      @{agent.handle}
    </IdentityBadge>
  );
}

export function CountChip({ n }: { n: number }) {
  return <span className="count-chip">{n}</span>;
}
