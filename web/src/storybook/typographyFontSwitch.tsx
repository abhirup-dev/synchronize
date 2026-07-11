import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Clipboard, Snowflake } from "lucide-react";

export type FontOption = {
  label: string;
  value: string;
  fallback: string;
  /** Native weights explicitly loaded/known. Undefined means unverified. */
  weights?: number[];
};

export type FontPreviewArgs = {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  avatarFont: string;
  codeFont: string;
  width: number;
};

export const UI_FONTS: FontOption[] = [
  { label: "Space Grotesk", value: "Space Grotesk", fallback: "\"Helvetica Neue\", sans-serif", weights: [400, 500, 600, 700] },
  { label: "Geist", value: "Geist", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene A", value: "Styrene A", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene B", value: "Styrene B", fallback: "Inter, system-ui, sans-serif" },
  { label: "Inter", value: "Inter", fallback: "system-ui, sans-serif" },
  { label: "SF Pro Text", value: "SF Pro Text", fallback: "-apple-system, BlinkMacSystemFont, sans-serif" },
  { label: "Avenir Next", value: "Avenir Next", fallback: "\"Helvetica Neue\", sans-serif" },
  { label: "Atkinson Hyperlegible", value: "Atkinson Hyperlegible", fallback: "system-ui, sans-serif" },
  { label: "IBM Plex Sans", value: "IBM Plex Sans", fallback: "system-ui, sans-serif" },
  { label: "JetBrains Mono", value: "JetBrains Mono", fallback: "ui-monospace, monospace", weights: [400, 500, 700] },
  { label: "Helvetica Neue", value: "Helvetica Neue", fallback: "Arial, sans-serif" },
  { label: "Arial", value: "Arial", fallback: "sans-serif" },
];

export const DISPLAY_FONTS: FontOption[] = [
  { label: "Archivo Black", value: "Archivo Black", fallback: "sans-serif", weights: [400] },
  { label: "Space Grotesk", value: "Space Grotesk", fallback: "\"Helvetica Neue\", sans-serif", weights: [400, 500, 600, 700] },
  { label: "Geist", value: "Geist", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene A", value: "Styrene A", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene B", value: "Styrene B", fallback: "Inter, system-ui, sans-serif" },
  { label: "Inter", value: "Inter", fallback: "system-ui, sans-serif" },
  { label: "Avenir Next", value: "Avenir Next", fallback: "\"Helvetica Neue\", sans-serif" },
  { label: "SF Pro Display", value: "SF Pro Display", fallback: "-apple-system, BlinkMacSystemFont, sans-serif" },
  { label: "JetBrains Mono", value: "JetBrains Mono", fallback: "ui-monospace, monospace", weights: [400, 500, 700] },
  { label: "Helvetica Neue", value: "Helvetica Neue", fallback: "Arial, sans-serif" },
];

export const MONO_FONTS: FontOption[] = [
  { label: "JetBrains Mono", value: "JetBrains Mono", fallback: "ui-monospace, monospace", weights: [400, 500, 700] },
  { label: "Geist Mono", value: "Geist Mono", fallback: "ui-monospace, monospace" },
  { label: "SF Mono", value: "SF Mono", fallback: "ui-monospace, monospace" },
  { label: "IBM Plex Mono", value: "IBM Plex Mono", fallback: "ui-monospace, monospace" },
  { label: "Menlo", value: "Menlo", fallback: "ui-monospace, monospace" },
  { label: "Monaco", value: "Monaco", fallback: "ui-monospace, monospace" },
];

export const ALL_FONTS: FontOption[] = [...UI_FONTS, ...DISPLAY_FONTS, ...MONO_FONTS].filter(
  (font, index, fonts) => fonts.findIndex((candidate) => candidate.value === font.value) === index,
);

const fontLoadCache = new Map<string, Promise<void>>();
const FROZEN_TYPOGRAPHY_KEY = "synchronize.storybook.typography.frozen.v1";

export const typographyArgTypes = {
  bodyFont: {
    control: { type: "select" as const },
    options: ALL_FONTS.map((font) => font.value),
  },
  displayFont: {
    control: { type: "select" as const },
    options: ALL_FONTS.map((font) => font.value),
  },
  avatarFont: {
    control: { type: "select" as const },
    options: ALL_FONTS.map((font) => font.value),
  },
  codeFont: {
    control: { type: "select" as const },
    options: ALL_FONTS.map((font) => font.value),
  },
  headingFont: {
    control: { type: "select" as const },
    options: ALL_FONTS.map((font) => font.value),
  },
  width: {
    control: { type: "range" as const, min: 360, max: 860, step: 20 },
  },
};

