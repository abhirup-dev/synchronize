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
import { Bot, BrainCircuit, Footprints, Hammer, Search, Telescope, UserRound, type LucideIcon } from "lucide-react";

// WCAG-style relative luminance; used to pick black-or-white text on a tinted
// background so colored chips stay readable across every agent color.
export function inkFor(bgHex: string): string {
  return isHexColor(bgHex) ? inkForHex(bgHex) : "var(--ink)";
}

function agentHarness(agent: Agent): "claude" | "codex" | "pi" | "letta" | "web" | "unknown" {
  const value = [
    agent.runtimeDetails?.tool,
    agent.runtimeDetails?.hostTool,
    agent.runtimeDetails?.profileName,
    agent.runtimeDetails?.model,
    agent.role,
  ].filter(Boolean).join(" ").toLowerCase();
  if (value.includes("codex") || value.includes("openai") || value.includes("gpt")) return "codex";
  if (value.includes("claude") || value.includes("anthropic") || value.includes("opus") || value.includes("sonnet") || value.includes("haiku")) return "claude";
  if (value.includes("pi")) return "pi";
  if (value.includes("letta")) return "letta";
  if (value.includes("web") || value.includes("human")) return "web";
  return "unknown";
}

export function HarnessMark({ agent, size }: { agent: Agent; size: number }) {
  const harness = agentHarness(agent);
  if (harness === "claude") {
    return (
      <svg className="sigil-harness-mark" width={size} height={size} viewBox="0 0 16 16" aria-label="Claude Code">
        <path fill="currentColor" d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z" />
      </svg>
    );
  }
  if (harness === "codex") {
    return (
      <svg className="sigil-harness-mark" width={size} height={size} viewBox="0 0 16 16" aria-label="Codex">
        <path fill="currentColor" d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
      </svg>
    );
  }
  if (harness === "pi") return <span className="sigil-harness-letter" aria-label="Pi">π</span>;
  if (harness === "letta") return <BrainCircuit className="sigil-harness-mark" width={size} height={size} aria-label="Letta" />;
  if (harness === "web") return <UserRound className="sigil-harness-mark" width={size} height={size} aria-label="Web operator" />;
  return <Bot className="sigil-harness-mark" width={size} height={size} aria-label="Agent" />;
}

function roleIcon(role: string): LucideIcon {
  const value = role.toLowerCase();
  if (/review|qa|test/.test(value)) return Search;
  if (/analysis|research|ml|data/.test(value)) return Telescope;
  if (/run|ops|infra|sre|browser/.test(value)) return Footprints;
  return Hammer;
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
  const RoleIcon = roleIcon(agent.role);
  const decorated = !isYou && size >= 26;
  return (
    <IdentityBadge
      as="div"
      className="identity-icon sigil-chip"
      color={agent.color}
      {...(agent.colorRef ? { colorRef: agent.colorRef } : null)}
      style={{ fontFamily: "var(--font-avatar)" }}
      self={isYou}
      size={size}
      fontSize={Math.round(size * 0.45)}
      title={`${agent.name} · ${agent.runtimeDetails?.tool ?? agent.handle}${agent.runtimeDetails?.model ? ` · ${agent.runtimeDetails.model}` : ""}`}
    >
      <HarnessMark agent={agent} size={Math.round(size * 0.62)} />
      {decorated ? (
        <span className="sigil-role-badge" title={agent.role}>
          <RoleIcon width={Math.round(size * 0.43)} height={Math.round(size * 0.43)} strokeWidth={2.4} aria-hidden="true" />
        </span>
      ) : null}
      {showStatus && (
        <StatusDot
          status={agent.status}
          size={Math.max(7, Math.round(size * 0.26))}
          className="identity-status-dot"
          pulse
        />
      )}
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
        border: 0,
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

export function MentionChip({ agent, text }: { agent: Agent; text?: string }) {
  const label = text ?? `@${agent.handle}`;
  const className = `mention-chip${isSelfAgent(agent) ? " mention-chip-self" : ""}`;
  if (isSelfAgent(agent)) return <span className={className}>{label}</span>;
  return (
    <IdentityText
      className={className}
      color={agent.color}
      {...(agent.colorRef ? { colorRef: agent.colorRef } : null)}
    >
      {label}
    </IdentityText>
  );
}

export function CountChip({ n }: { n: number }) {
  return <span className="count-chip">{n}</span>;
}
