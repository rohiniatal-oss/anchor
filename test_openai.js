// test_openai.js
//
// Verifies that the current process can authenticate to OpenAI and reach a
// model. Designed to run wherever you suspect the key isn't working — on
// Railway via `railway run node test_openai.js`, on your laptop, or in any
// Node environment.
//
// Output is intentionally explicit so the failure mode is obvious:
//   - "no key in env" → variable name typo or not set on this process
//   - "auth error (401)" → key invalid, revoked, or has no model access
//   - "model X not accessible" → key works but the configured model isn't
//     on your account
//   - "OK" with model list → fully working
//
// Usage:
//   node test_openai.js
//   ANCHOR_LLM_PRIMARY_MODEL=gpt-4o node test_openai.js  // override
//
// No npm install needed if you run this from the anchor/ directory — it
// reuses the existing `openai` dependency. Otherwise: npm i openai

import OpenAI from "openai";

const keyName = "OPENAI_API_KEY";
const key = process.env[keyName];
const configuredModel =
  process.env.ANCHOR_LLM_PRIMARY_MODEL ||
  process.env.ANCHOR_LLM_LIGHT_MODEL ||
  "gpt-5.5"; // composer's default

function header(s) {
  console.log("\n=== " + s + " ===");
}

header("Environment");
if (!key) {
  console.log(`STATUS: FAIL — no ${keyName} in this process.`);
  console.log(`Fix: set ${keyName} on whichever service this is running on.`);
  process.exit(1);
}
console.log(`${keyName}: set (length ${key.length}, prefix "${key.slice(0, 8)}…")`);
console.log(`Configured model: ${configuredModel}`);

header("Step 1 — list available models");
const client = new OpenAI({ apiKey: key });
let models;
try {
  const resp = await client.models.list();
  models = resp.data.map((m) => m.id).sort();
  console.log(`OK — ${models.length} models accessible to this key`);
  // Print a sampling, especially GPT models
  const interesting = models.filter((m) =>
    /^(gpt-5|gpt-4o|o[0-9]|o4-)/i.test(m)
  );
  console.log("Notable models:");
  for (const m of interesting.slice(0, 20)) console.log("  - " + m);
  if (interesting.length === 0) {
    console.log("  (no gpt-5/gpt-4o/o-series models found — restricted key?)");
  }
} catch (err) {
  console.log("STATUS: FAIL — could not list models.");
  console.log("Error:", err?.status || "", err?.message || err);
  if (err?.status === 401) {
    console.log("\nDiagnosis: 401 Unauthorized. The key is invalid, revoked, or malformed.");
  } else if (err?.status === 403) {
    console.log("\nDiagnosis: 403 Forbidden. Key is valid but lacks the model.list permission.");
  } else {
    console.log("\nDiagnosis: network or unexpected error. Check connectivity.");
  }
  process.exit(2);
}

header(`Step 2 — confirm configured model "${configuredModel}" is accessible`);
const accessible = models.includes(configuredModel);
if (accessible) {
  console.log(`OK — "${configuredModel}" is in the available list.`);
} else {
  console.log(`MISSING — "${configuredModel}" is NOT in the available list.`);
  // Suggest the closest alternative
  const candidates = models.filter((m) =>
    /^(gpt-5|gpt-4o)/.test(m)
  );
  if (candidates.length) {
    console.log("Available alternatives you could set ANCHOR_LLM_PRIMARY_MODEL to:");
    for (const c of candidates.slice(0, 10)) console.log("  - " + c);
  }
}

header(`Step 3 — make a 1-token completion call against "${configuredModel}"`);
try {
  const r = await client.responses.create({
    model: configuredModel,
    input: 'Reply with the single word "pong" and nothing else.',
  });
  const text = (r.output_text || "").trim();
  console.log(`Response: "${text}"`);
  if (text.toLowerCase().includes("pong")) {
    console.log(`OK — model "${configuredModel}" responded correctly.`);
  } else {
    console.log(`WARN — model responded but not as expected. Output above.`);
  }
  console.log("Usage:", r.usage || "(none reported)");
} catch (err) {
  console.log(`STATUS: FAIL — could not call ${configuredModel}.`);
  console.log("Error:", err?.status || "", err?.message || err);
  if (err?.status === 404) {
    console.log(`\nDiagnosis: model "${configuredModel}" not found for this key.`);
    console.log(`Set ANCHOR_LLM_PRIMARY_MODEL to an accessible model (see Step 2).`);
  } else if (err?.status === 401) {
    console.log("\nDiagnosis: 401 Unauthorized on the call (rare if Step 1 succeeded).");
  } else if (err?.status === 429) {
    console.log("\nDiagnosis: rate-limited or out of credits.");
  }
  process.exit(3);
}

header("Verdict");
console.log("✓ Key is valid");
console.log(`✓ Model "${configuredModel}" is accessible and responding`);
console.log("\nThe curriculum composer should work. If it still doesn't, the");
console.log("issue is in the composer-specific code path, not in the key.");
