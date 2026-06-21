import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExternalResearchQueryPlan,
  buildUserAuthoredContextBlocks,
  collectTaskBreakdownContext,
  deriveExternalResearchIntent,
  rankAndFilterExternalResearchHits,
  shouldTriggerExternalResearch,
  type ExternalResearchHit,
} from "./contextProviders";
import { buildTaskBreakdownPrompt } from "./taskBreakdownRoutes";

function jobBundle() {
  return {
    sourceContext: "This is a JOB / OPPORTUNITY item.",
    playbook: "Use the parent application workflow first.",
    sourceKind: "job" as const,
    source: {
      title: "Policy Researcher",
      company: "OpenAI",
      url: "https://openai.com/careers/policy-researcher",
    },
    parentContext: "Inherited workflow context",
    cvText: "",
    jdText: "",
  };
}

function learnBundle() {
  return {
    sourceContext: "This is a LEARNING / DEVELOPMENT item.",
    playbook: "Use the parent learning workflow first.",
    sourceKind: "learn" as const,
    source: {
      title: "GovAI Fellowship",
      url: "https://govai.co/fellowship",
    },
    parentContext: "",
    cvText: "",
    jdText: "",
  };
}

test("external research triggers for current public company research tasks", () => {
  const task = {
    title: "Research recent company news before applying",
    category: "job",
    doneWhen: "One note with current public company context exists",
    minimumOutcome: "",
    sourceUrl: "",
    sourceNote: "",
    sourceType: "job",
  };
  assert.equal(deriveExternalResearchIntent(task as any, jobBundle()), "company_research");
  assert.equal(shouldTriggerExternalResearch(task as any, jobBundle(), []), true);
});

test("external research skips CV rewriting and other non-public-evidence tasks", () => {
  const task = {
    title: "Rewrite CV bullets for this application",
    category: "job",
    doneWhen: "CV bullets are tailored",
    minimumOutcome: "",
    sourceUrl: "",
    sourceNote: "",
    sourceType: "job",
  };
  assert.equal(deriveExternalResearchIntent(task as any, jobBundle()), "none");
  assert.equal(shouldTriggerExternalResearch(task as any, jobBundle(), []), false);
});

test("external research skips when user-authored context already covers a non-freshness-sensitive task", () => {
  const task = {
    title: "Compare role requirements across strategy roles",
    category: "job",
    doneWhen: "One pattern note exists",
    minimumOutcome: "",
    sourceUrl: "",
    sourceNote: "",
    sourceType: "goal",
  };
  const userBlocks = buildUserAuthoredContextBlocks("Saved direct-page notes already summarize the requirements.");
  assert.equal(shouldTriggerExternalResearch(task as any, jobBundle(), userBlocks), false);
});

test("query builder returns short public privacy-minimised queries", () => {
  const task = {
    title: "Check if GovAI fellowship deadline changed and do not use my CV bullets or personal notes",
    category: "learning",
    doneWhen: "Current deadline is verified",
    minimumOutcome: "",
    sourceUrl: "",
    sourceNote: "private note with rohini@example.com and phone 07700900123",
    sourceType: "learn",
  };
  const plan = buildExternalResearchQueryPlan(task as any, learnBundle());
  assert.ok(plan);
  assert.equal(plan?.intent, "deadline_verification");
  assert.match(plan?.primary || "", /GovAI Fellowship application deadline/i);
  assert.doesNotMatch(plan?.primary || "", /example\.com|07700900123|cv|anchor|notion/i);
});

test("ranking and filtering prefer official relevant sources and reject low-quality results", () => {
  const task = {
    title: "Research recent company news before applying",
    category: "job",
    doneWhen: "One note exists",
    minimumOutcome: "",
    sourceUrl: "",
    sourceNote: "",
    sourceType: "job",
  };
  const plan = buildExternalResearchQueryPlan(task as any, jobBundle());
  const hits: ExternalResearchHit[] = [
    {
      title: "OpenAI newsroom update",
      url: "https://openai.com/newsroom/update",
      snippet: "Recent public context about OpenAI mission and current direction.",
      date: "2026-06-01",
      source: "openai.com",
      retrievedAt: "2026-06-19T10:00:00.000Z",
    },
    {
      title: "OpenAI newsroom duplicate domain",
      url: "https://openai.com/blog/another-update",
      snippet: "Another official note.",
      date: "2026-05-01",
      source: "openai.com",
      retrievedAt: "2026-06-19T10:00:00.000Z",
    },
    {
      title: "Top 10 OpenAI hacks",
      url: "https://pinterest.com/noisy-aggregator",
      snippet: "Sponsored content. Click here for the best tips.",
      date: "2024-01-01",
      source: "pinterest.com",
      retrievedAt: "2026-06-19T10:00:00.000Z",
    },
    {
      title: "Independent analysis of OpenAI",
      url: "https://example.org/openai-analysis",
      snippet: "Research roundup mentioning OpenAI mission and policy team.",
      date: "2026-05-20",
      source: "example.org",
      retrievedAt: "2026-06-19T10:00:00.000Z",
    },
  ];
  const ranked = rankAndFilterExternalResearchHits(task as any, jobBundle(), plan!, hits, Date.parse("2026-06-19T12:00:00.000Z"));
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.url, "https://openai.com/newsroom/update");
  assert.ok(ranked.every((hit) => !/pinterest/i.test(hit.url)));
});

