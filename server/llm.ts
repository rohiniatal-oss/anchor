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

const DEFAULT_MODEL = "gpt_5_1";
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
