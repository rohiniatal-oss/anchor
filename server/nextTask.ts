import { db } from "./storage";
import { tasks, jobs, learn, contacts, hustles, jobPipelineSteps, proofAssetSteps, recommendationMilestones, type Task, type JobPipelineStep, type ProofAssetStep } from "@shared/schema";
import { eq, and, ne, asc } from "drizzle-orm";
import { buildDeterministicTaskBreakdown, attachWorkflowState } from "./taskBreakdownRoutes";
import { materializedJobStepTaskTitle, materializedProofStepTaskTitle, nextContactTaskTitle, nextHustleTaskTitle, nextJobTaskTitle, nextLearnTaskTitle } from "@shared/taskPreview";
import { contractForTaskIntent } from "./taskIntent";

// ─────────────────────────────────────────────────────────────────────────
// NEXT-TASK ENGINE — turn any source object (job/learn/contact/hustle) into a
// concrete task that carries full provenance. The guardrail keeps a single
// open task per source so tapping "create next task" twice never duplicates.
// ─────────────────────────────────────────────────────────────────────────

export type NextTaskSourceType = "job" | "learn" | "contact" | "hustle";

// Find an OPEN (not done) task already serving this exact source.
export function findOpenTaskForSource(sourceType: NextTaskSourceType, sourceId: number): Task | undefined {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.sourceType, sourceType), eq(tasks.sourceId, sourceId), ne(tasks.status, "done")))
    .all()
    .find((t) => !t.done);
}

type CreateResult = { task: Task; reused: boolean };

// Create (or reuse) the next task for a source. Returns { task, reused }.
export async function createNextTask(args: { sourceType: NextTaskSourceType; sourceId: number }): Promise<CreateResult | null> {
  const { sourceType, sourceId } = args;

  const existing = findOpenTaskForSource(sourceType, sourceId);
  if (existing) return { task: existing, reused: true };

  const base = {
    list: "inbox" as const,
    status: "not_started" as const,
    readiness: "ready" as const,
    done: false,
    sourceType,
    sourceId,
    createdAt: Date.now(),
  };

  let values: any = null;

  if (sourceType === "job") {
    const j = db.select().from(jobs).where(eq(jobs.id, sourceId)).get();
    if (!j) return null;
    const title = nextJobTaskTitle(j);
    values = {
      ...base,
      title,
      category: "job",
      readiness: j.eligibilityRisk === "likely_ineligible" ? "blocked" : base.readiness,
      doneWhen: j.nextStep?.trim() ? "That step is done" : "Application moved one step forward",
      sourceUrl: j.sourceUrl || j.url || "",
      sourceNote: j.note || "",
      sourceStatus: j.status,
      relatedTrackId: j.relatedTrackId ?? null,
      relatedOpportunityId: j.id,
      minimumOutcome: "One concrete step on this role",
      estimateMinutes: null,
      estimateConfidence: "",
    };
  } else if (sourceType === "learn") {
    const l = db.select().from(learn).where(eq(learn.id, sourceId)).get();
    if (!l) return null;
    const recommendationMilestone = l.sourceType === "recommendation" && l.sourceId
      ? db.select().from(recommendationMilestones)
        .where(eq(recommendationMilestones.recommendationId, l.sourceId))
        .orderBy(asc(recommendationMilestones.sequence), asc(recommendationMilestones.id))
        .all()
        .find((milestone) => milestone.status === "active")
        || db.select().from(recommendationMilestones)
          .where(eq(recommendationMilestones.recommendationId, l.sourceId))
          .orderBy(asc(recommendationMilestones.sequence), asc(recommendationMilestones.id))
          .all()
          .find((milestone) => milestone.status === "todo")
      : null;
    const hasReusableResult = !!(l.requiredOutput && l.requiredOutput.trim());
    const title = recommendationMilestone?.suggestedTaskTitle?.trim() || nextLearnTaskTitle(l);
    const doneWhen = recommendationMilestone?.doneWhen?.trim()
      || (hasReusableResult ? `${l.requiredOutput} exists` : "One useful note, practice step, or learning note exists");
    values = {
      ...base,
      title,
      category: "learning",
      doneWhen,
      sourceUrl: l.url || "",
      sourceNote: l.note || "",
      sourceStatus: l.learnStatus,
      sourceStepType: recommendationMilestone ? "recommendation_milestone" : "",
      sourceStepId: recommendationMilestone?.id ?? null,
      relatedTrackId: l.relatedTrackId ?? null,
      relatedOpportunityId: l.id,
      minimumOutcome: recommendationMilestone?.doneWhen?.trim()
        || (hasReusableResult ? "A first version of the reusable result" : "One useful step forward on the learning item"),
      estimateMinutes: null,
      estimateConfidence: "",
    };
  } else if (sourceType === "contact") {
    const c = db.select().from(contacts).where(eq(contacts.id, sourceId)).get();
    if (!c) return null;
    const title = nextContactTaskTitle(c);
    const intent = contractForTaskIntent({
      title,
      sourceType: "contact",
      sourceNote: `${c.why || c.note || ""} ${c.targetOrg || ""} ${c.targetRole || ""}`,
    });
    values = {
      ...base,
      title,
      category: "admin",
      doneWhen: intent.doneWhen,
      sourceUrl: "",
      sourceNote: c.why || c.note || "",
      sourceStatus: c.status,
      relatedTrackId: c.relatedTrackId ?? null,
      relatedOpportunityId: null,
      minimumOutcome: intent.doneWhen,
      estimateMinutes: null,
      estimateConfidence: "",
    };
  } else if (sourceType === "hustle") {
    const h = db.select().from(hustles).where(eq(hustles.id, sourceId)).get();
    if (!h) return null;
    const category = /substack/i.test(h.title) ? "substack" : /afterline/i.test(h.title) ? "afterline" : "hustle";
    const title = nextHustleTaskTitle(h);
    values = {
      ...base,
      title,
      category,
      doneWhen: h.nextStep?.trim() ? "That step is done" : "The project or public-work item moved one step forward",
      sourceUrl: "",
      sourceNote: h.note || "",
      sourceStatus: h.stage,
      relatedTrackId: h.proofAssetForTrack ?? null,
      relatedOpportunityId: null,
      minimumOutcome: "One concrete step on this project or public-work item",
      estimateMinutes: null,
      estimateConfidence: "",
    };
  }

  if (!values) return null;
  try {
    const breakdown = await buildDeterministicTaskBreakdown(values as Task);
    if (breakdown.steps.length) {
      values.steps = JSON.stringify(attachWorkflowState(breakdown.steps, breakdown.workflowState));
      values.minimumOutcome = breakdown.workflowState.stageOutput || values.minimumOutcome;
    }
  } catch {
    // Keep task creation reliable even if deterministic breakdown cannot be derived.
  }
  const task = db.insert(tasks).values(values).returning().get();
  return { task, reused: false };
}

