import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendCareerDiscoveryRoute, type CareerDiscoveryRoutePreview } from "./discoveryRecommendation";

function previews(overrides?: Partial<Record<string, CareerDiscoveryRoutePreview>>) {
  return {
    "broad-role-pursuit": { tinyNextAction: { size: "deep" } },
    "fit-clarification": { tinyNextAction: { size: "quick" } },
    "warm-path-build": { tinyNextAction: { size: "quick" } },
    "capability-ramp": { tinyNextAction: { size: "quick" } },
    ...(overrides || {}),
  } as any;
}

test("urgent but plain uncertainty still keeps real-role pursuit as the default starting move", () => {
  const result = recommendCareerDiscoveryRoute(
    "I need to get a job but I do not know which role fits me best",
    previews(),
  );

  assert.equal(result.key, "broad-role-pursuit");
});

test("overwhelmed split options prefer a lower-overwhelm comparison move", () => {
  const result = recommendCareerDiscoveryRoute(
    "I need a job soon but I am overwhelmed and torn between AI strategy, geopolitics, and chief of staff",
    previews(),
  );

  assert.equal(result.key, "fit-clarification");
  assert.match(result.reason, /least overwhelming|inspect one role type/i);
});

test("explicit networking still wins when access is the main bottleneck", () => {
  const result = recommendCareerDiscoveryRoute(
    "I need a job soon and networking is probably the bottleneck",
    previews(),
  );

  assert.equal(result.key, "warm-path-build");
});
