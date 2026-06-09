import { db } from "./storage";
import { tasks, jobs, learn, contacts, hustles, jobPipelineSteps, proofAssetSteps, type Task, type JobPipelineStep, type ProofAssetStep } from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";
import { buildDeterministicTaskBreakdown, attachWorkflowState } from "./taskBreakdownRoutes";

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
    const title = j.nextStep?.trim() || `Advance application: ${j.title}${j.company ? " @ " + j.company : ""}`;
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
    const title = l.requiredOutput ? `Produce output: ${l.requiredOutput}` : `Produce output for: ${l.title}`;
    values = {
      ...base,
      title,
      category: "learning",
      doneWhen: l.requiredOutput ? `${l.requiredOutput} exists` : "A concrete output exists",
      sourceUrl: l.url || "",
      sourceNote: l.note || "",
      sourceStatus: l.learnStatus,
      relatedTrackId: l.relatedTrackId ?? null,
      relatedOpportunityId: l.id,
      minimumOutcome: "A first version of the output",
      estimateMinutes: null,
      estimateConfidence: "",
    };
  } else if (sourceType === "contact") {
    const c = db.select().from(contacts).where(eq(contacts.id, sourceId)).get();
    if (!c) return null;
    const target = c.who || c.name || "contact";
    const title = `Draft ${c.askType || "soft"} outreach to ${target}`;
    values = {
      ...base,
      title,
      category: "admin",
      doneWhen: "A message is drafted and ready to send",
      sourceUrl: "",
      sourceNote: c.why || c.note || "",
      sourceStatus: c.status,
      relatedTrackId: c.relatedTrackId ?? null,
      relatedOpportunityId: null,
      minimumOutcome: "A draft message",
      estimateMinutes: null,
      estimateConfidence: "",
    };
  } else if (sourceType === "hustle") {
    const h = db.select().from(hustles).where(eq(hustles.id, sourceId)).get();
    if (!h) return null;
    const category = /substack/i.test(h.title) ? "substack" : /afterline/i.test(h.title) ? "afterline" : "hustle";
    const title = h.nextStep?.trim() || `Advance proof asset: ${h.title}`;
    values = {
      ...base,
      title,
      category,
      doneWhen: h.nextStep?.trim() ? "That step is done" : "Proof asset moved one step forward",
      sourceUrl: "",
      sourceNote: h.note || "",
      sourceStatus: h.stage,
      relatedTrackId: h.proofAssetForTrack ?? null,
      relatedOpportunityId: null,
      minimumOutcome: "One concrete step on this asset",
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
    const suffix = j ? `: ${j.title}${j.company ? " @ " + j.company : ""}` : "";
    const updated = db.update(tasks).set({ title: `${step.stepLabel.trim()}${suffix}` })
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
    const suffix = h ? `: ${h.title}` : "";
    const updated = db.update(tasks).set({ title: `${step.stepLabel.trim()}${suffix}` })
      .where(eq(tasks.id, result.task.id)).returning().get();
    if (updated) result.task = updated;
  }

  db.update(proofAssetSteps)
    .set({ taskId: result.task.id, status: "done" })
    .where(eq(proofAssetSteps.id, step.id))
    .run();
  return result;
}
