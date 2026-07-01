import OpenAI from "openai";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

type LlmOptions = {
  model?: string;
  tools?: any[];
  retries?: number;
};

const DEFAULT_PRIMARY_MODEL = "gpt-5.5";
const DEFAULT_LIGHT_MODEL = "gpt-5.4-mini";

function cleanModelId(value: string | undefined, fallback: string) {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

export function resolveLlmModelConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    // Use the strongest default for open-ended planning/reasoning work.
    primary: cleanModelId(env.ANCHOR_LLM_PRIMARY_MODEL, DEFAULT_PRIMARY_MODEL),
    // Keep support/extraction/classification paths on a cheaper default.
    light: cleanModelId(env.ANCHOR_LLM_LIGHT_MODEL, DEFAULT_LIGHT_MODEL),
  };
}

const MODEL_CONFIG = resolveLlmModelConfig();
export const MODEL_PRIMARY = MODEL_CONFIG.primary;
export const MODEL_LIGHT = MODEL_CONFIG.light;
export const LLM_MODELS = Object.freeze({
  breakdown: MODEL_PRIMARY,
  draft: MODEL_PRIMARY,
  critique: MODEL_PRIMARY,
  support: MODEL_LIGHT,
});
const DEFAULT_MODEL = MODEL_PRIMARY;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

let _totalCalls = 0;
let _totalInputTokens = 0;
let _totalOutputTokens = 0;

export function llmUsageStats() {
  return { calls: _totalCalls, inputTokens: _totalInputTokens, outputTokens: _totalOutputTokens };
}

export async function llm(input: string, opts: LlmOptions = {}): Promise<string> {
  const model = opts.model || DEFAULT_MODEL;
  const retries = Math.max(0, opts.retries ?? MAX_RETRIES);
  const client = getClient();

  let lastError: unknown = new Error("llm call failed");
  for (let attempt = 0; attempt <= retries; attempt++) {
    _totalCalls++;
    try {
      const r = await client.responses.create({
        model,
        input,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
      });
      if (r.usage) {
        _totalInputTokens += r.usage.input_tokens || 0;
        _totalOutputTokens += r.usage.output_tokens || 0;
      }
      return (r.output_text || "").trim();
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export function parseLlmJsonText<T = any>(raw: string): T {
  const text = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(text);
}

export async function llmJSONStrict<T = any>(input: string, opts: LlmOptions = {}): Promise<T> {
  return parseLlmJsonText<T>(await llm(input, opts));
}

export async function llmJSON<T = any>(input: string, opts: LlmOptions = {}): Promise<T | null> {
  try {
    return await llmJSONStrict<T>(input, opts);
  } catch {
    return null;
  }
}