import { useEffect, useRef, useState } from "react";
import { inkFor } from "./primitives.tsx";
import { cn } from "../lib/cn.ts";

interface AgentColorPickerProps {
  /** Screen coordinates to anchor the popover to (e.g. the right-click point). */
  x: number;
  y: number;
  /** Current color of the agent (for the "selected" outline). */
  currentHex: string;
  /** Default/seeded color — used by the "Default" swatch to restore the
   *  original identity. */
  defaultHex: string;
  /** Display name shown in the popover header. */
  agentName: string;
  onPick(hex: string): void;
  onReset(): void;
  onClose(): void;
}

// Brutalist palette — matches DESIGN.md accent tokens. Black is intentionally
// available too (it's a valid identity for the user / system messages).
const SWATCHES: Array<{ label: string; hex: string }> = [
  { label: "yellow",    hex: "#FFD23F" },
  { label: "pink",      hex: "#FF5DA2" },
  { label: "blue",      hex: "#4D7CFE" },
  { label: "lime",      hex: "#7BE389" },
  { label: "tangerine", hex: "#FF8A3D" },
  { label: "lilac",     hex: "#B49BFF" },
  { label: "teal",      hex: "#2EC4B6" },
  { label: "red",       hex: "#F45B69" },
  { label: "forest",    hex: "#1F7A3A" },
  { label: "navy",      hex: "#1E2A78" },
  { label: "rust",      hex: "#A14A1A" },
  { label: "slate",     hex: "#555E6E" },
];

export function AgentColorPicker({ x, y, currentHex, defaultHex, agentName, onPick, onReset, onClose }: AgentColorPickerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [custom, setCustom] = useState(currentHex);

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

  const norm = currentHex.toLowerCase();

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
      <div className="grid grid-cols-6 gap-1.5">
        {SWATCHES.map(({ label, hex }) => {
          const isCurrent = hex.toLowerCase() === norm;
          return (
            <button
              key={hex}
              type="button"
              className={cn(
                "w-full aspect-square [border:var(--line-sm)] rounded-md shadow-sm cursor-pointer font-display text-[length:var(--text-12)] grid place-items-center [transition:transform_80ms_ease,box-shadow_80ms_ease] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:[box-shadow:var(--shadow-hover)]",
                isCurrent && "outline-2 outline-dashed outline-ink outline-offset-2",
              )}
              title={label}
              aria-label={label}
              style={{ background: hex, color: inkFor(hex) }}
              onClick={() => onPick(hex)}
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
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => { if (custom.toLowerCase() !== norm) onPick(custom); }}
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
          style={{ background: defaultHex, color: inkFor(defaultHex) }}
        >
          {defaultHex.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
