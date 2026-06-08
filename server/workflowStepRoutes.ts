import type { Express } from "express";
import { storage } from "./storage";
import { materializeJobStep, materializeProofStep } from "./nextTask";
import { insertJobPipelineStepSchema, insertProofAssetStepSchema } from "@shared/schema";
import { isSubmitStep } from "@shared/jobTemplates";

export function registerWorkflowStepRoutes(app: Express) {
  app.get("/api/jobs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getJobSteps(id));
  });

  app.post("/api/jobs/:id/steps/seed", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const steps = await storage.seedJobSteps(id);
    if (!steps.length) {
      const job = (await storage.getJobs()).find((j) => j.id === id);
      if (!job) return res.status(404).json({ error: "Job not found" });
    }
    res.json(steps);
  });

  app.post("/api/jobs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const stepLabel = String(req.body?.stepLabel || "").trim().slice(0, 120);
    if (!stepLabel) return res.status(400).json({ error: "Need a stepLabel" });
    const note = String(req.body?.note || "").slice(0, 300);
    const sequence = Number.isFinite(Number(req.body?.sequence)) ? Number(req.body.sequence) : undefined;
    res.json(await storage.createJobStep(id, { stepLabel, note, sequence }));
  });

  app.patch("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertJobPipelineStepSchema.partial().omit({ jobId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateJobStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (p.data.status === "done" && isSubmitStep(updated.stepLabel)) {
      const job = (await storage.getJobs()).find((x) => x.id === updated.jobId);
      if (job && job.status === "wishlist") {
        await storage.updateJob(job.id, { status: "applied", applicationReadiness: "submitted" } as any);
        await storage.logActivity({ eventType: "completed", sourceType: "job", sourceId: job.id, metadata: JSON.stringify({ stepId, submitted: true }) } as any);
      }
    }
    res.json(updated);
  });

  app.post("/api/jobs/:id/mark-submitted", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const job = (await storage.getJobs()).find((x) => x.id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "wishlist") {
      await storage.updateJob(id, { status: "applied", applicationReadiness: "submitted" } as any);
    }
    await storage.logActivity({ eventType: "completed", sourceType: "job", sourceId: id, metadata: JSON.stringify({ submitted: true, explicit: true }) } as any);
    const updated = (await storage.getJobs()).find((x) => x.id === id);
    res.json({ ok: true, job: updated });
  });

  app.delete("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteJobStep(stepId);
    res.json({ ok: true });
  });

  app.patch("/api/jobs/:id/steps/reorder", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const ordered = Array.isArray(req.body?.orderedStepIds) ? req.body.orderedStepIds.map(Number).filter(Number.isFinite) : null;
    if (!ordered) return res.status(400).json({ error: "Need orderedStepIds:number[]" });
    res.json(await storage.reorderJobSteps(id, ordered));
  });

  app.post("/api/steps/:stepId/materialize", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getJobStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const result = await materializeJobStep(step);
    if (!result) return res.status(404).json({ error: "Job not found" });
    await storage.logActivity({ eventType: "planned", sourceType: "job", sourceId: step.jobId, taskId: result.task.id, metadata: JSON.stringify({ stepId, reused: result.reused }) } as any);
    res.json({ ...result.task, reused: result.reused, stepId });
  });

  app.post("/api/steps/:stepId/block", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getJobStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const updated = await storage.updateJobStep(stepId, { status: "blocked", note: reason } as any);
    if (step.taskId) {
      await storage.updateTask(step.taskId, { readiness: "blocked", blockerReason: reason, status: "stuck" } as any);
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "job", sourceId: step.jobId, taskId: step.taskId ?? undefined, metadata: JSON.stringify({ stepId, reason }) } as any);
    res.json(updated);
  });

  app.get("/api/hustles/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getProofAssetSteps(id));
  });

  app.post("/api/hustles/:id/steps/seed", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const steps = await storage.seedProofAssetSteps(id);
    if (!steps.length) {
      const hustle = (await storage.getHustles()).find((x) => x.id === id);
      if (!hustle) return res.status(404).json({ error: "Proof asset not found" });
    }
    res.json(steps);
  });

  app.post("/api/hustles/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const stepLabel = String(req.body?.stepLabel || "").trim().slice(0, 120);
    if (!stepLabel) return res.status(400).json({ error: "Need a stepLabel" });
    const note = String(req.body?.note || "").slice(0, 300);
    const sequence = Number.isFinite(Number(req.body?.sequence)) ? Number(req.body.sequence) : undefined;
    res.json(await storage.createProofAssetStep(id, { stepLabel, note, sequence }));
  });

  app.patch("/api/proof-steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertProofAssetStepSchema.partial().omit({ hustleId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateProofAssetStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/proof-steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteProofAssetStep(stepId);
    res.json({ ok: true });
  });

  app.patch("/api/hustles/:id/steps/reorder", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const ordered = Array.isArray(req.body?.orderedStepIds) ? req.body.orderedStepIds.map(Number).filter(Number.isFinite) : null;
    if (!ordered) return res.status(400).json({ error: "Need orderedStepIds:number[]" });
    res.json(await storage.reorderProofAssetSteps(id, ordered));
  });

  app.post("/api/proof-steps/:stepId/materialize", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getProofAssetStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const result = await materializeProofStep(step);
    if (!result) return res.status(404).json({ error: "Proof asset not found" });
    await storage.logActivity({ eventType: "planned", sourceType: "hustle", sourceId: step.hustleId, taskId: result.task.id, metadata: JSON.stringify({ stepId, reused: result.reused }) } as any);
    res.json({ ...result.task, reused: result.reused, stepId });
  });

  app.post("/api/proof-steps/:stepId/block", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getProofAssetStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const updated = await storage.updateProofAssetStep(stepId, { status: "blocked", note: reason } as any);
    if (step.taskId) {
      await storage.updateTask(step.taskId, { readiness: "blocked", blockerReason: reason, status: "stuck" } as any);
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "hustle", sourceId: step.hustleId, taskId: step.taskId ?? undefined, metadata: JSON.stringify({ stepId, reason }) } as any);
    res.json(updated);
  });
}
