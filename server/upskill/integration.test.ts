import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "../spine.harness";
import { recompose, __setHorizonLlmForTest } from "./planner";
import { materializeForToday, linkUpskillItemToPlanItem, completeUpskillItem } from "./materializer";
import * as repo from "./repository";

let h: Harness;
before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); __setHorizonLlmForTest(null); });

let llmCalls = 0;
function countingHorizon(trackId: number) {
  llmCalls = 0;
  __setHorizonLlmForTest(async () => {
    llmCalls++;
    return {
      ok: true as const,
      value: {
        items: Array.from({ length: 10 }, (_, i) => ({
          trackId, phaseLabel: "Foundations", title: `Gen${llmCalls}-Item${i}`, activity: "do", doneWhen: "done",
          morning: { hours: 2, focus: "read", items: ["src"] }, afternoon: { hours: 2, focus: "write", items: ["draft"] },
          sources: [], artifact: { techniqueKey: "bluf", saveAs: `a-${i}.md` }, rationale: "r",
        })),
      },
    };
  });
}

test("end-to-end: intake -> recompose -> materialize -> complete -> auto-recompose -> checkin-recompose", async () => {
  const track = await h.storage.createCareerTrack({ name: "AI gov", slug: "ai", status: "active", priority: 2, aspiration: "lead AI policy" } as any);
  countingHorizon(track.id);

  // 1. First recompose seeds the horizon.
  const first = await recompose();
  assert.equal(first.ok, true);
  assert.equal(repo.countByStatus("queued"), 10);
  assert.equal(llmCalls, 1);

  // 2. Materialize today's anchor and link it to a (fake) day_plan_item.
  const anchors = materializeForToday("2026-06-27");
  assert.equal(anchors.length, 1);
  linkUpskillItemToPlanItem(anchors[0].id, 555);
  assert.equal(repo.getItem(anchors[0].id)!.status, "active");

  // 3. Complete 5 items — the 5th completion auto-triggers a recompose.
  const queued = repo.listHorizon().filter((i) => i.status === "queued" || i.status === "active").slice(0, 5);
  for (const item of queued) completeUpskillItem(item.id);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(repo.countByStatus("completed"), 5);
  assert.equal(llmCalls, 2); // auto-recompose fired

  // 4. A check-in via the API triggers another recompose.
  const res = await api(h.base, "POST", "/api/upskill/checkin", { whatsNot: "too theoretical", energy: "normal" });
  assert.equal(res.status, 201);
  assert.equal(res.json.recompose, "ok");
  assert.equal(llmCalls, 3);
  assert.equal(repo.listCheckins().length, 1);
});
