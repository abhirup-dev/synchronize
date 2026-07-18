import { useColorScheme } from 'react-native';
import { palettes, type Palette } from './tokens';

export function useTheme(): { dark: boolean; c: Palette } {
  const scheme = useColorScheme();
  const dark = scheme !== 'light';
  return { dark, c: dark ? palettes.dark : palettes.light };
}
