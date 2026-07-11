import { Appearance, useColorScheme } from 'react-native';
import { dark, light, identityColor } from './tokens';

export type ThemePref = 'system' | 'light' | 'dark';

// ponytail: in-memory pref (same policy as the daemon URL); persist if it matters.
let pref: ThemePref = 'system';

export function getThemePref() {
  return pref;
}

// Appearance.setColorScheme overrides useColorScheme app-wide, so every
// component re-renders with the new scheme — no provider needed.
export function setThemePref(next: ThemePref) {
  pref = next;
  // runtime accepts null to clear the override; this RN version's types don't
  Appearance.setColorScheme((next === 'system' ? null : next) as 'light' | 'dark');
}

export function useTheme() {
  const mode = useColorScheme() === 'light' ? ('light' as const) : ('dark' as const);
  const t = mode === 'light' ? light : dark;
  return { t, mode, identity: (key: string) => identityColor(key, mode) };
}