export function fontVars(bodyFont: string, headingFont: string, displayFont: string, avatarFont: string, codeFont: string): CSSProperties {
  const displayStack = fontStack(displayFont, ALL_FONTS);
  const headingStack = fontStack(headingFont, ALL_FONTS);
  return {
    "--font-ui": fontStack(bodyFont, ALL_FONTS),
    "--font-control": headingStack,
    "--font-heading": headingStack,
    "--font-display": displayStack,
    "--font-display-heading": displayStack,
    "--font-display-medium": displayStack,
    "--font-display-small": displayStack,
    "--font-display-button": headingStack,
    "--font-avatar": fontStack(avatarFont, ALL_FONTS),
    "--font-mono": fontStack(codeFont, ALL_FONTS),
  } as CSSProperties;
}

export function FontSwitchChrome({
  bodyFont,
  headingFont,
  displayFont,
  avatarFont,
  codeFont,
  width,
  maxWidth = 860,
  sourceStoryId,
  children,
}: FontPreviewArgs & {
  maxWidth?: number;
  sourceStoryId?: string;
  children(selection: FontPreviewArgs): ReactNode;
}) {
  const configurationSource = typographyStorySource(sourceStoryId);
  const [initialFrozenPreset] = useState(() => readFrozenTypographyPreset());
  const [isFrozen, setIsFrozen] = useState(initialFrozenPreset != null);
  const [frozenSource, setFrozenSource] = useState(initialFrozenPreset?.source ?? null);
  const [selectedBodyFont, setSelectedBodyFont] = useState(initialFrozenPreset?.roles.body.fontFamily ?? bodyFont);
  const [selectedHeadingFont, setSelectedHeadingFont] = useState(initialFrozenPreset?.roles.heading.fontFamily ?? headingFont);
  const [selectedDisplayFont, setSelectedDisplayFont] = useState(initialFrozenPreset?.roles.display.fontFamily ?? displayFont);
  const [selectedAvatarFont, setSelectedAvatarFont] = useState(initialFrozenPreset?.roles.avatar.fontFamily ?? avatarFont);
  const [selectedCodeFont, setSelectedCodeFont] = useState(initialFrozenPreset?.roles.code.fontFamily ?? codeFont);
  const [roleTuning, setRoleTuning] = useState<Record<FontRole, FontTuning>>(() => initialFrozenPreset ? tuningFromPreset(initialFrozenPreset) : defaultRoleTuning());
  const [copyStatus, setCopyStatus] = useState<{ kind: "full" | "changed"; status: "copied" | "failed" } | null>(null);
  useEffect(() => { if (!isFrozen) setSelectedBodyFont(bodyFont); }, [bodyFont, isFrozen]);
  useEffect(() => { if (!isFrozen) setSelectedHeadingFont(headingFont); }, [headingFont, isFrozen]);
  useEffect(() => { if (!isFrozen) setSelectedDisplayFont(displayFont); }, [displayFont, isFrozen]);
  useEffect(() => { if (!isFrozen) setSelectedAvatarFont(avatarFont); }, [avatarFont, isFrozen]);
  useEffect(() => { if (!isFrozen) setSelectedCodeFont(codeFont); }, [codeFont, isFrozen]);
  useEffect(() => { if (!isFrozen) setRoleTuning(defaultRoleTuning()); }, [sourceStoryId, isFrozen]);
  useEffect(() => {
    // These three faces are declared by preview-head.html and web/index.html.
    // Prewarm every native weight in parallel so subsequent picker changes can
    // commit without a fallback-font flash.
    void Promise.all(["Space Grotesk", "Archivo Black", "JetBrains Mono"].map(preloadFont));
  }, []);

  const tuneRole = (role: FontRole, patch: Partial<FontTuning>) => {
    setRoleTuning((current) => ({ ...current, [role]: { ...current[role], ...patch } }));
  };
  const currentRoles = typographyRoles(
    { body: selectedBodyFont, heading: selectedHeadingFont, display: selectedDisplayFont, avatar: selectedAvatarFont, code: selectedCodeFont },
    roleTuning,
  );
  const configuredRoles = typographyRoles(
    { body: bodyFont, heading: headingFont, display: displayFont, avatar: avatarFont, code: codeFont },
    defaultRoleTuning(),
  );
  const changedRoles = changedTypographyRoles(configuredRoles, currentRoles);
  const hasChanges = Object.keys(changedRoles).length > 0;

  useEffect(() => {
    if (!isFrozen || !frozenSource) return;
    writeFrozenTypographyPreset({ version: 1, source: frozenSource, roles: currentRoles });
  }, [isFrozen, frozenSource, selectedBodyFont, selectedHeadingFont, selectedDisplayFont, selectedAvatarFont, selectedCodeFont, roleTuning]);

  const configurationEnvelope = () => {
    const root = document.documentElement;
    return {
      version: 6,
      source: configurationSource,
      theme: root.dataset.theme ?? "light",
      skin: root.dataset.skin ?? "brutal",
      width,
      semanticTiers: {
        display: { heading: 1, medium: 0.65, small: 0.5 },
        button: { familyRole: "heading", ratio: 0.75, weight: 400, syntheticBold: false },
      },
    };
  };
  const copyConfiguration = async (kind: "full" | "changed") => {
    const configurationText = JSON.stringify(kind === "full"
      ? { ...configurationEnvelope(), roles: currentRoles }
      : { ...configurationEnvelope(), changes: { roles: changedRoles } }, null, 2);
    try {
      await navigator.clipboard.writeText(configurationText);
      setCopyStatus({ kind, status: "copied" });
      window.setTimeout(() => setCopyStatus(null), 1600);
    } catch {
      setCopyStatus({ kind, status: "failed" });
    }
  };
  const toggleFreeze = () => {
    if (isFrozen) {
      removeFrozenTypographyPreset();
      setIsFrozen(false);
      setFrozenSource(null);
      return;
    }
    setFrozenSource(configurationSource);
    setIsFrozen(true);
  };

  return (
    <div
      style={{
        ...fontVars(selectedBodyFont, selectedHeadingFont, selectedDisplayFont, selectedAvatarFont, selectedCodeFont),
        ...fontTuningVars(roleTuning),
        display: "grid",
        gap: 14,
        maxWidth,
      }}
      className="typography-font-preview"
    >
      <style>{`
        .typography-font-preview { font-size-adjust: var(--font-ui-size-adjust); font-weight: var(--font-ui-weight); }
        .typography-font-preview :where(.font-ui, .markdown, .bubble, input, textarea) { font-size-adjust: var(--font-ui-size-adjust); font-weight: var(--font-ui-weight); }
        .typography-font-preview :where(h1, h2, h3, h4, h5, h6, .font-heading) { font-size-adjust: var(--font-heading-size-adjust); font-weight: var(--font-heading-weight); }
        .typography-font-preview :where(.font-display, .author-name, .author-chip.xs, .act-room-name, .act-room-await) { font-size-adjust: var(--font-display-size-adjust); font-weight: var(--font-display-weight); }
        .typography-font-preview :where(.identity-icon, .thread-badge-av) { font-size-adjust: var(--font-avatar-size-adjust); font-weight: var(--font-avatar-weight); }
        .typography-font-preview :where(code, pre, .font-mono) { font-size-adjust: var(--font-mono-size-adjust); font-weight: var(--font-mono-weight); }
      `}</style>
      <div
        data-testid="font-control-grid"
        style={{
          alignItems: "start",
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          minWidth: 0,
          width: "100%",
        }}
      >
        <FontRoleControl role="body" options={ALL_FONTS} value={selectedBodyFont} onChange={setSelectedBodyFont} tuning={roleTuning.body} onTune={(patch) => tuneRole("body", patch)} />
        <FontRoleControl role="heading" options={ALL_FONTS} value={selectedHeadingFont} onChange={setSelectedHeadingFont} tuning={roleTuning.heading} onTune={(patch) => tuneRole("heading", patch)} />
        <FontRoleControl role="display" options={ALL_FONTS} value={selectedDisplayFont} onChange={setSelectedDisplayFont} tuning={roleTuning.display} onTune={(patch) => tuneRole("display", patch)} />
        <FontRoleControl role="avatar" options={ALL_FONTS} value={selectedAvatarFont} onChange={setSelectedAvatarFont} tuning={roleTuning.avatar} onTune={(patch) => tuneRole("avatar", patch)} />
        <FontRoleControl role="code" options={ALL_FONTS} value={selectedCodeFont} onChange={setSelectedCodeFont} tuning={roleTuning.code} onTune={(patch) => tuneRole("code", patch)} />
      </div>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
        <AvailabilityBadge font={selectedBodyFont} />
        <button
          type="button"
          onClick={() => void copyConfiguration("full")}
          aria-label="Copy typography configuration to clipboard"
          data-config-source={configurationSource.storyId}
          title="Copy typography configuration to clipboard"
          style={{ alignItems: "center", background: "var(--control-bg-solid, var(--paper-2))", border: "var(--control-border, var(--line-xs))", borderRadius: "var(--control-radius, var(--radius-sm))", color: "var(--control-fg, var(--ink))", cursor: "pointer", display: "inline-flex", fontFamily: "var(--font-mono)", fontSize: "var(--text-10)", fontWeight: 600, gap: 7, justifyContent: "center", minHeight: 38, minWidth: 150, padding: "7px 12px" }}
        >
          <Clipboard aria-hidden="true" size={17} strokeWidth={1.8} />
          {copyStatus?.kind === "full" ? copyStatus.status === "copied" ? "Copied" : "Copy failed" : "Copy configuration"}
        </button>
        {hasChanges ? (
          <button
            type="button"
            data-copy-changed=""
            onClick={() => void copyConfiguration("changed")}
            aria-label="Copy changed typography configuration to clipboard"
            title="Copy only values that differ from this story's configured defaults"
            style={{ alignItems: "center", background: "var(--control-bg-solid, var(--paper-2))", border: "var(--control-border, var(--line-xs))", borderRadius: "var(--control-radius, var(--radius-sm))", color: "var(--control-fg, var(--ink))", cursor: "pointer", display: "inline-flex", gap: 7, justifyContent: "center", minHeight: 38, minWidth: 190, padding: "7px 12px" }}
          >
            <Clipboard aria-hidden="true" size={17} strokeWidth={1.8} />
            {copyStatus?.kind === "changed" ? copyStatus.status === "copied" ? "Changes copied" : "Copy failed" : "Copy changed configuration"}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={isFrozen}
          data-freeze-configuration=""
          onClick={toggleFreeze}
          title={isFrozen ? `Unfreeze typography preset from ${frozenSource?.storyName ?? "another story"}` : "Reuse this typography configuration across every typography story"}
          style={{ alignItems: "center", background: isFrozen ? "var(--control-bg-active, var(--paper-3))" : "var(--control-bg-solid, var(--paper-2))", border: "var(--control-border, var(--line-xs))", borderRadius: "var(--control-radius, var(--radius-sm))", color: "var(--control-fg, var(--ink))", cursor: "pointer", display: "inline-flex", gap: 7, justifyContent: "center", minHeight: 38, minWidth: 165, padding: "7px 12px" }}
        >
          <Snowflake aria-hidden="true" size={17} strokeWidth={1.8} />
          {isFrozen ? "Unfreeze configuration" : "Freeze configuration"}
        </button>
      </div>
      {children({
        bodyFont: selectedBodyFont,
        headingFont: selectedHeadingFont,
        displayFont: selectedDisplayFont,
        avatarFont: selectedAvatarFont,
        codeFont: selectedCodeFont,
        width,
      })}
    </div>
  );
}

function typographyStorySource(explicitStoryId?: string) {
  const url = new URL(window.location.href);
  const storyId = explicitStoryId ?? url.searchParams.get("id") ?? "unknown-story";
  const storyName = storyId.split("--").at(-1)?.split("-").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ") ?? storyId;
  return {
    storyId,
    storyName,
    storyPath: storyId === "unknown-story" ? null : `/?path=/story/${storyId}`,
    previewUrl: url.href,
  };
}

type FontRole = "body" | "heading" | "display" | "avatar" | "code";
type FontTuning = { size: number; weight: number };
type TypographyRoleValue = FontTuning & { fontFamily: string };
type TypographyRoles = Record<FontRole, TypographyRoleValue>;
type TypographyStorySource = ReturnType<typeof typographyStorySource>;
type FrozenTypographyPreset = { version: 1; source: TypographyStorySource; roles: TypographyRoles };
const FONT_ROLES: FontRole[] = ["body", "heading", "display", "avatar", "code"];

function typographyRoles(fonts: Record<FontRole, string>, tuning: Record<FontRole, FontTuning>): TypographyRoles {
  return Object.fromEntries(FONT_ROLES.map((role) => [role, { fontFamily: fonts[role], ...tuning[role] }])) as TypographyRoles;
}

function changedTypographyRoles(configured: TypographyRoles, current: TypographyRoles): Partial<Record<FontRole, Partial<TypographyRoleValue>>> {
  return Object.fromEntries(FONT_ROLES.flatMap((role) => {
    const changes = Object.fromEntries(((["fontFamily", "size", "weight"] as const)).flatMap((key) =>
      configured[role][key] === current[role][key] ? [] : [[key, current[role][key]]],
    ));
    return Object.keys(changes).length ? [[role, changes]] : [];
  })) as Partial<Record<FontRole, Partial<TypographyRoleValue>>>;
}

function tuningFromPreset(preset: FrozenTypographyPreset): Record<FontRole, FontTuning> {
  return Object.fromEntries(FONT_ROLES.map((role) => [role, { size: preset.roles[role].size, weight: preset.roles[role].weight }])) as Record<FontRole, FontTuning>;
}

function readFrozenTypographyPreset(): FrozenTypographyPreset | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(FROZEN_TYPOGRAPHY_KEY) ?? "null") as FrozenTypographyPreset | null;
    return value?.version === 1 && FONT_ROLES.every((role) => value.roles?.[role]?.fontFamily) ? value : null;
  } catch {
    return null;
  }
}

