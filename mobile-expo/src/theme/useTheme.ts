import { useColorScheme } from 'react-native';
import { dark, light, identityColor, type Scheme } from './tokens';

export function useTheme(): { t: Scheme; mode: 'dark' | 'light'; identity: (key: string) => { bg: string; fg: string } } {
  const mode = useColorScheme() === 'light' ? 'light' : 'dark';
  const t = mode === 'light' ? light : dark;
  return { t, mode, identity: (key: string) => identityColor(key, mode) };
}
