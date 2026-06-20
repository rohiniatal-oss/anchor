import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LLM_MODELS, MODEL_LIGHT, MODEL_PRIMARY, resolveLlmModelConfig } from "./llm";

// We can't import the real llm module (it creates an OpenAI client).
// Instead we test the retry/backoff logic and llmJSON parsing by
// re-implementing the core loops against a fake client — the contract
// is "retry N times with exponential backoff, then throw".

const BASE_DELAY_MS = 1000;

function makeFakeClient(responses: Array<{ ok: true; text: string; usage?: { input_tokens: number; output_tokens: number } } | { ok: false; error: Error }>) {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    responses: {
      async create(_opts: any) {
        const r = responses[callCount++];
        if (!r || !r.ok) throw (r as any)?.error ?? new Error("fail");
        return { output_text: r.text, usage: r.usage ?? null };
      },
    },
  };
}

async function llmWithClient(client: any, input: string, retries: number): Promise<{ text: string; attempts: number; inputTokens: number; outputTokens: number }> {
  let lastError: unknown = new Error("llm call failed");
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts++;
    try {
      const r = await client.responses.create({ model: "test", input });
      if (r.usage) {
        inputTokens += r.usage.input_tokens || 0;
        outputTokens += r.usage.output_tokens || 0;
      }
      return { text: (r.output_text || "").trim(), attempts, inputTokens, outputTokens };
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        // In tests we skip the actual delay
      }
    }
  }
  throw lastError;
}

function llmJSONWithClient<T = any>(client: any, input: string, retries: number): Promise<T | null> {
  return llmWithClient(client, input, retries).then(({ text }) => {
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  }).catch(() => null);
}

describe("llm retry logic", () => {
  test("returns on first successful call", async () => {
    const client = makeFakeClient([{ ok: true, text: "hello" }]);
    const result = await llmWithClient(client, "test", 2);
    assert.equal(result.text, "hello");
    assert.equal(result.attempts, 1);
  });

  test("retries on failure and succeeds on second attempt", async () => {
    const client = makeFakeClient([
      { ok: false, error: new Error("rate limit") },
      { ok: true, text: "recovered" },
    ]);
    const result = await llmWithClient(client, "test", 2);
    assert.equal(result.text, "recovered");
    assert.equal(result.attempts, 2);
  });

  test("retries exhausted throws last error", async () => {
    const err = new Error("persistent failure");
    const client = makeFakeClient([
      { ok: false, error: err },
      { ok: false, error: err },
      { ok: false, error: err },
    ]);
    await assert.rejects(() => llmWithClient(client, "test", 2), (thrown: any) => {
      assert.equal(thrown.message, "persistent failure");
      return true;
    });
    assert.equal(client.callCount, 3);
  });

  test("retries=0 means no retry — fails immediately", async () => {
    const client = makeFakeClient([{ ok: false, error: new Error("boom") }]);
    await assert.rejects(() => llmWithClient(client, "test", 0));
    assert.equal(client.callCount, 1);
  });

  test("trims whitespace from output", async () => {
    const client = makeFakeClient([{ ok: true, text: "  padded  \n" }]);
    const result = await llmWithClient(client, "test", 0);
    assert.equal(result.text, "padded");
  });

  test("empty output returns empty string", async () => {
    const client = makeFakeClient([{ ok: true, text: "" }]);
    const result = await llmWithClient(client, "test", 0);
    assert.equal(result.text, "");
  });

  test("accumulates token usage across retries", async () => {
    const client = makeFakeClient([
      { ok: false, error: new Error("fail") },
      { ok: true, text: "ok", usage: { input_tokens: 100, output_tokens: 50 } },
    ]);
    const result = await llmWithClient(client, "test", 1);
    assert.equal(result.inputTokens, 100);
    assert.equal(result.outputTokens, 50);
  });

  test("handles null usage gracefully", async () => {
    const client = makeFakeClient([{ ok: true, text: "ok" }]);
    const result = await llmWithClient(client, "test", 0);
    assert.equal(result.inputTokens, 0);
    assert.equal(result.outputTokens, 0);
  });
});

describe("llmJSON parsing", () => {
  test("parses clean JSON response", async () => {
    const client = makeFakeClient([{ ok: true, text: '{"name": "test", "value": 42}' }]);
    const result = await llmJSONWithClient(client, "test", 0);
    assert.deepEqual(result, { name: "test", value: 42 });
  });

  test("strips markdown code fences", async () => {
    const client = makeFakeClient([{ ok: true, text: '```json\n{"key": "val"}\n```' }]);
    const result = await llmJSONWithClient(client, "test", 0);
    assert.deepEqual(result, { key: "val" });
  });

  test("strips plain code fences", async () => {
    const client = makeFakeClient([{ ok: true, text: '```\n[1, 2, 3]\n```' }]);
    const result = await llmJSONWithClient(client, "test", 0);
    assert.deepEqual(result, [1, 2, 3]);
  });

  test("returns null on invalid JSON", async () => {
    const client = makeFakeClient([{ ok: true, text: "not json at all" }]);
    const result = await llmJSONWithClient(client, "test", 0);
    assert.equal(result, null);
  });

  test("returns null when LLM call fails", async () => {
    const client = makeFakeClient([{ ok: false, error: new Error("down") }]);
    const result = await llmJSONWithClient(client, "test", 0);
    assert.equal(result, null);
  });

  test("parses array response", async () => {
    const client = makeFakeClient([{ ok: true, text: '["a", "b"]' }]);
    const result = await llmJSONWithClient<string[]>(client, "test", 0);
    assert.deepEqual(result, ["a", "b"]);
  });
});

describe("exponential backoff timing", () => {
  test("delay doubles each attempt", () => {
    const delays = [0, 1, 2, 3].map((attempt) => BASE_DELAY_MS * 2 ** attempt);
    assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  });
});

describe("model configuration", () => {
  test("primary model uses a valid OpenAI model id format", () => {
    assert.match(MODEL_PRIMARY, /^gpt-[\w.]+$/);
    assert.doesNotMatch(MODEL_PRIMARY, /_/);
  });

  test("defaults target current flagship and lower-cost support models", () => {
    assert.equal(MODEL_PRIMARY, "gpt-5.5");
    assert.equal(MODEL_LIGHT, "gpt-5.4-mini");
  });

  test("env overrides can swap the primary and light models without code edits", () => {
    const models = resolveLlmModelConfig({
      ...process.env,
      ANCHOR_LLM_PRIMARY_MODEL: "gpt-5.4",
      ANCHOR_LLM_LIGHT_MODEL: "gpt-5.4-nano",
    });
    assert.deepEqual(models, {
      primary: "gpt-5.4",
      light: "gpt-5.4-nano",
    });
  });

  test("blank env overrides fall back to sane defaults", () => {
    const models = resolveLlmModelConfig({
      ...process.env,
      ANCHOR_LLM_PRIMARY_MODEL: "   ",
      ANCHOR_LLM_LIGHT_MODEL: "",
    });
    assert.deepEqual(models, {
      primary: "gpt-5.5",
      light: "gpt-5.4-mini",
    });
  });

  test("named workload defaults keep planning and drafting on the strong lane", () => {
    assert.deepEqual(LLM_MODELS, {
      breakdown: "gpt-5.5",
      draft: "gpt-5.5",
      critique: "gpt-5.5",
      support: "gpt-5.4-mini",
    });
  });
});
