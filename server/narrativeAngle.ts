import { llm, LLM_MODELS } from "./llm";
import { storage } from "./storage";
import type { Job } from "@shared/schema";

export async function autoGenerateNarrativeAngle(job: Job): Promise<string | null> {
  if ((job.narrativeAngle || "").trim()) return null;
  const jd = (job.jdText || "").trim();
  if (jd.length < 40) return null;

  const profile = await storage.getProfile();
  const cv = (profile?.cvText || "").trim();
  if (cv.length < 40) return null;

  const prompt = [
    "You are writing a one-sentence narrative angle for a job application.",
    "",
    "TASK: Find the single strongest overlap between this person's CV and the job description. Write ONE sentence (under 30 words) that names the specific experience, project, or skill and connects it to the role's core need.",
    "",
    "FORMAT: '[Specific thing from CV] makes [person] credible for [specific aspect of role].'",
    "GOOD: 'Three years leading AI policy research at [org] maps directly to the governance advisory work this role requires.'",
    "BAD: 'Strong analytical skills and leadership experience make them a great fit.' (too generic — no named experience, no named role need)",
    "",
    "RULES:",
    "- Name a real item from the CV (a role, project, skill, or domain). Never say 'relevant experience' or 'transferable skills' without naming what.",
    "- Name a real requirement from the JD. Never say 'this role' without saying which part.",
    "- If no credible connection exists, respond with exactly: SKIP",
    "",
    `Role: ${job.title}${job.company ? ` at ${job.company}` : ""}`,
    "",
    `CV (first 2000 chars):`,
    cv.slice(0, 2000),
    "",
    `Job description (first 2000 chars):`,
    jd.slice(0, 2000),
  ].join("\n");

  const result = await llm(prompt, { model: LLM_MODELS.support });
  const trimmed = result.trim();
  if (!trimmed || trimmed === "SKIP" || trimmed.length > 200) return null;

  await storage.updateJob(job.id, { narrativeAngle: trimmed });
  return trimmed;
}