function writeFrozenTypographyPreset(preset: FrozenTypographyPreset) {
  try { window.localStorage.setItem(FROZEN_TYPOGRAPHY_KEY, JSON.stringify(preset)); } catch { /* Storage may be unavailable in hardened previews. */ }
}

function removeFrozenTypographyPreset() {
  try { window.localStorage.removeItem(FROZEN_TYPOGRAPHY_KEY); } catch { /* Storage may be unavailable in hardened previews. */ }
}

function defaultRoleTuning(): Record<FontRole, FontTuning> {
  return {
    body: { size: 1, weight: 400 },
    heading: { size: 1, weight: 600 },
    display: { size: 1.1, weight: 400 },
    avatar: { size: 1.35, weight: 400 },
    code: { size: 1, weight: 400 },
  };
}

function fontTuningVars(tuning: Record<FontRole, FontTuning>): CSSProperties {
  return {
    "--font-ui-size-adjust": `calc(0.52 * ${tuning.body.size})`,
    "--font-ui-size-scale": tuning.body.size,
    "--font-ui-weight": tuning.body.weight,
    "--font-heading-size-adjust": `calc(0.52 * ${tuning.heading.size})`,
    "--font-heading-size-scale": tuning.heading.size,
    "--font-heading-weight": tuning.heading.weight,
    "--font-display-size-adjust": `calc(0.52 * ${tuning.display.size})`,
    "--font-display-size-scale": tuning.display.size,
    "--font-display-heading-size": `calc(var(--text-14) * ${tuning.display.size})`,
    "--font-display-medium-size": `calc(var(--text-14) * ${tuning.display.size} * 0.65)`,
    "--font-display-small-size": `calc(var(--text-14) * ${tuning.display.size} * 0.5)`,
    "--font-display-button-size": `calc(var(--text-14) * ${tuning.display.size} * 0.75)`,
    "--font-display-weight": tuning.display.weight,
    "--font-display-heading-weight": tuning.display.weight,
    "--font-display-medium-weight": tuning.display.weight,
    "--font-display-small-weight": tuning.display.weight,
    "--font-display-button-weight": 400,
    "--font-avatar-size-adjust": `calc(0.52 * ${tuning.avatar.size})`,
    "--font-avatar-size-scale": tuning.avatar.size,
    "--font-avatar-weight": tuning.avatar.weight,
    "--font-mono-size-adjust": `calc(0.52 * ${tuning.code.size})`,
    "--font-mono-size-scale": tuning.code.size,
    "--font-mono-weight": tuning.code.weight,
  } as CSSProperties;
}

