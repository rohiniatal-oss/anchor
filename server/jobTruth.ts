import type { Express } from "express";
import type { Job } from "@shared/schema";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// JOB TRUTH STRIP
// A deterministic decision layer over existing job fields. This avoids creating
// another workflow system. Each role should answer: apply, warm, prove, reject,
// or clarify — plus the reason and the smallest next move.
// ─────────────────────────────────────────────────────────────────────────────

export type JobTruthAction = "apply" | "warm" | "prove" | "reject" | "clarify" | "prepare" | "follow_up";

type TruthLevel = "strong" | "medium" | "weak" | "unknown";

export type JobTruthStrip = {
  jobId: number;
  title: string;
  company: string;
  status: string;
  action: JobTruthAction;
  actionLabel: string;
  headline: string;
  nextMove: string;
  reasons: string[];
  risks: string[];
  fit: { score: number | null; level: TruthLevel; label: string };
  readiness: { value: string; level: TruthLevel; label: string };
  warmPath: { score: number | null; level: TruthLevel; label: string };
  proof: { level: TruthLevel; label: string };
  window: { status: string; deadline: string; label: string };
};

function scoreLevel(score: number | null | undefined): TruthLevel {
  if (score == null) return "unknown";
  if (score >= 75) return "strong";
  if (score >= 50) return "medium";
  return "weak";
}

function fitLabel(score: number | null | undefined) {
  if (score == null) return "Fit unknown";
  if (score >= 75) return "Strong fit";
  if (score >= 50) return "Possible fit";
  return "Weak fit";
}

function warmLabel(score: number | null | undefined) {
  if (score == null) return "Warm path unknown";
  if (score >= 70) return "Warm path available";
  if (score >= 40) return "Some warm path";
  return "Cold path";
}

function readinessLevel(value: string): TruthLevel {
  if (value === "submitted") return "strong";
  if (["cv", "cover", "questions", "sample", "referral", "follow_up"].includes(value)) return "medium";
  if (!value || value === "none") return "weak";
  return "unknown";
}

function readinessLabel(value: string) {
  if (value === "submitted") return "Submitted";
  if (value === "cv") return "CV needed";
  if (value === "cover") return "Cover letter needed";
  if (value === "questions") return "Questions needed";
  if (value === "sample") return "Sample needed";
  if (value === "referral") return "Referral needed";
  if (value === "follow_up") return "Follow-up needed";
  return "Not application-ready";
}

function daysUntil(deadline: string) {
  if (!deadline) return null;
  const due = new Date(`${deadline}T23:59:59`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
}

function windowLabel(job: Job) {
  const d = daysUntil(job.deadline || "");
  if (job.applicationWindowStatus === "closed" || job.status === "closed") return "Closed";
  if (d == null) return job.applicationWindowStatus === "rolling" ? "Rolling" : "No deadline";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d <= 7) return `Due in ${d}d`;
  return `Due ${job.deadline}`;
}

function hasRealSource(job: Job) {
  return !!(job.url || job.sourceUrl || job.note);
}

function hasBasicRoleFacts(job: Job) {
  const company = (job.company || "").trim().toLowerCase();
  return hasRealSource(job) || !!(company && company !== "unknown");
}

function proofLevel(job: Job): TruthLevel {
  if (job.narrativeAngle && job.narrativeAngle.trim()) return "strong";
  if ((job.fitScore ?? 0) >= 75 || (job.strategicValue ?? 0) >= 70) return "medium";
  return "weak";
}

function proofLabel(level: TruthLevel) {
  if (level === "strong") return "Narrative angle exists";
  if (level === "medium") return "Proof/narrative gap";
  if (level === "weak") return "Credibility unclear";
  return "Proof unknown";
}

function actionLabel(action: JobTruthAction) {
  return action === "apply" ? "Apply"
    : action === "warm" ? "Warm path"
    : action === "prove" ? "Prove fit"
    : action === "reject" ? "Reject"
    : action === "prepare" ? "Prepare"
    : action === "follow_up" ? "Follow up"
    : "Clarify";
}

