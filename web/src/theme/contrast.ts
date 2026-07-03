export type HexColor = `#${string}`;

export function isHexColor(value: string): value is HexColor {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function relativeLuminance(hex: HexColor): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function inkForHex(bgHex: HexColor): "#111111" | "#FFFFFF" {
  return relativeLuminance(bgHex) > 0.55 ? "#111111" : "#FFFFFF";
}
