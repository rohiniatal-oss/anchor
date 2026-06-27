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

export async function llmJSON<T = any>(input: string, opts: LlmOptions = {}): Promise<T | null> {
  try {
    const raw = await llm(input, opts);
    const text = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type LlmJSONLargeOptions = LlmOptions & {
  // Forwarded straight to client.responses.create. The default ~4k cap was the
  // root cause of empty/truncated model output for large structured responses.
  maxOutputTokens?: number;
};

export type LlmJSONLargeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; rawHead: string; rawTail: string };

// Extract the JSON object substring from a raw model response, tolerating code
// fences or prose on either side: take from the first "{" to the last "}".
// Returns null when no plausible object span exists.
export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

// Robust large-JSON call for structured generation (e.g. a 10-item upskill
// horizon). Unlike llmJSON it (a) raises the output-token ceiling, (b) extracts
// the JSON object from anywhere in the response (first "{" .. last "}"), and
// (c) returns a discriminated result so callers can surface real failures
// instead of a silent null.
export async function llmJSONLarge<T = any>(
  input: string,
  opts: LlmJSONLargeOptions = {},
): Promise<LlmJSONLargeResult<T>> {
  const model = opts.model || DEFAULT_MODEL;
  const retries = Math.max(0, opts.retries ?? MAX_RETRIES);
  const client = getClient();

  let raw = "";
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    _totalCalls++;
    try {
      const r = await client.responses.create({
        model,
        input,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
        ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
      });
      if (r.usage) {
        _totalInputTokens += r.usage.input_tokens || 0;
        _totalOutputTokens += r.usage.output_tokens || 0;
      }
      raw = (r.output_text || "").trim();
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }

  if (lastError) {
    return { ok: false, reason: `llm_call_failed: ${(lastError as Error)?.message || lastError}`, rawHead: "", rawTail: "" };
  }

  const head = raw.slice(0, 200);
  const tail = raw.slice(-200);
  if (!raw) {
    console.error(`[llmJSONLarge] parse failed model=${model} len=0 head="" tail=""`);
    return { ok: false, reason: "empty_model_output", rawHead: head, rawTail: tail };
  }

  const slice = extractFirstJsonObject(raw);
  if (slice == null) {
    console.error(`[llmJSONLarge] parse failed model=${model} len=${raw.length} head=${JSON.stringify(head)} tail=${JSON.stringify(tail)}`);
    return { ok: false, reason: "no_json_object_found", rawHead: head, rawTail: tail };
  }

  try {
    const value = JSON.parse(slice) as T;
    return { ok: true, value };
  } catch (e) {
    console.error(`[llmJSONLarge] parse failed model=${model} len=${raw.length} head=${JSON.stringify(head)} tail=${JSON.stringify(tail)}`);
    return { ok: false, reason: `json_parse_error: ${(e as Error)?.message || e}`, rawHead: head, rawTail: tail };
  }
}
