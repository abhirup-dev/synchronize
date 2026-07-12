// Native-quiet Material tokens for Synchronize — revamped per the
// inspiration-and-divergence doc (Paseo / T3 Code mobile / M3 dark craft /
// Slack-Spotify-Telegram-X). Two independently designed schemes:
//   dark  = quiet near-black tonal band, tone-80 pastel accents
//   light = white/grey neutrals, tone-40 vivid accents
// Color budget: identity lives in avatars, semantics live in dots/ticks,
// brand blue appears at most twice per screen. Flat — no glass, no gradients.

export type Scheme = typeof dark;

export const dark = {
  background: '#0F1115',
  surface: '#0F1115', // rows sit directly on background — no card washes
  surfaceContainer: '#171B20', // chips, composer, sheets
  surfaceContainerHigh: '#1E242B', // menus, dialogs, text fields
  onSurface: '#E7EAEE', // never pure white
  onSurfaceVariant: '#98A2AD',
  outline: '#3A424C',
  outlineVariant: '#212831', // inset hairline dividers
  primary: '#8AB4F8', // tone-80 pastel blue
  onPrimary: '#062E6F',
  primaryContainer: '#1B3A61',
  onPrimaryContainer: '#C2DCFF',
  success: '#81C995',
  successContainer: '#143B24',
  onSuccessContainer: '#A5E8BC',
  awaiting: '#FDBE71',
  awaitingContainer: '#3A2B12',
  onAwaitingContainer: '#FFDDB0',
  danger: '#F28B82',
  dangerContainer: '#3C1E1B',
  onDangerContainer: '#FAC5C0',
  mention: '#D0BCFF',
  mentionContainer: '#33284A',
  onMentionContainer: '#E9DDFF',
  scrim: 'rgba(0,0,0,0.55)',
  codeBg: '#161B22',
  addedText: '#81C995',
  removedText: '#F28B82',
};

export const light: Scheme = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceContainer: '#F0F2F5',
  surfaceContainerHigh: '#E7EAEE',
  onSurface: '#191C20',
  onSurfaceVariant: '#565E68',
  outline: '#7A838E',
  outlineVariant: '#E3E7EC',
  primary: '#1F63D2',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DCE8FB',
  onPrimaryContainer: '#17498F',
  success: '#188945',
  successContainer: '#D9F3E2',
  onSuccessContainer: '#0B6130',
  awaiting: '#A85E00',
  awaitingContainer: '#FBEBCE',
  onAwaitingContainer: '#7E4A05',
  danger: '#C93A2E',
  dangerContainer: '#FBE3E0',
  onDangerContainer: '#93251C',
  mention: '#6D3AD6',
  mentionContainer: '#ECE4FB',
  onMentionContainer: '#54269E',
  scrim: 'rgba(0,0,0,0.35)',
  codeBg: '#F0F2F5',
  addedText: '#188945',
  removedText: '#C93A2E',
};

// Identity colors for agents/rooms/people. Solid tempered avatar fill (white
// glyph, feedback-1) plus:
//   soft — tone-80 pastel, the ONLY form identity color takes as text on dark
//   deep — tone-40, identity text on light
//   tint — ~12% wash, allowed on chips only, never rows/headers
const IDENTITY = [
  { c: '#4C8DF5', deep: '#1D4ED8', soft: '#9CC3FF' }, // blue
  { c: '#3FAE6A', deep: '#15803D', soft: '#8ED9A9' }, // green
  { c: '#E8823F', deep: '#C2410C', soft: '#FFB68A' }, // orange
  { c: '#9D6BE8', deep: '#7E22CE', soft: '#CDAAF7' }, // purple
  { c: '#D9639B', deep: '#BE185D', soft: '#F2A7C9' }, // pink
  { c: '#2FA396', deep: '#0F766E', soft: '#7FD4C9' }, // teal
  { c: '#D99A2B', deep: '#B45309', soft: '#F2CC85' }, // amber
  { c: '#7278E0', deep: '#4338CA', soft: '#AEB2F2' }, // indigo
  { c: '#2FA8C7', deep: '#0E7490', soft: '#8AD4E8' }, // cyan
];

export function identityColor(key: string, mode: 'dark' | 'light') {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const { c, deep, soft } = IDENTITY[h % IDENTITY.length];
  return {
    bg: c,
    fg: '#FFFFFF',
    tint: c + (mode === 'dark' ? '21' : '1F'),
    onTint: mode === 'dark' ? soft : deep,
  };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shape = { xs: 6, sm: 10, md: 14, lg: 18, full: 999 };

// Row anatomy constants (M3 list idiom): edge-to-edge rows, inset dividers.
export const row = { one: 56, two: 68, textInset: 68 };

// Semantic type roles (combined-audit rule: typography carries hierarchy
// before containers or color; four clear levels per screen).
export const type = {
  display: { fontSize: 44, fontWeight: '600' as const, letterSpacing: -1 },
  title: { fontSize: 22, fontWeight: '600' as const }, // expanded destination title
  titleSm: { fontSize: 17, fontWeight: '600' as const }, // compact app-bar title
  metric: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.5 }, // command-center metric — one per screen, tied to a task
  section: { fontSize: 16, fontWeight: '600' as const }, // list headline
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  sub: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 }, // supporting text
  label: { fontSize: 13, fontWeight: '500' as const }, // control label
  micro: { fontSize: 11, fontWeight: '500' as const }, // metadata/timestamps only — never the only copy of important info
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
};