// ─────────────────────────────────────────────────────────────────────────
// MATERIALIZE A JOB PIPELINE STEP — turn a readiness-rail step into a task via
// the SAME createNextTask provenance + dedupe machinery (sourceType "job",
// sourceId = step.jobId). Title the task after the step label so the rail and
// the task stay legible. Writes the step's taskId back for the dedupe/back-ref.
// Reuses an existing open task for the job rather than spawning a duplicate.
// ─────────────────────────────────────────────────────────────────────────
export async function materializeJobStep(step: JobPipelineStep): Promise<CreateResult | null> {
  const result = await createNextTask({ sourceType: "job", sourceId: step.jobId });
  if (!result) return null;

  // For a freshly-created task, sharpen the title to the step's label so the
  // user sees the concrete action they tapped (createNextTask defaults to the
  // job's nextStep). Reused tasks keep their existing title untouched.
  if (!result.reused && step.stepLabel.trim()) {
    const j = db.select().from(jobs).where(eq(jobs.id, step.jobId)).get();
    const updated = db.update(tasks).set({ title: materializedJobStepTaskTitle(step.stepLabel, j) })
      .where(eq(tasks.id, result.task.id)).returning().get();
    if (updated) result.task = updated;
  }

  db.update(jobPipelineSteps)
    .set({ taskId: result.task.id, status: "done" })
    .where(eq(jobPipelineSteps.id, step.id))
    .run();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// MATERIALIZE A PROOF ASSET STEP (P4.3) — turn a proof-production rail step
// into a task via the SAME createNextTask provenance + dedupe machinery
// (sourceType "hustle", sourceId = step.hustleId). The hustle branch of
// createNextTask already carries proofAssetForTrack through as relatedTrackId.
// Sharpen the title to the step label, then write the step's taskId back for
// the dedupe/back-ref. Reuses an open hustle task rather than duplicating.
// ─────────────────────────────────────────────────────────────────────────
export async function materializeProofStep(step: ProofAssetStep): Promise<CreateResult | null> {
  const result = await createNextTask({ sourceType: "hustle", sourceId: step.hustleId });
  if (!result) return null;

  if (!result.reused && step.stepLabel.trim()) {
    const h = db.select().from(hustles).where(eq(hustles.id, step.hustleId)).get();
    const updated = db.update(tasks).set({ title: materializedProofStepTaskTitle(step.stepLabel, h) })
      .where(eq(tasks.id, result.task.id)).returning().get();
    if (updated) result.task = updated;
  }

  db.update(proofAssetSteps)
    .set({ taskId: result.task.id, status: "done" })
    .where(eq(proofAssetSteps.id, step.id))
    .run();
  return result;
}
