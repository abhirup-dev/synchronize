import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

export type FontOption = {
  label: string;
  value: string;
  fallback: string;
};

export type FontPreviewArgs = {
  bodyFont: string;
  headingFont: string;
  displayFont: string;
  codeFont: string;
  width: number;
};

export const UI_FONTS: FontOption[] = [
  { label: "Space Grotesk", value: "Space Grotesk", fallback: "\"Helvetica Neue\", sans-serif" },
  { label: "Geist", value: "Geist", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene A", value: "Styrene A", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene B", value: "Styrene B", fallback: "Inter, system-ui, sans-serif" },
  { label: "Inter", value: "Inter", fallback: "system-ui, sans-serif" },
  { label: "SF Pro Text", value: "SF Pro Text", fallback: "-apple-system, BlinkMacSystemFont, sans-serif" },
  { label: "Avenir Next", value: "Avenir Next", fallback: "\"Helvetica Neue\", sans-serif" },
  { label: "Atkinson Hyperlegible", value: "Atkinson Hyperlegible", fallback: "system-ui, sans-serif" },
  { label: "IBM Plex Sans", value: "IBM Plex Sans", fallback: "system-ui, sans-serif" },
  { label: "JetBrains Mono", value: "JetBrains Mono", fallback: "ui-monospace, monospace" },
  { label: "Helvetica Neue", value: "Helvetica Neue", fallback: "Arial, sans-serif" },
  { label: "Arial", value: "Arial", fallback: "sans-serif" },
];

export const DISPLAY_FONTS: FontOption[] = [
  { label: "Archivo Black", value: "Archivo Black", fallback: "sans-serif" },
  { label: "Space Grotesk", value: "Space Grotesk", fallback: "\"Helvetica Neue\", sans-serif" },
  { label: "Geist", value: "Geist", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene A", value: "Styrene A", fallback: "Inter, system-ui, sans-serif" },
  { label: "Styrene B", value: "Styrene B", fallback: "Inter, system-ui, sans-serif" },
  { label: "Inter", value: "Inter", fallback: "system-ui, sans-serif" },
  { label: "Avenir Next", value: "Avenir Next", fallback: "\"Helvetica Neue\", sans-serif" },
  { label: "SF Pro Display", value: "SF Pro Display", fallback: "-apple-system, BlinkMacSystemFont, sans-serif" },
  { label: "JetBrains Mono", value: "JetBrains Mono", fallback: "ui-monospace, monospace" },
  { label: "Helvetica Neue", value: "Helvetica Neue", fallback: "Arial, sans-serif" },
];

export const MONO_FONTS: FontOption[] = [
  { label: "JetBrains Mono", value: "JetBrains Mono", fallback: "ui-monospace, monospace" },
  { label: "Geist Mono", value: "Geist Mono", fallback: "ui-monospace, monospace" },
  { label: "SF Mono", value: "SF Mono", fallback: "ui-monospace, monospace" },
  { label: "IBM Plex Mono", value: "IBM Plex Mono", fallback: "ui-monospace, monospace" },
  { label: "Menlo", value: "Menlo", fallback: "ui-monospace, monospace" },
  { label: "Monaco", value: "Monaco", fallback: "ui-monospace, monospace" },
];

export const typographyArgTypes = {
  bodyFont: {
    control: { type: "select" as const },
    options: UI_FONTS.map((font) => font.value),
  },
  displayFont: {
    control: { type: "select" as const },
    options: DISPLAY_FONTS.map((font) => font.value),
  },
  codeFont: {
    control: { type: "select" as const },
    options: MONO_FONTS.map((font) => font.value),
  },
  headingFont: {
    control: { type: "select" as const },
    options: UI_FONTS.map((font) => font.value),
  },
  width: {
    control: { type: "range" as const, min: 360, max: 860, step: 20 },
  },
};

export function fontVars(bodyFont: string, headingFont: string, displayFont: string, codeFont: string): CSSProperties {
  return {
    "--font-ui": fontStack(bodyFont, UI_FONTS),
    "--font-heading": fontStack(headingFont, UI_FONTS),
    "--font-display": fontStack(displayFont, DISPLAY_FONTS),
    "--font-mono": fontStack(codeFont, MONO_FONTS),
  } as CSSProperties;
}

export function FontSwitchChrome({
  bodyFont,
  headingFont,
  displayFont,
  codeFont,
  width,
  maxWidth = 860,
  children,
}: FontPreviewArgs & {
  maxWidth?: number;
  children(selection: FontPreviewArgs): ReactNode;
}) {
  const [selectedBodyFont, setSelectedBodyFont] = useState(bodyFont);
  const [selectedHeadingFont, setSelectedHeadingFont] = useState(headingFont);
  const [selectedDisplayFont, setSelectedDisplayFont] = useState(displayFont);
  const [selectedCodeFont, setSelectedCodeFont] = useState(codeFont);

  useEffect(() => setSelectedBodyFont(bodyFont), [bodyFont]);
  useEffect(() => setSelectedHeadingFont(headingFont), [headingFont]);
  useEffect(() => setSelectedDisplayFont(displayFont), [displayFont]);
  useEffect(() => setSelectedCodeFont(codeFont), [codeFont]);

  return (
    <div
      style={{
        ...fontVars(selectedBodyFont, selectedHeadingFont, selectedDisplayFont, selectedCodeFont),
        display: "grid",
        gap: 14,
        maxWidth,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <FontSelect label="body" options={UI_FONTS} value={selectedBodyFont} onChange={setSelectedBodyFont} />
        <FontSelect label="heading" options={UI_FONTS} value={selectedHeadingFont} onChange={setSelectedHeadingFont} />
        <FontSelect label="display" options={DISPLAY_FONTS} value={selectedDisplayFont} onChange={setSelectedDisplayFont} />
        <FontSelect label="code" options={MONO_FONTS} value={selectedCodeFont} onChange={setSelectedCodeFont} />
        <AvailabilityBadge font={selectedBodyFont} />
      </div>
      {children({
        bodyFont: selectedBodyFont,
        headingFont: selectedHeadingFont,
        displayFont: selectedDisplayFont,
        codeFont: selectedCodeFont,
        width,
      })}
    </div>
  );
}

function FontSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FontOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: 8,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-10-5)",
        color: "var(--ink-soft)",
      }}
    >
      <span>{label}</span>
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
          padding: "5px 8px",
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
  const available = fontAvailable(font);
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

function fontAvailable(fontName: string): boolean | "unknown" {
  if (typeof document === "undefined" || !document.fonts?.check) return "unknown";
  if (fontName === "SF Pro Text" || fontName === "SF Pro Display") return true;
  return document.fonts.check(`14px "${fontName}"`);
}
