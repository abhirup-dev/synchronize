const NAME_POOL = [
  "alice", "bob", "carol", "dave", "eve", "frank", "grace", "heidi",
  "ivan", "judy", "mallory", "olivia", "peggy", "trent", "victor", "walter",
];

export interface IdentityHints {
  piSessionId?: string | null;
  envSessionName?: string | null;
}

export function resolveSessionName(hints: IdentityHints = {}): string {
  if (hints.envSessionName && hints.envSessionName.length > 0) return hints.envSessionName;
  if (hints.piSessionId && hints.piSessionId.length > 0) return `pi-${hints.piSessionId}`;
  const pick = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] ?? "pi";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${pick}-${suffix}`;
}
