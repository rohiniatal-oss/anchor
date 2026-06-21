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
    "You are matching a person's background to a specific role.",
    "Given their CV and the job description, write ONE sentence (under 30 words) explaining why this person is credible for this role.",
    "Focus on the strongest overlap: relevant experience, transferable skills, or domain knowledge.",
    "Do NOT be generic. Name the specific experience or skill that bridges the gap.",
    "If there is no credible bridge, respond with exactly: SKIP",
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
