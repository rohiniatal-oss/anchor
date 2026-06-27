/**
 * GET /api/admin/openai-diag — server-side diagnostic for the OpenAI integration.
 *
 * Reads the same OPENAI_API_KEY and ANCHOR_LLM_PRIMARY_MODEL env vars the
 * composer reads, then runs three checks: env presence, models.list reachability,
 * and a 1-token ping against the configured model.
 *
 * Never leaks the key value. The response includes only the key's length and a
 * masked prefix (first 4 chars), enough to confirm "yes, a key shaped like an
 * OpenAI key is loaded into the process" without disclosing the secret.
 *
 * Gated behind adminRoutesAllowed() — same gate as the other /api/admin/*
 * routes. Safe to leave mounted in production.
 */
import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { resolveLlmModelConfig } from "./llm";

type DiagStep = { name: string; ok: boolean; detail?: string; error?: string };

type DiagReport = {
  ok: boolean;
  summary: string;
  env: {
    openaiApiKey: { present: boolean; length: number; prefix: string };
    primaryModel: string;
    lightModel: string;
    nodeEnv: string | undefined;
  };
  steps: DiagStep[];
};

function maskKey(key: string | undefined): { present: boolean; length: number; prefix: string } {
  if (!key) return { present: false, length: 0, prefix: "" };
  return { present: true, length: key.length, prefix: key.slice(0, 4) + "…" };
}

async function buildDiagReport(): Promise<DiagReport> {
  const key = process.env.OPENAI_API_KEY;
  const models = resolveLlmModelConfig();
  const steps: DiagStep[] = [];
  const env = {
    openaiApiKey: maskKey(key),
    primaryModel: models.primary,
    lightModel: models.light,
    nodeEnv: process.env.NODE_ENV,
  };

  if (!key) {
    steps.push({
      name: "env",
      ok: false,
      error: "OPENAI_API_KEY is not set on this process. Set it on Railway and redeploy.",
    });
    return { ok: false, summary: "OPENAI_API_KEY missing from process env", env, steps };
  }
  steps.push({
    name: "env",
    ok: true,
    detail: `Key present (length ${env.openaiApiKey.length}, prefix ${env.openaiApiKey.prefix}). Primary model: ${env.primaryModel}.`,
  });

  const client = new OpenAI({ apiKey: key });

  // Step 2 — list models
  let availableModels: string[] = [];
  try {
    const list = await client.models.list();
    availableModels = list.data.map((m) => m.id);
    steps.push({
      name: "models.list",
      ok: true,
      detail: `${availableModels.length} models accessible to this key.`,
    });
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const message = err?.message || String(err);
    steps.push({
      name: "models.list",
      ok: false,
      error: `models.list failed: HTTP ${status || "?"} ${message}. Likely: invalid key, revoked key, or no permission.`,
    });
    return { ok: false, summary: `models.list failed (HTTP ${status || "?"})`, env, steps };
  }

  // Step 3 — confirm configured model is accessible
  const configured = env.primaryModel;
  const inList = availableModels.includes(configured);
  if (inList) {
    steps.push({
      name: "model-accessible",
      ok: true,
      detail: `"${configured}" is in the available models list.`,
    });
  } else {
    const candidates = availableModels
      .filter((m) => /^(gpt-5|gpt-4o|o[0-9]|o4-)/i.test(m))
      .sort()
      .slice(0, 12);
    steps.push({
      name: "model-accessible",
      ok: false,
      error: `Configured model "${configured}" is NOT in the available models list.`,
      detail: `Notable alternatives: ${candidates.join(", ") || "(none of gpt-5/gpt-4o/o-series accessible)"}.`,
    });
  }

  // Step 4 — 1-token ping
  try {
    const r = await client.responses.create({
      model: configured,
      input: 'Reply with the single word "pong" and nothing else.',
    });
    const text = (r.output_text || "").trim();
    const inputTokens = r.usage?.input_tokens ?? null;
    const outputTokens = r.usage?.output_tokens ?? null;
    const looksRight = text.toLowerCase().includes("pong");
    steps.push({
      name: "ping",
      ok: looksRight,
      detail: `Response: "${text}". Tokens: in=${inputTokens}, out=${outputTokens}.`,
      error: looksRight ? undefined : "Model responded but did not return 'pong'. Unusual — check the response content.",
    });
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const message = err?.message || String(err);
    steps.push({
      name: "ping",
      ok: false,
      error: `responses.create on "${configured}" failed: HTTP ${status || "?"} ${message}.`,
    });
  }

  const allOk = steps.every((s) => s.ok);
  const summary = allOk
    ? `OK: key valid, "${configured}" responsive.`
    : `FAIL at step: ${steps.find((s) => !s.ok)?.name || "?"}`;

  return { ok: allOk, summary, env, steps };
}

function adminRoutesAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ANCHOR_ADMIN_ROUTES === "true" ||
    (!!process.env.ANCHOR_BASIC_USER && !!process.env.ANCHOR_BASIC_PASSWORD)
  );
}

export function registerOpenAIDiagRoute(app: Express): void {
  app.get("/api/admin/openai-diag", async (_req: Request, res: Response) => {
    if (!adminRoutesAllowed()) {
      return res.status(403).json({
        error:
          "Admin routes disabled in production. Configure ANCHOR_BASIC_USER and ANCHOR_BASIC_PASSWORD, or set ANCHOR_ADMIN_ROUTES=true.",
      });
    }
    try {
      const report = await buildDiagReport();
      return res.status(report.ok ? 200 : 502).json(report);
    } catch (err: any) {
      return res.status(500).json({
        error: "Unexpected error running diagnostic",
        detail: err?.message || String(err),
      });
    }
  });
}
