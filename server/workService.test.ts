import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("project confirmation creates no task and next-task activation is idempotent", async () => {
  process.env.ANCHOR_DB_PATH = path.join(os.tmpdir(), `anchor-work-service-${process.pid}-${Date.now()}.db`);
  const [{ storage }, interpretation, decomposition, service] = await Promise.all([
    import("./storage"),
    import("./workInterpretation"),
    import("./workDecomposition"),
    import("./workService"),
  ]);

  const context = interpretation.normalizeContextForWork(
    "User profile: Rohini is an ex-Tony Blair Institute operator. Explicit goals/preferences: AI governance and strategic advisory.",
  );
  const definition = interpretation.interpretWorkDeterministically({
    title: "Research TBI",
    sourceType: "capture",
    sourceId: null,
    context,
  });
  const plan = decomposition.decomposeWorkDeterministically(definition);
  assert.equal(plan.kind, "project");

  const before = (await storage.getTasks()).length;
  const confirmed: any = await service.activateWork({
    definition,
    decomposition: plan,
    mode: "as_interpreted",
  });
  const afterConfirmation = (await storage.getTasks()).length;

  assert.equal(confirmed.kind, "project");
  assert.equal(confirmed.taskActivated, false);
  assert.equal(afterConfirmation, before);
  assert.ok(confirmed.project?.id);
  assert.ok(confirmed.currentMilestone?.id);

  const preview: any = await service.previewNextProjectWork(confirmed.project.id, false);
  assert.equal(preview.requiresActivation, true);
  assert.ok(preview.decomposition);

  const first: any = await service.activateNextProjectTask({
    projectId: confirmed.project.id,
    milestoneId: preview.milestone.id,
    decomposition: preview.decomposition,
  });
  const afterFirstActivation = (await storage.getTasks()).length;
  assert.equal(first.reused, false);
  assert.equal(afterFirstActivation, before + 1);

  const second: any = await service.activateNextProjectTask({
    projectId: confirmed.project.id,
    milestoneId: preview.milestone.id,
    decomposition: preview.decomposition,
  });
  const afterSecondActivation = (await storage.getTasks()).length;
  assert.equal(second.reused, true);
  assert.equal(second.task.id, first.task.id);
  assert.equal(afterSecondActivation, afterFirstActivation);
});

test("a project milestone cannot advance while its active task is incomplete", async () => {
  const [{ storage }, interpretation, decomposition, service] = await Promise.all([
    import("./storage"),
    import("./workInterpretation"),
    import("./workDecomposition"),
    import("./workService"),
  ]);
  const definition = interpretation.interpretWorkDeterministically({
    title: "Build a complete AI governance portfolio",
    sourceType: "capture",
    context: "Explicit goals/preferences: AI governance roles.",
  });
  const plan = decomposition.decomposeWorkDeterministically(definition);
  assert.equal(plan.kind, "project");
  const confirmed: any = await service.activateWork({ definition, decomposition: plan, mode: "as_interpreted" });
  const preview: any = await service.previewNextProjectWork(confirmed.project.id, false);
  const active: any = await service.activateNextProjectTask({
    projectId: confirmed.project.id,
    milestoneId: preview.milestone.id,
    decomposition: preview.decomposition,
  });

  await assert.rejects(
    () => service.completeProjectMilestone(confirmed.project.id, preview.milestone.id),
    (error: any) => error?.code === "milestone_review_required",
  );

  await storage.updateTask(active.task.id, { done: true, status: "done" } as any);
  const completed: any = await service.completeProjectMilestone(confirmed.project.id, preview.milestone.id);
  assert.equal(completed.completedMilestone.id, preview.milestone.id);
  assert.ok(completed.nextMilestone || completed.project?.project?.status === "completed");
});
