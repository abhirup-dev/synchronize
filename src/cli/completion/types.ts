import type { DynamicCompletionProvider } from "../schema.ts";

export type { DynamicCompletionProvider };

export interface CompletionCandidate {
  value: string;
  description?: string;
}

export interface CompletionContext {
  group?: string;
}
