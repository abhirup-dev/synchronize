import { useEffect, useState } from "react";
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
  type ThemeName,
} from "../theme/registry.generated.ts";

// Theme = Sigil's matched light/dark palette; skin = the Sigil visual grammar.
// Both remain explicit, typed axes so palette behavior and component geometry do
// not drift between app, Storybook, and persisted preferences. Legacy stored
// values normalize through the generated registry before these attributes land
// on <html>.
export { ALL_THEMES, DARK_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, LIGHT_THEMES };
export type { ThemeName };

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
}

/**
 * Owns the persisted Sigil palette and applies the sole production skin.
 * Legacy stored values normalize into the matched light/dark pair.
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

  useEffect(() => {
    const skin = normalizeStoredSkin(localStorage.getItem("synchronize.skin")) ?? INITIAL_SKIN;
    document.documentElement.dataset["skin"] = skin;
    localStorage.setItem("synchronize.skin", skin);
    localStorage.removeItem("synchronize.chatbg");
  }, []);

  return { theme, setTheme };
}
