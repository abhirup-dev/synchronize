// ponytail: dev-only live token editor. Tweaks the *color* knobs of the active
// theme/skin in place (inline overrides on <html>) and previews against the real
// app — the thing tweakcn.com can't do (it previews shadcn demos, not us).
// Curated to the palette tokens, not the full contract; add an aesthetic-token
// section here if shadow/radius tuning is ever wanted. Disabled by default —
// enable once with `?theme-editor=1` (persists), disable with `?theme-editor=0`.
import { useEffect, useMemo, useRef, useState } from "react";
import { Palette, X, Copy, RotateCcw } from "lucide-react";

// The palette knobs worth live-tuning, grouped for the panel. These are the
// values that differ per theme/skin and that a designer iterates on; aesthetic
// tokens (radii/shadows) are intentionally out of scope for v1.
const TOKEN_GROUPS: { label: string; tokens: string[] }[] = [
  // shadcn primitives are the authoritative source (inverted ownership) — editing
  // these drives the role tokens below, and matches what a tweakcn export writes.
  { label: "Base (shadcn)", tokens: ["--background", "--card", "--popover", "--foreground", "--muted-foreground", "--primary", "--primary-foreground", "--border", "--destructive"] },
  { label: "Surfaces", tokens: ["--paper", "--paper-2", "--paper-3"] },
  { label: "Ink", tokens: ["--ink", "--ink-soft", "--ink-faint", "--on-accent"] },
  { label: "Structure", tokens: ["--rule", "--accent", "--muted"] },
  { label: "Accents", tokens: ["--yellow", "--pink", "--blue", "--lime", "--tangerine", "--lilac", "--teal", "--red"] },
  { label: "Chat", tokens: ["--bubble", "--you-bg", "--you-fg", "--code-bg", "--code-fg"] },
];
const ALL_TOKENS = TOKEN_GROUPS.flatMap((g) => g.tokens);

function editorEnabled(): boolean {
  const param = new URLSearchParams(window.location.search).get("theme-editor");
  if (param === "1") localStorage.setItem("synchronize.themeEditor", "1");
  if (param === "0") localStorage.removeItem("synchronize.themeEditor");
  return localStorage.getItem("synchronize.themeEditor") === "1";
}

