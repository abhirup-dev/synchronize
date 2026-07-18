// SIGIL M3 tokens — JS mirror of src/global.css :root (design.md §2/§6).
// CSS handles className styling; this file serves SVG fills, dynamic HSL
// identity hues, and anything styled at runtime.

export interface Palette {
  bg: string;
  surf: string;
  surf2: string;
  fg: string;
  fg2: string;
  fg3: string;
  outl: string;
  pri: string;
  onpri: string;
  pric: string;
  onpric: string;
}

export const palettes: Record<'dark' | 'light', Palette> = {
  dark: {
    bg: '#121316',
    surf: '#1a1b1f',
    surf2: '#222428',
    fg: '#e7e8ea',
    fg2: '#9a9da3',
    fg3: '#55585f',
    outl: 'rgba(231,232,234,0.18)',
    // graphite accent (design.md §2.3) — the chosen default
    pri: '#c9ccd1',
    onpri: '#121316',
    pric: '#c9ccd12e',
    onpric: '#c9ccd1',
  },
  light: {
    bg: '#fafafa',
    surf: '#f0f0ef',
    surf2: '#e6e6e4',
    fg: '#1d1e20',
    fg2: '#5f6268',
    fg3: '#a4a7ac',
    outl: 'rgba(29,30,32,0.16)',
    pri: '#3a3d42',
    onpri: '#ffffff',
    pric: '#3a3d4224',
    onpric: '#3a3d42',
  },
};

// Sigil brand accent (ACCENTS.ember) — @you mentions keep the brand ember
// regardless of the M3 accent, exactly like the reference's paintMentions().
export const ember = { dark: '#e8825a', light: '#c2571f' };

export const statusColors = {
  working: '#52c48b',
  awaiting: 'pri', // resolved to palette.pri by statusColor()
  idle: 'fg3',
  archived: '#d05050',
} as const;

export type AgentStatus = keyof typeof statusColors;

export function statusColor(status: AgentStatus, p: Palette): string {
  const c = statusColors[status] ?? statusColors.idle;
  if (c === 'pri') return p.pri;
  if (c === 'fg3') return p.fg3;
  return c;
}

// Stable per-agent hue, assigned from peer id (design.md §2.4).
export function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export const nameColor = (id: string, dark: boolean) =>
  `hsl(${hueOf(id)} 45% ${dark ? 70 : 38}%)`;

export const sigilColor = (id: string, dark: boolean) =>
  `hsl(${hueOf(id)} 52% ${dark ? 64 : 44}%)`;
