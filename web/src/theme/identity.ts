import { inkForHex, isHexColor, type HexColor } from "./contrast.ts";

export const IDENTITY_SLOT_COUNT = 16;
export const IDENTITY_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

export type IdentitySlot = (typeof IDENTITY_SLOTS)[number];
export type ThemeTokenName = `--${string}`;

export type IdentityColorRef =
  | { kind: "slot"; slot: IdentitySlot }
  | { kind: "custom"; hex: HexColor }
  | { kind: "token"; token: ThemeTokenName };

const LEGACY_HEX_SLOT: Record<string, IdentitySlot> = {
  "#ffd23f": 0,
  "#ff5da2": 1,
  "#4d7cfe": 2,
  "#7be389": 3,
  "#ff8a3d": 4,
  "#b49bff": 5,
  "#f45b69": 6,
  "#2ec4b6": 7,
  "#1f7a3a": 8,
  "#1e2a78": 9,
  "#a14a1a": 10,
  "#555e6e": 11,
};

export function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return Math.abs(hash);
}

export function identitySlotForId(id: string): IdentitySlot {
  return IDENTITY_SLOTS[hashString(id) % IDENTITY_SLOT_COUNT]!;
}

export function identityRefForId(id: string): IdentityColorRef {
  return { kind: "slot", slot: identitySlotForId(id) };
}

export function identityRefForLegacyHex(hex: string): IdentityColorRef {
  const normalized = hex.toLowerCase();
  if (normalized === "#111111") return { kind: "token", token: "--ink" };
  if (isHexColor(normalized)) {
    const slot = LEGACY_HEX_SLOT[normalized];
    return slot === undefined ? { kind: "custom", hex: normalized } : { kind: "slot", slot };
  }
  return { kind: "token", token: "--ink" };
}

export function normalizeIdentityColorRef(value: unknown, fallbackId = ""): IdentityColorRef {
  if (typeof value === "string") {
    if (isHexColor(value)) return identityRefForLegacyHex(value);
    if (value.startsWith("var(--")) return { kind: "token", token: value.slice(4, -1) as ThemeTokenName };
    try {
      return normalizeIdentityColorRef(JSON.parse(value), fallbackId);
    } catch {
      return fallbackId ? identityRefForId(fallbackId) : { kind: "token", token: "--ink" };
    }
  }
  if (typeof value === "object" && value) {
    const candidate = value as Partial<IdentityColorRef>;
    if (candidate.kind === "slot" && typeof candidate.slot === "number" && IDENTITY_SLOTS.includes(candidate.slot as IdentitySlot)) {
      return { kind: "slot", slot: candidate.slot as IdentitySlot };
    }
    if (candidate.kind === "custom" && typeof candidate.hex === "string" && isHexColor(candidate.hex)) {
      return { kind: "custom", hex: candidate.hex.toLowerCase() as HexColor };
    }
    if (candidate.kind === "token" && typeof candidate.token === "string" && candidate.token.startsWith("--")) {
      return { kind: "token", token: candidate.token as ThemeTokenName };
    }
  }
  return fallbackId ? identityRefForId(fallbackId) : { kind: "token", token: "--ink" };
}

export function serializeIdentityColorRef(ref: IdentityColorRef): string {
  return JSON.stringify(ref);
}

export function identityColorCss(ref: IdentityColorRef): string {
  if (ref.kind === "slot") return `var(--identity-${ref.slot}-bg)`;
  if (ref.kind === "custom") return ref.hex;
  return `var(${ref.token})`;
}

export function identityInkCss(ref: IdentityColorRef): string {
  if (ref.kind === "slot") return `var(--identity-${ref.slot}-fg)`;
  if (ref.kind === "custom") return inkForHex(ref.hex);
  return "var(--paper)";
}

export function identityBorderCss(ref: IdentityColorRef): string {
  if (ref.kind === "slot") return `var(--identity-${ref.slot}-border)`;
  if (ref.kind === "custom") return "var(--rule)";
  return "var(--rule)";
}

export function identityTextCss(ref: IdentityColorRef): string {
  if (ref.kind === "slot") return `var(--identity-${ref.slot}-text)`;
  return identityColorCss(ref);
}

export function identityStyleVars(ref: IdentityColorRef): Record<string, string> {
  return {
    "--identity-color": identityColorCss(ref),
    "--identity-ink": identityInkCss(ref),
    "--identity-border": identityBorderCss(ref),
    "--identity-text": identityTextCss(ref),
  };
}

export function identityRefEquals(a: IdentityColorRef, b: IdentityColorRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "slot") return a.slot === (b as typeof a).slot;
  if (a.kind === "custom") return a.hex.toLowerCase() === (b as typeof a).hex.toLowerCase();
  return a.token === (b as typeof a).token;
}
