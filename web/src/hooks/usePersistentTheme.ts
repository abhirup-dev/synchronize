import { useEffect, useState } from "react";
import { chatBackgroundById } from "../data/chatBackgrounds.ts";

// Theme = palette; skin = aesthetic system (border/shadow/radius language),
// orthogonal axes. Both persist to localStorage as plain strings and are
// applied as `data-theme` / `data-skin` on <html> so CSS owns the cascade.
const LIGHT_THEMES = ["light", "rose-pine-dawn"] as const;
const DARK_THEMES = ["dark", "kanagawa-wave", "catppuccin-mocha"] as const;
const ALL_THEMES = [...LIGHT_THEMES, ...DARK_THEMES] as const;

export type ThemeName = (typeof ALL_THEMES)[number];

function isThemeName(value: string | null): value is ThemeName {
  return ALL_THEMES.includes(value as ThemeName);
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
  return themeFamily(theme) === "light" ? "kanagawa-wave" : "light";
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
    return isThemeName(stored) ? stored : "kanagawa-wave";
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
