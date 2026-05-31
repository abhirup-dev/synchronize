import { useEffect, useRef, useState } from "react";
import { inkFor } from "./primitives.tsx";

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
      className="agent-color-picker"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="acp-head">
        <span className="acp-title">color · {agentName}</span>
      </div>
      <div className="acp-swatches">
        {SWATCHES.map(({ label, hex }) => {
          const isCurrent = hex.toLowerCase() === norm;
          return (
            <button
              key={hex}
              type="button"
              className={`acp-swatch${isCurrent ? " is-current" : ""}`}
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
      <div className="acp-custom">
        <label className="acp-custom-row">
          <span>custom</span>
          <input
            type="color"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => { if (custom.toLowerCase() !== norm) onPick(custom); }}
          />
          <span className="acp-custom-hex">{custom.toUpperCase()}</span>
        </label>
      </div>
      <div className="acp-foot">
        <button type="button" className="acp-reset" onClick={onReset}>
          reset to default
        </button>
        <span className="acp-default-chip" style={{ background: defaultHex, color: inkFor(defaultHex) }}>
          {defaultHex.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
