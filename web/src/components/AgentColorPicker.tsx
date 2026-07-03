import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import {
  IDENTITY_SLOTS,
  identityRefEquals,
  identityStyleVars,
  type IdentityColorRef,
} from "../theme/identity.ts";
import type { HexColor } from "../theme/contrast.ts";

interface AgentColorPickerProps {
  /** Screen coordinates to anchor the popover to (e.g. the right-click point). */
  x: number;
  y: number;
  /** Current identity color reference (for the selected outline). */
  currentRef: IdentityColorRef;
  /** Default deterministic color reference. */
  defaultRef: IdentityColorRef;
  /** Display name shown in the popover header. */
  agentName: string;
  onPick(ref: IdentityColorRef): void;
  onReset(): void;
  onClose(): void;
}

export function AgentColorPicker({ x, y, currentRef, defaultRef, agentName, onPick, onReset, onClose }: AgentColorPickerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [custom, setCustom] = useState<HexColor>(currentRef.kind === "custom" ? currentRef.hex : "#3B0A45");

  // Close on outside click, scroll, or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[var(--z-agent-color-picker)] w-60 bg-paper [border:var(--line-md)] rounded-xl shadow-[var(--shadow)] p-2.5 flex flex-col gap-2.5 font-mono"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[length:var(--text-11)] tracking-[var(--tracking-sm)] text-ink">color · {agentName}</span>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {IDENTITY_SLOTS.map((slot) => {
          const slotRef = { kind: "slot", slot } satisfies IdentityColorRef;
          const isCurrent = identityRefEquals(slotRef, currentRef);
          return (
            <button
              key={slot}
              type="button"
              className={cn(
                "w-full aspect-square [border:var(--line-sm)] rounded-md shadow-sm cursor-pointer font-display text-[length:var(--text-12)] grid place-items-center [transition:transform_80ms_ease,box-shadow_80ms_ease] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:[box-shadow:var(--shadow-hover)]",
                isCurrent && "outline-2 outline-dashed outline-ink outline-offset-2",
              )}
              title={`slot ${slot}`}
              aria-label={`slot ${slot}`}
              style={{
                ...identityStyleVars(slotRef),
                background: "var(--identity-color)",
                color: "var(--identity-ink)",
              }}
              onClick={() => onPick(slotRef)}
            >
              {isCurrent ? "✓" : ""}
            </button>
          );
        })}
      </div>
      <div className="[border-top:var(--line-rule-dashed-xs)] pt-2">
        <label className="flex items-center gap-2.5 text-[length:var(--text-11)] text-ink-soft">
          <span>custom</span>
          <input
            type="color"
            className="w-[30px] h-[22px] p-0 [border:var(--line-sm)] rounded-sm bg-transparent cursor-pointer"
            value={custom}
            onChange={(e) => setCustom(e.target.value as HexColor)}
            onBlur={() => { if (currentRef.kind !== "custom" || custom.toLowerCase() !== currentRef.hex.toLowerCase()) onPick({ kind: "custom", hex: custom }); }}
          />
          <span className="ml-auto font-semibold text-ink">{custom.toUpperCase()}</span>
        </label>
      </div>
      <div className="flex items-center justify-between [border-top:var(--line-rule-dashed-xs)] pt-2">
        <button
          type="button"
          className="bg-transparent [border:var(--line-xs)] rounded-sm [padding:var(--space-button-pad-sm)] font-[inherit] text-[length:var(--text-10-5)] text-ink cursor-pointer hover:bg-paper-2"
          onClick={onReset}
        >
          reset to default
        </button>
        <span
          className="font-mono text-[length:var(--text-10)] px-1.5 py-0.5 [border:var(--line-xs)] rounded-sm"
          style={{
            ...identityStyleVars(defaultRef),
            background: "var(--identity-color)",
            color: "var(--identity-ink)",
          }}
        >
          {defaultRef.kind === "slot" ? `slot ${defaultRef.slot}` : defaultRef.kind === "custom" ? defaultRef.hex.toUpperCase() : defaultRef.token}
        </span>
      </div>
    </div>
  );
}
