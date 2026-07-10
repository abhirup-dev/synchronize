// Flat Material 3 tokens for Synchronize — distilled from the shortlisted
// design decisions (D-001 chat/thread, D-002/D-003 activity synthesis).
// One restrained cyan accent, tonal containers only for structured artifacts,
// semantic green for ACK, pink reserved for "awaiting" signals.

export type Scheme = typeof dark;

export const dark = {
  background: '#0F1417',
  surface: '#14191D',
  surfaceContainer: '#1A2126',
  surfaceContainerHigh: '#222A31',
  onSurface: '#E4E8EB',
  onSurfaceVariant: '#93A0A9',
  outline: '#3A4750',
  outlineVariant: '#242D34',
  primary: '#5FC9E8',
  onPrimary: '#00293A',
  primaryContainer: '#0E3A4C',
  onPrimaryContainer: '#BEE9F9',
  success: '#5AC77F',
  onSuccessContainer: '#8FE0AC',
  successContainer: '#123A26',
  awaiting: '#F2A0B0',
  awaitingContainer: '#3B222B',
  danger: '#F28B82',
  scrim: 'rgba(0,0,0,0.55)',
  codeBg: '#10181D',
  addedText: '#6BCF8E',
  removedText: '#F28B82',
};

export const light: Scheme = {
  background: '#F7F9FA',
  surface: '#FFFFFF',
  surfaceContainer: '#EFF3F5',
  surfaceContainerHigh: '#E5EBEE',
  onSurface: '#181C1F',
  onSurfaceVariant: '#5B6870',
  outline: '#A9B6BE',
  outlineVariant: '#DEE5E9',
  primary: '#00697F',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D2ECF5',
  onPrimaryContainer: '#003544',
  success: '#1E8E4B',
  onSuccessContainer: '#0E6B36',
  successContainer: '#D9F2E2',
  awaiting: '#B3324E',
  awaitingContainer: '#FBDDE4',
  danger: '#B3261E',
  scrim: 'rgba(0,0,0,0.35)',
  codeBg: '#F1F4F6',
  addedText: '#1E8E4B',
  removedText: '#B3261E',
};

// Muted identity hues for agents/rooms — [dark container/fg, light container/fg]
const IDENTITY = [
  { darkBg: '#1F3448', darkFg: '#9CC7EC', lightBg: '#D8E8F7', lightFg: '#2A5378' },
  { darkBg: '#33273F', darkFg: '#C6ADE8', lightBg: '#EADFF7', lightFg: '#5B3E80' },
  { darkBg: '#3D3320', darkFg: '#E0C388', lightBg: '#F4E8CE', lightFg: '#71581F' },
  { darkBg: '#1E3A2C', darkFg: '#93D5AE', lightBg: '#D9F0E1', lightFg: '#1F5E3B' },
  { darkBg: '#3F2B26', darkFg: '#E5AE9A', lightBg: '#F7E2DA', lightFg: '#7A4230' },
  { darkBg: '#173A40', darkFg: '#8ED4DF', lightBg: '#D5EEF2', lightFg: '#175D68' },
  { darkBg: '#3A2833', darkFg: '#DFAECC', lightBg: '#F5E0EC', lightFg: '#6F3A59' },
  { darkBg: '#2B3140', darkFg: '#AEBBE0', lightBg: '#E1E6F5', lightFg: '#414F78' },
];

export function identityColor(key: string, mode: 'dark' | 'light') {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const c = IDENTITY[h % IDENTITY.length];
  return mode === 'dark' ? { bg: c.darkBg, fg: c.darkFg } : { bg: c.lightBg, fg: c.lightFg };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shape = { xs: 6, sm: 10, md: 14, lg: 18, full: 999 };

export const type = {
  display: { fontSize: 44, fontWeight: '600' as const, letterSpacing: -1 },
  title: { fontSize: 22, fontWeight: '600' as const },
  section: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '500' as const },
  micro: { fontSize: 11, fontWeight: '500' as const },
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
};
