// Provider factory + prompt template for thread summarization (sync-b8q).
//
// Single source of truth for:
//   - which provider/model we call
//   - the system prompt text
//   - the prompt_version constant used for cache invalidation
//
// Provider selection is intentionally a one-line swap: today only OpenRouter
// is wired, but adding Anthropic/OpenAI/Google direct or Ollama is a matter
// of a new branch in resolveModel().

import { generateText, type LanguageModel } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export const DEFAULT_PROVIDER = "openrouter";
export const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

// Bump whenever SYSTEM_PROMPT changes. Worker treats lower-version rows as
// stale automatically, so existing cached summaries get rewritten on next pass.
export const PROMPT_VERSION = 1;

export const SYSTEM_PROMPT = `You are summarizing a chat thread between local agents.
Output 2-4 sentences covering: what was discussed, who participated, and any decision or open question.
Do not include preamble, headings, or quotes.`;

export interface ProviderConfig {
  provider: string; // "openrouter" today
  model: string;   // e.g. "google/gemini-2.5-flash-lite"
  apiKey: string;
}

export interface SummarizeResult {
  text: string;
  model: string; // "<provider>:<model>" for storage provenance
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  elapsedMs: number;
}

/**
 * Returns the resolved provider config when the feature is enabled, or null
 * when it isn't. Enablement = presence of an API key for the selected
 * provider. No separate feature flag — key presence IS the switch.
 */
export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  const provider = (env.SYNCHRONIZE_LLM_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase();
  const model = env.SYNCHRONIZE_LLM_MODEL ?? DEFAULT_MODEL;
  if (provider === "openrouter") {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return { provider, model, apiKey };
  }
  // New providers slot in here. Each branch decides which env var holds the key.
  return null;
}

function buildModel(cfg: ProviderConfig): LanguageModel {
  if (cfg.provider === "openrouter") {
    return createOpenRouter({ apiKey: cfg.apiKey })(cfg.model);
  }
  throw new Error(`unknown LLM provider: ${cfg.provider}`);
}

/**
 * Call the LLM with the canonical system prompt and the caller-rendered
 * transcript. Returns text + the storage-shaped model id ("provider:model").
 */
export async function summarizeTranscript(
  cfg: ProviderConfig,
  transcript: string,
): Promise<SummarizeResult> {
  const model = buildModel(cfg);
  const started = Date.now();
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: transcript,
  });
  return {
    text: result.text.trim(),
    model: `${cfg.provider}:${cfg.model}`,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    elapsedMs: Date.now() - started,
  };
}
