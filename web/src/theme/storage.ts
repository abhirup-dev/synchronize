import {
  normalizeIdentityColorRef,
  serializeIdentityColorRef,
  type IdentityColorRef,
} from "./identity.ts";

export function readIdentityOverrideMap(key: string): Record<string, IdentityColorRef> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, value]) => [id, normalizeIdentityColorRef(value, id)]),
    );
  } catch {
    return {};
  }
}

export function writeIdentityOverrideMap(key: string, overrides: Record<string, IdentityColorRef>): void {
  try {
    localStorage.setItem(key, JSON.stringify(overrides));
  } catch {
    /* localStorage full / blocked -- ignore */
  }
}

export function readIdentityOverride(key: string, fallbackId: string): IdentityColorRef | null {
  const raw = localStorage.getItem(key);
  return raw ? normalizeIdentityColorRef(raw, fallbackId) : null;
}

export function writeIdentityOverride(key: string, ref: IdentityColorRef | null): void {
  if (ref) localStorage.setItem(key, serializeIdentityColorRef(ref));
  else localStorage.removeItem(key);
}
