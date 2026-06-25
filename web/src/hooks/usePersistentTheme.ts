import { useEffect, useState } from "react";
import { chatBackgroundById } from "../data/chatBackgrounds.ts";

// Theme = palette; skin = aesthetic system (border/shadow/radius language),
// orthogonal axes. Both persist to localStorage as plain strings and are
// applied as `data-theme` / `data-skin` on <html> so CSS owns the cascade.
// Canonical dark theme is Kanagawa Wave. Keep
// the DEFAULT_* constants the single source for "which theme does each family
// open in" — App boot, the family toggle, and the Storybook theme matrix all read
// them so the default can never drift per call site.
export const LIGHT_THEMES = ["light", "rose-pine-dawn"] as const;
export const DARK_THEMES = ["kanagawa-wave"] as const;
export const ALL_THEMES = [...LIGHT_THEMES, ...DARK_THEMES] as const;

export type ThemeName = (typeof ALL_THEMES)[number];

export const DEFAULT_LIGHT_THEME: ThemeName = "light";
export const DEFAULT_DARK_THEME: ThemeName = "kanagawa-wave";

function isThemeName(value: string | null): value is ThemeName {
  return ALL_THEMES.includes(value as ThemeName);
}

function normalizeStoredTheme(value: string | null): ThemeName {
  if (value === "dark" || value === "catppuccin-mocha") return DEFAULT_DARK_THEME;
  return isThemeName(value) ? value : DEFAULT_DARK_THEME;
}

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

export interface PersistentTheme {
  theme: ThemeName;
  setTheme: React.Dispatch<React.SetStateAction<ThemeName>>;
  skin: "brutal" | "glass";
  setSkin: React.Dispatch<React.SetStateAction<"brutal" | "glass">>;
  chatBg: string;
  setChatBg: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Owns the persisted display preferences (theme, skin, chat background) and the
 * side effects that apply them to the document. Extracted from App so the Shell
 * is composition, not preference plumbing (sync-imeu.1.20).
 */
export function usePersistentTheme(): PersistentTheme {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem("synchronize.theme");
    return normalizeStoredTheme(stored);
  });
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("synchronize.theme", theme);
  }, [theme]);

  const [skin, setSkin] = useState<"brutal" | "glass">(() =>
    localStorage.getItem("synchronize.skin") === "glass" ? "glass" : "brutal",
  );
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

  return { theme, setTheme, skin, setSkin, chatBg, setChatBg };
}
