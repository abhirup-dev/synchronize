import { useEffect, useState } from "react";
import { chatBackgroundById } from "../data/chatBackgrounds.ts";
import {
  ALL_THEMES,
  DARK_THEMES,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  INITIAL_SKIN,
  INITIAL_THEME,
  LIGHT_THEMES,
  normalizeStoredSkin,
  normalizeStoredTheme,
  type SkinName,
  type ThemeName,
} from "../theme/registry.generated.ts";

// Theme = palette; skin = aesthetic system (border/shadow/radius language),
// orthogonal axes. Both persist to localStorage as plain strings and are
// applied as `data-theme` / `data-skin` on <html> so CSS owns the cascade.
// Canonical dark theme is Kanagawa Wave. Keep
// the DEFAULT_* constants the single source for "which theme does each family
// open in" — App boot, the family toggle, and the Storybook theme matrix all read
// them so the default can never drift per call site.
export { ALL_THEMES, DARK_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, LIGHT_THEMES };
export type { SkinName, ThemeName };

export function themeFamily(theme: ThemeName): "light" | "dark" {
  return LIGHT_THEMES.includes(theme as (typeof LIGHT_THEMES)[number]) ? "light" : "dark";
}

export function cycleTheme(theme: ThemeName): ThemeName {
  const family = themeFamily(theme) === "light" ? LIGHT_THEMES : DARK_THEMES;
  const index = (family as readonly ThemeName[]).indexOf(theme);
  return family[(index + 1) % family.length] as ThemeName;
}

export function toggleThemeFamily(theme: ThemeName): ThemeName {
  return themeFamily(theme) === "light" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}

// Theme capability contract — the theme analogue of shellLayout(mode). Anything
// that needs to BEHAVE differently per theme reads a named trait here instead of
// re-deriving it with `themeFamily(t) === "light"` / `t === "dark"` checks strewn
// across the UI. The theme itself is CARRIED on <html data-theme> (set identically
// by the app's usePersistentTheme effect and by Storybook's preview decorator), so
// CSS and these traits stay in lockstep across both surfaces.
export interface ThemeTraits {
  name: ThemeName;
  family: "light" | "dark";
  isLight: boolean;
  isDark: boolean;
  /** Glyph for the light/dark family toggle (the family you switch TO). */
  toggleGlyph: string;
}

export function themeTraits(theme: ThemeName): ThemeTraits {
  const isLight = themeFamily(theme) === "light";
  return {
    name: theme,
    family: isLight ? "light" : "dark",
    isLight,
    isDark: !isLight,
    toggleGlyph: isLight ? "🌙" : "☀️",
  };
}

// Self-message bubble treatment (glass revamp §2.7.4) — carried on
// <html data-you>. "fill" is the legacy loud accent fill; "tint" is the default
// subtle wash. Styling is skin-owned CSS; this axis only plumbs the attribute.
export const YOU_STYLES = ["tint", "edge", "halo", "fill"] as const;
export type YouStyle = (typeof YOU_STYLES)[number];
export function normalizeStoredYouStyle(value: string | null): YouStyle | null {
  return (YOU_STYLES as readonly string[]).includes(value ?? "") ? (value as YouStyle) : null;
}

// Agent author labelling — "pill" (author chip) or "name" (bold name only).
// Carried on <html data-agentlabel>.
export const AGENT_LABELS = ["pill", "name"] as const;
export type AgentLabel = (typeof AGENT_LABELS)[number];
export function normalizeStoredAgentLabel(value: string | null): AgentLabel | null {
  return (AGENT_LABELS as readonly string[]).includes(value ?? "") ? (value as AgentLabel) : null;
}

export interface PersistentTheme {
  theme: ThemeName;
  setTheme: React.Dispatch<React.SetStateAction<ThemeName>>;
  skin: SkinName;
  setSkin: React.Dispatch<React.SetStateAction<SkinName>>;
  chatBg: string;
  setChatBg: React.Dispatch<React.SetStateAction<string>>;
  youStyle: YouStyle;
  setYouStyle: React.Dispatch<React.SetStateAction<YouStyle>>;
  agentLabel: AgentLabel;
  setAgentLabel: React.Dispatch<React.SetStateAction<AgentLabel>>;
}

/**
 * Owns the persisted display preferences (theme, skin, chat background) and the
 * side effects that apply them to the document. Extracted from App so the Shell
 * is composition, not preference plumbing (sync-imeu.1.20).
 */
export function usePersistentTheme(): PersistentTheme {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem("synchronize.theme");
    return normalizeStoredTheme(stored) ?? INITIAL_THEME;
  });
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("synchronize.theme", theme);
  }, [theme]);

  const [skin, setSkin] = useState<SkinName>(() => normalizeStoredSkin(localStorage.getItem("synchronize.skin")) ?? INITIAL_SKIN);
  useEffect(() => {
    document.documentElement.dataset["skin"] = skin;
    localStorage.setItem("synchronize.skin", skin);
  }, [skin]);

  const [chatBg, setChatBg] = useState<string>(() => localStorage.getItem("synchronize.chatbg") ?? "none");
  useEffect(() => {
    const preset = chatBackgroundById(chatBg);
    const style = document.documentElement.style;
    if (preset.image) {
      style.setProperty("--chat-bg-image", preset.image);
      style.setProperty("--chat-bg-size", preset.size);
      style.setProperty("--chat-bg-repeat", preset.repeat);
    } else {
      style.removeProperty("--chat-bg-image");
      style.removeProperty("--chat-bg-size");
      style.removeProperty("--chat-bg-repeat");
    }
    localStorage.setItem("synchronize.chatbg", preset.id);
  }, [chatBg]);

  const [youStyle, setYouStyle] = useState<YouStyle>(() => normalizeStoredYouStyle(localStorage.getItem("synchronize.you")) ?? "tint");
  useEffect(() => {
    document.documentElement.dataset["you"] = youStyle;
    localStorage.setItem("synchronize.you", youStyle);
  }, [youStyle]);

  const [agentLabel, setAgentLabel] = useState<AgentLabel>(() => normalizeStoredAgentLabel(localStorage.getItem("synchronize.agentlabel")) ?? "pill");
  useEffect(() => {
    document.documentElement.dataset["agentlabel"] = agentLabel;
    localStorage.setItem("synchronize.agentlabel", agentLabel);
  }, [agentLabel]);

  return { theme, setTheme, skin, setSkin, chatBg, setChatBg, youStyle, setYouStyle, agentLabel, setAgentLabel };
}