// rgb(a) → #rrggbb for the native color input. Returns null when there's alpha
// (the swatch can't represent it) or the value won't parse — caller falls back
// to the text field, which stays authoritative either way.
function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/^rgba?\(([^)]+)\)$/);
  if (!m?.[1]) return null;
  const parts = m[1].split(",").map((p) => p.trim());
  if (parts.length === 4 && Number(parts[3]) < 1) return null;
  const rgbNums = parts.slice(0, 3).map((p) => Number.parseInt(p, 10));
  if (rgbNums.length < 3 || rgbNums.some((n) => Number.isNaN(n))) return null;
  return "#" + rgbNums.map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function ThemeTokenEditor() {
  const enabled = useMemo(editorEnabled, []);
  const [open, setOpen] = useState(false);
  // token name -> authoritative string the user is editing (resolved color or raw).
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const probeRef = useRef<HTMLSpanElement>(null);

  // Resolve each token to a concrete color via a probe element so `var()`
  // indirection (e.g. --accent: var(--yellow)) shows the real color, then read
  // back any inline override we've already applied so re-opening is stable.
  const refresh = () => {
    const probe = probeRef.current;
    const rootStyle = document.documentElement.style;
    const next: Record<string, string> = {};
    for (const name of ALL_TOKENS) {
      const override = rootStyle.getPropertyValue(name).trim();
      if (override) {
        next[name] = override;
        continue;
      }
      if (probe) {
        probe.style.color = "";
        probe.style.color = `var(${name})`;
        next[name] = getComputedStyle(probe).color || name;
      }
    }
    setValues(next);
  };

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Inline overrides live on <html> and out-rank the [data-theme][data-skin]
  // stylesheet rules, so without this they'd bleed across switches (tune kanagawa,
  // switch to light, and the kanagawa --background still wins). Edits are scoped to
  // the combo you're on and exported per-combo, so when the active theme/skin
  // changes we drop the overrides and re-read from the new combo. Export first.
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      for (const name of ALL_TOKENS) root.style.removeProperty(name);
      setDirty(new Set());
      refresh();
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;

  const apply = (name: string, value: string) => {
    document.documentElement.style.setProperty(name, value);
    setValues((v) => ({ ...v, [name]: value }));
    setDirty((d) => new Set(d).add(name));
  };

  const reset = () => {
    for (const name of ALL_TOKENS) document.documentElement.style.removeProperty(name);
    setDirty(new Set());
    refresh();
  };

  const exportCss = () => {
    const theme = document.documentElement.dataset["theme"] ?? "light";
    const skin = document.documentElement.dataset["skin"] ?? "brutal";
    const lines = [...dirty].sort().map((name) => `  ${name}: ${values[name]};`);
    const block = `:root[data-skin="${skin}"][data-theme="${theme}"] {\n${lines.join("\n")}\n}`;
    void navigator.clipboard.writeText(block);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const theme = document.documentElement.dataset["theme"] ?? "light";
  const skin = document.documentElement.dataset["skin"] ?? "brutal";

  return (
    <>
      <span ref={probeRef} aria-hidden style={{ display: "none" }} />
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Theme token editor"
          style={btnFloat}
        >
          <Palette size={20} />
        </button>
      )}
      {open && (
        <div style={panel} role="dialog" aria-label="theme token editor">
          <header style={head}>
            <strong style={{ fontFamily: "var(--font-display)", fontSize: 14 }}>Tokens</strong>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.7 }}>
              {skin} · {theme}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button type="button" onClick={exportCss} title="Copy overrides as CSS" style={iconBtn}>
                {copied ? <span style={{ fontSize: 11 }}>copied</span> : <Copy size={16} />}
              </button>
              <button type="button" onClick={reset} title="Reset overrides" style={iconBtn}>
                <RotateCcw size={16} />
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Close" style={iconBtn}>
                <X size={16} />
              </button>
            </div>
          </header>
          <div style={body}>
            <div style={note}>
              Editing <b>{skin} · {theme}</b>. Overrides clear when you switch theme/skin — export first.
            </div>
            {TOKEN_GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: 10 }}>
                <div style={groupLabel}>{group.label}</div>
                {group.tokens.map((name) => {
                  const value = values[name] ?? "";
                  const hex = rgbToHex(value) ?? (/^#[0-9a-f]{6}$/i.test(value) ? value : null);
                  return (
                    <label key={name} style={row}>
                      <input
                        type="color"
                        value={hex ?? "#000000"}
                        disabled={!hex && !/^#/.test(value)}
                        onChange={(e) => apply(name, e.target.value)}
                        style={swatch}
                      />
                      <span style={tokenName}>{name.replace(/^--/, "")}</span>
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => apply(name, e.target.value)}
                        spellCheck={false}
                        style={{ ...textInput, fontWeight: dirty.has(name) ? 700 : 400 }}
                      />
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const btnFloat: React.CSSProperties = {
  position: "fixed", left: 12, bottom: 12, zIndex: 2147483000,
  width: 40, height: 40, borderRadius: 999, display: "grid", placeItems: "center",
  background: "var(--paper-2)", color: "var(--ink)", border: "var(--line-2)", boxShadow: "var(--shadow-sm)", cursor: "pointer",
};
const panel: React.CSSProperties = {
  position: "fixed", left: 12, bottom: 12, zIndex: 2147483000,
  width: 320, maxHeight: "80vh", display: "flex", flexDirection: "column",
  background: "var(--paper)", color: "var(--ink)", border: "var(--line)", boxShadow: "var(--shadow-lg)", borderRadius: "var(--radius-lg)",
};
const head: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "var(--line-2)",
};
const body: React.CSSProperties = { overflowY: "auto", padding: "10px 12px" };
const note: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 9, lineHeight: 1.4, opacity: 0.6, marginBottom: 10,
};
const groupLabel: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
  opacity: 0.6, margin: "0 0 4px",
};
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "2px 0" };
const swatch: React.CSSProperties = { width: 24, height: 24, padding: 0, border: "var(--line-2)", borderRadius: 4, background: "none", cursor: "pointer", flex: "none" };
const tokenName: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, width: 86, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const textInput: React.CSSProperties = {
  flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 10, padding: "3px 6px",
  background: "var(--paper-2)", color: "var(--ink)", border: "var(--line-2)", borderRadius: 4,
};
const iconBtn: React.CSSProperties = {
  display: "grid", placeItems: "center", width: 26, height: 26, background: "var(--paper-2)",
  color: "var(--ink)", border: "var(--line-2)", borderRadius: 4, cursor: "pointer",
};