test("mock external research provider returns bounded ContextBlocks and degrades on failure", async () => {
  const success = await collectTaskBreakdownContext({
    task: {
      title: "Research recent company news before applying",
      category: "job",
      doneWhen: "One note exists",
      minimumOutcome: "",
      sourceUrl: "",
      sourceNote: "",
      sourceType: "job",
    } as any,
    sourceBundle: jobBundle(),
    userAuthoredContext: "",
    mockMode: "success",
    now: Date.parse("2026-06-19T12:00:00.000Z"),
  });
  assert.equal(success.externalResearch.status, "ok");
  assert.ok(success.blocks.externalResearch.length >= 1 && success.blocks.externalResearch.length <= 3);
  assert.ok(success.blocks.externalResearch.every((block) => block.kind === "external_research"));

  const failed = await collectTaskBreakdownContext({
    task: {
      title: "Research recent company news before applying",
      category: "job",
      doneWhen: "One note exists",
      minimumOutcome: "",
      sourceUrl: "",
      sourceNote: "",
      sourceType: "job",
    } as any,
    sourceBundle: jobBundle(),
    userAuthoredContext: "",
    mockMode: "error",
  });
  assert.equal(failed.externalResearch.status, "error");
  assert.equal(failed.blocks.externalResearch.length, 0);
});

test("mock external research provider skips non-public-evidence tasks even when mock mode is enabled", async () => {
  const skipped = await collectTaskBreakdownContext({
    task: {
      title: "Rewrite CV bullets for this application",
      category: "job",
      doneWhen: "CV bullets are tailored",
      minimumOutcome: "",
      sourceUrl: "",
      sourceNote: "",
      sourceType: "job",
    } as any,
    sourceBundle: jobBundle(),
    userAuthoredContext: "",
    mockMode: "success",
  });
  assert.equal(skipped.externalResearch.status, "skipped");
  assert.equal(skipped.blocks.externalResearch.length, 0);
});

test("prompt assembly orders internal context then user-authored then external research before task instructions", () => {
  const task = {
    title: "Research recent company news before applying",
    category: "job",
    doneWhen: "One note exists",
    minimumOutcome: "",
  };
  const prompt = buildTaskBreakdownPrompt({
    task: task as any,
    bundle: jobBundle() as any,
    fallbackObject: "Knowledge" as any,
    contextBlocks: {
      userAuthored: buildUserAuthoredContextBlocks("Direct-page note: already know the role basics."),
      externalResearch: [{
        kind: "external_research",
        priority: "supporting",
        label: "External public evidence R1",
        text: "Recent official note about company priorities.",
        sourceTitle: "OpenAI newsroom",
        sourceUrl: "https://openai.com/newsroom/update",
        sourceDomain: "openai.com",
        sourceDate: "2026-06-01",
        retrievedAt: "2026-06-19T12:00:00.000Z",
        metadata: { provider: "mock_external_research", citationId: "R1" },
      }],
    },
  });
  const sourceIndex = prompt.indexOf("Source context:");
  const userIndex = prompt.indexOf("User-authored context (higher priority than external research):");
  const researchIndex = prompt.indexOf("External public evidence (supporting only; do not treat as the planner):");
  const defaultIndex = prompt.indexOf("Default work object if uncertain");
  assert.ok(sourceIndex >= 0 && sourceIndex < userIndex, "Source context should appear before user-authored context");
  assert.ok(userIndex >= 0 && userIndex < researchIndex, "User-authored context should appear before external research");
  assert.ok(researchIndex >= 0 && researchIndex < defaultIndex, "External research should appear before default work object");
  assert.doesNotMatch(prompt, /Perplexity/i);
});
