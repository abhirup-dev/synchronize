export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

export function clockTime(iso?: string | null): string {
  if (!iso) return '';
  // 24h clock — machine text is mono and unadorned (reference: "10:42").
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const parts = name.replace(/[_:]/g, '-').split('-').filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return chars.join('') || '?';
}

export function displayName(sessionName?: string | null, peerId?: string): string {
  if (sessionName) return sessionName;
  if (!peerId) return 'unknown';
  return peerId.includes(':') ? peerId.split(':')[1]! : peerId.slice(0, 8);
}

// Split a message body into text and fenced-code segments so structured
// content renders in tonal containers per D-001.
export type BodySegment = { kind: 'text' | 'code'; content: string; lang?: string };

export function splitBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', content: body.slice(last, m.index).trim() });
    segments.push({ kind: 'code', content: m[2]!.replace(/\n$/, ''), lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', content: body.slice(last).trim() });
  return segments.filter((s) => s.content.length > 0);
}