export function computeJobTruthStrip(job: Job): JobTruthStrip {
  const reasons: string[] = [];
  const risks: string[] = [];
  const fit = { score: job.fitScore ?? null, level: scoreLevel(job.fitScore), label: fitLabel(job.fitScore) };
  const readiness = { value: job.applicationReadiness || "none", level: readinessLevel(job.applicationReadiness || "none"), label: readinessLabel(job.applicationReadiness || "none") };
  const warmPath = { score: job.warmPathScore ?? null, level: scoreLevel(job.warmPathScore), label: warmLabel(job.warmPathScore) };
  const proof = { level: proofLevel(job), label: proofLabel(proofLevel(job)) };
  const window = { status: job.applicationWindowStatus || "open", deadline: job.deadline || "", label: windowLabel(job) };

  if (fit.score != null) reasons.push(fit.label);
  if (job.strategicValue != null && job.strategicValue >= 70) reasons.push("Strategically valuable");
  if (warmPath.score != null) reasons.push(warmPath.label);
  if (job.deadline) reasons.push(window.label);

  if (!hasRealSource(job)) risks.push("Source details are thin");
  if (!job.relatedTrackId) risks.push("Not linked to a strategy track");
  if (!job.narrativeAngle) risks.push("No narrative angle yet");
  if (job.eligibilityRisk) risks.push(`Eligibility risk: ${job.eligibilityRisk}`);

  let action: JobTruthAction = "clarify";
  let nextMove = "Open the posting and note exactly what it asks for";
  let headline = "Clarify before investing more time";

  const closed = job.status === "closed" || job.applicationWindowStatus === "closed";
  const likelyIneligible = job.eligibilityRisk === "likely_ineligible";
  const weakFit = fit.score != null && fit.score < 45 && (job.strategicValue ?? 0) < 60;

  if (closed || likelyIneligible || weakFit) {
    action = "reject";
    headline = closed ? "Do not spend time on a closed opportunity"
      : likelyIneligible ? "Do not invest before eligibility is resolved"
      : "Low-fit role should be rejected or parked";
    nextMove = "Archive it or write one sentence on why it is not worth pursuing";
  } else if (job.status === "interviewing") {
    action = "prepare";
    headline = "You are in the room, so preparation is the value driver";
    nextMove = "Draft three story-bank bullets for this role";
  } else if (job.status === "applied" || readiness.value === "submitted" || readiness.value === "follow_up") {
    action = "follow_up";
    headline = "This has moved from applying to follow-up";
    nextMove = "Send one polite follow-up or identify a warm nudge";
  } else if (job.eligibilityRisk || !hasBasicRoleFacts(job) || !job.deadlineConfidence) {
    action = "clarify";
    headline = "Clarify the facts before spending effort";
    nextMove = job.eligibilityRisk ? "Check the eligibility requirement first" : "Open the source and confirm deadline, materials, and fit";
  } else if ((warmPath.score ?? 0) >= 60 && readiness.value !== "referral") {
    action = "warm";
    headline = "Use the warm path before applying cold";
    nextMove = "Send one warm-path message or referral ask";
  } else if (proof.level !== "strong" && ((fit.score ?? 0) >= 70 || (job.strategicValue ?? 0) >= 70)) {
    action = "prove";
    headline = "Strong enough to pursue, but the lane still needs stronger reusable capability evidence";
    nextMove = "Strengthen one reusable capability signal for this lane";
  } else if (readiness.level === "weak") {
    action = "clarify";
    headline = "Turn this from saved role into application requirements";
    nextMove = "List the exact materials needed to apply";
  } else {
    action = "apply";
    headline = "Good enough to move into application mode";
    nextMove = readiness.value === "cv" ? "Tailor the CV for this role"
      : readiness.value === "cover" ? "Draft the cover letter skeleton"
      : readiness.value === "questions" ? "Draft answers to the application questions"
      : readiness.value === "sample" ? "Choose or draft the writing sample"
      : "Create the next concrete application task";
  }

  if (reasons.length === 0) reasons.push("Insufficient scoring data");

  return {
    jobId: job.id,
    title: job.title,
    company: job.company,
    status: job.status,
    action,
    actionLabel: actionLabel(action),
    headline,
    nextMove,
    reasons,
    risks,
    fit,
    readiness,
    warmPath,
    proof,
    window,
  };
}

export function registerJobTruthRoutes(app: Express) {
  app.get("/api/jobs/truth-strips", async (_req, res) => {
    const jobs = await storage.getJobs();
    res.json(jobs.map(computeJobTruthStrip));
  });

  app.get("/api/jobs/:id/truth-strip", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const job = (await storage.getJobs()).find((j) => j.id === id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json(computeJobTruthStrip(job));
  });
}
