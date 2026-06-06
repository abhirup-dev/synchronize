import { MAX_PAGE_LIMIT } from "../constants.ts";
import { HttpError } from "../http.ts";
import type { ResolvedStrategy } from "../summarize/index.ts";
import type { SelectorStrategy } from "../api/types.ts";

const DEFAULT_SELECTOR_STRATEGY: SelectorStrategy = "last";
const DEFAULT_SELECTOR_K = 5;

export interface NormalizedSelectors {
  strategy: SelectorStrategy;
  k?: number;
}

export function parseSelectorsFromUrl(url: URL): NormalizedSelectors {
  const rawStrategy = url.searchParams.get("selector_strategy");
  const rawK = url.searchParams.get("selector_k") ?? url.searchParams.get("limit");
  return normalizeSelectors(rawStrategy, rawK === null ? undefined : Number.parseInt(rawK, 10));
}

export function normalizeSelectors(rawStrategy: string | null | undefined, rawK?: number): NormalizedSelectors {
  const strategy = (rawStrategy ?? DEFAULT_SELECTOR_STRATEGY).trim();
  if (strategy !== "first" && strategy !== "last" && strategy !== "all") {
    throw new HttpError(400, "invalid_selectors", "selectors.strategy must be first, last, or all");
  }
  if (strategy === "all") {
    if (rawK !== undefined) {
      throw new HttpError(400, "invalid_selectors", "selectors.k is not allowed when strategy is all");
    }
    return { strategy };
  }
  if (rawK !== undefined && (!Number.isInteger(rawK) || rawK < 1)) {
    throw new HttpError(400, "invalid_selectors", "selectors.k must be a positive integer");
  }
  if (strategy === "first" && rawK === undefined) {
    throw new HttpError(400, "invalid_selectors", "selectors.k is required when strategy is first");
  }
  return { strategy, k: Math.min(rawK ?? DEFAULT_SELECTOR_K, MAX_PAGE_LIMIT) };
}

export function selectorLimit(selectors: NormalizedSelectors): number {
  return selectors.strategy === "all" ? MAX_PAGE_LIMIT : selectors.k ?? DEFAULT_SELECTOR_K;
}

export function selectorToSummaryStrategy(selectors: NormalizedSelectors): ResolvedStrategy {
  if (selectors.strategy === "all") return { strategy: "all", params: {} };
  if (selectors.strategy === "first") return { strategy: "first_k", params: { k: selectors.k! } };
  return { strategy: "last_k", params: { k: selectors.k ?? DEFAULT_SELECTOR_K } };
}

export function selectThreadEvents<T>(events: T[], selectors: NormalizedSelectors): { events: T[]; truncated: boolean } {
  if (events.length === 0) return { events: [], truncated: false };
  if (selectors.strategy === "all") {
    return { events: events.slice(0, MAX_PAGE_LIMIT), truncated: events.length > MAX_PAGE_LIMIT };
  }
  const root = events[0]!;
  const replies = events.slice(1);
  const k = selectors.k ?? DEFAULT_SELECTOR_K;
  const selectedReplies = selectors.strategy === "first" ? replies.slice(0, k) : replies.slice(Math.max(0, replies.length - k));
  return { events: [root, ...selectedReplies], truncated: replies.length > selectedReplies.length };
}