function FontRoleControl({
  role,
  options,
  value,
  onChange,
  tuning,
  onTune,
}: {
  role: FontRole;
  options: FontOption[];
  value: string;
  onChange: (value: string) => void;
  tuning: FontTuning;
  onTune: (patch: Partial<FontTuning>) => void;
}) {
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  const selectionRun = useRef(0);
  const option = ALL_FONTS.find((candidate) => candidate.value === value);
  const available = useFontAvailability(value);
  const nativeWeights = option?.weights;
  const sizeDisabled = available !== true;
  const capability = available !== true
    ? available === false ? "font unavailable · using fallback" : "font capability unknown"
    : nativeWeights
      ? nativeWeights.length > 1 ? `native weights ${nativeWeights.join(" · ")}` : `native weight ${nativeWeights[0]} only`
      : "native weight metadata unavailable";

  const selectFont = async (font: string) => {
    const run = ++selectionRun.current;
    setLoadingFont(font);
    await preloadFont(font);
    if (run !== selectionRun.current) return;
    onChange(font);
    const weights = ALL_FONTS.find((candidate) => candidate.value === font)?.weights;
    if (weights?.length) {
      const nearest = weights.reduce((best, candidate) => Math.abs(candidate - tuning.weight) < Math.abs(best - tuning.weight) ? candidate : best);
      onTune({ weight: nearest });
    }
    setLoadingFont(null);
  };

  return (
    <div style={{ background: "var(--paper-2)", border: "var(--line-xs)", borderRadius: "var(--radius-md)", display: "grid", gap: 5, minWidth: 0, overflow: "hidden", padding: 8 }}>
      <FontSelect label={role} options={options} value={value} loading={loadingFont != null} onChange={(font) => void selectFont(font)} />
      <FontSlider label="size" value={tuning.size} min={0.75} max={1.5} step={0.05} disabled={sizeDisabled} disabledReason={capability} onChange={(size) => onTune({ size })} />
      <FontWeightPicker {...(nativeWeights ? { weights: nativeWeights } : {})} value={tuning.weight} disabled={available !== true} disabledReason={capability} onChange={(weight) => onTune({ weight })} />
      <div aria-live="polite" style={{ color: available === false ? "var(--destructive)" : "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: "var(--text-8-5)", lineHeight: 1.25, minHeight: 11 }}>
        {capability}
      </div>
      <div
        aria-label={`${role} font preview`}
        style={{
          alignItems: "baseline",
          background: "var(--paper)",
          border: "var(--line-xxs)",
          borderRadius: "var(--radius-sm)",
          color: "var(--ink)",
          display: "grid",
          fontFamily: fontStack(value, ALL_FONTS),
          fontSize: 18 * tuning.size,
          fontSizeAdjust: 0.52,
          fontWeight: tuning.weight,
          gap: 6,
          gridTemplateColumns: "auto auto minmax(0, 1fr)",
          lineHeight: 1.2,
          marginTop: 2,
          minHeight: 34,
          overflow: "hidden",
          padding: "5px 7px",
          whiteSpace: "nowrap",
        }}
      >
        <span>Ag</span><span>0123</span><span style={{ fontSize: 11, minWidth: 0, opacity: 0.62, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      </div>
    </div>
  );
}

function FontWeightPicker({ weights, value, disabled, disabledReason, onChange }: { weights?: number[]; value: number; disabled: boolean; disabledReason?: string; onChange: (weight: number) => void }) {
  const options = weights?.length ? weights : [];
  const listId = useId();
  const selectedIndex = Math.max(0, options.indexOf(value));
  const locked = disabled || options.length < 2;
  return (
    <div data-font-weight-picker="" style={{ alignItems: "start", display: "grid", gap: 5, gridTemplateColumns: "42px minmax(0, 1fr)", minWidth: 0, opacity: locked ? 0.55 : 1 }}>
      <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontSize: "var(--text-9)" }}>weight</span>
      <div title={locked ? disabledReason : undefined} style={{ display: "grid", gap: 1, minWidth: 0 }}>
        <input
          aria-label={`native font weight ${options[selectedIndex] ?? "unknown"}`}
          type="range"
          min={0}
          max={Math.max(options.length - 1, 0)}
          step={1}
          value={selectedIndex}
          list={listId}
          disabled={locked}
          aria-disabled={locked}
          onChange={(event) => onChange(options[Number(event.currentTarget.value)] ?? value)}
          style={{ minWidth: 0, width: "100%" }}
        />
        <datalist id={listId}>
          {options.map((weight, index) => <option key={weight} value={index} label={String(weight)} />)}
        </datalist>
        <div aria-hidden style={{ display: "grid", fontFamily: "var(--font-mono)", fontSize: "var(--text-8)", gridTemplateColumns: `repeat(${Math.max(options.length, 1)}, minmax(0, 1fr))`, textAlign: "center" }}>
          {options.length ? options.map((weight) => <span data-weight-option="" key={weight}>{weight}</span>) : <span data-weight-option="">unknown</span>}
        </div>
      </div>
    </div>
  );
}

function FontSlider({ label, value, min, max, step, disabled = false, disabledReason, onChange }: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; disabledReason?: string; onChange: (value: number) => void }) {
  return (
    <label title={disabled ? disabledReason : undefined} style={{ alignItems: "center", color: "var(--ink-soft)", display: "grid", fontFamily: "var(--font-mono)", fontSize: "var(--text-9)", gap: 5, gridTemplateColumns: "42px minmax(0, 1fr) 34px", minWidth: 0, opacity: disabled ? 0.45 : 1 }}>
      <span>{label}</span>
      <input aria-label={`${label} ${value}`} type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-disabled={disabled} onChange={(event) => onChange(Number(event.currentTarget.value))} style={{ minWidth: 0, width: "100%" }} />
      <output style={{ color: "var(--ink)", textAlign: "right" }}>{value}</output>
    </label>
  );
}

function FontSelect({
  label,
  options,
  value,
  loading = false,
  onChange,
}: {
  label: string;
  options: FontOption[];
  value: string;
  loading?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label
      style={{
        alignItems: "center",
        display: "grid",
        gap: 8,
        gridTemplateColumns: "44px minmax(0, 1fr)",
        minWidth: 0,
        width: "100%",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-10-5)",
        color: "var(--ink-soft)",
      }}
    >
      <span>{loading ? `${label}…` : label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          background: "var(--paper-2)",
          border: "var(--line-xs)",
          borderRadius: "var(--radius-sm)",
          color: "var(--ink)",
          font: "inherit",
          minHeight: 30,
          minWidth: 0,
          padding: "5px 8px",
          width: "100%",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AvailabilityBadge({ font }: { font: string }) {
  const available = useFontAvailability(font);
  const text = available === "unknown" ? "unknown" : available ? "available" : "fallback";
  return (
    <span
      style={{
        border: "var(--line-xxs)",
        borderRadius: "var(--radius-xs)",
        color: available ? "var(--ink)" : "var(--ink-faint)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-10)",
        padding: "2px 5px",
      }}
    >
      {text}
    </span>
  );
}

function fontStack(fontName: string, options: FontOption[]): string {
  const option = options.find((candidate) => candidate.value === fontName);
  const fallback = option?.fallback ?? "system-ui, sans-serif";
  return `"${fontName}", ${fallback}`;
}

function useFontAvailability(fontName: string): boolean | "unknown" {
  const [available, setAvailable] = useState<boolean | "unknown">("unknown");

  useEffect(() => {
    let cancelled = false;
    setAvailable("unknown");
    const detect = async () => {
      if (typeof document === "undefined" || !document.fonts) return "unknown" as const;
      try {
        await preloadFont(fontName);
      } catch {
        // Metric detection below still distinguishes a locally installed face
        // from its fallback when a remote font request fails.
      }
      return fontMetricsDifferFromFallback(fontName);
    };
    void detect().then((result) => {
      if (!cancelled) setAvailable(result);
    });
    return () => { cancelled = true; };
  }, [fontName]);

  return available;
}

function preloadFont(fontName: string): Promise<void> {
  const cached = fontLoadCache.get(fontName);
  if (cached) return cached;
  const run = (async () => {
    if (typeof document === "undefined" || !document.fonts) return;
    const weights = ALL_FONTS.find((font) => font.value === fontName)?.weights ?? [400];
    await Promise.all(weights.map((weight) => document.fonts.load(`${weight} 14px "${fontName}"`)));
    await document.fonts.ready;
  })().catch(() => undefined);
  fontLoadCache.set(fontName, run);
  return run;
}

function fontMetricsDifferFromFallback(fontName: string): boolean {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return false;
  const sample = "mmmmmmmmmmlliWW@#0123456789";
  return ["monospace", "serif", "sans-serif"].some((fallback) => {
    context.font = `72px ${fallback}`;
    const fallbackWidth = context.measureText(sample).width;
    context.font = `72px "${fontName}", ${fallback}`;
    return Math.abs(context.measureText(sample).width - fallbackWidth) > 0.1;
  });
}
