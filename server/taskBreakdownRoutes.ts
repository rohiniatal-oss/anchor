import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";

function parseSteps(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, 6);
    if (Array.isArray(parsed?.steps)) return parsed.steps.map(String).filter(Boolean).slice(0, 6);
    if (typeof parsed?.question === "string") return [];
  } catch {}
  return text
    .split(/\n+/)
    .map((s) => s.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((s) => s.length > 0 && s.length < 120)
    .slice(0, 6);
}

function fallbackSteps(task: any, sourceContext: string): string[] {
  const title = String(task?.title || "this task");
  const text = `${title} ${task?.category || ""} ${task?.sourceType || ""} ${sourceContext}`.toLowerCase();
  if (/job|application|cv|cover|posting|role/.test(text)) {
    return [
      "Open the saved role or posting",
      "List what the application asks for",
      "Mark the strongest matching experience",
      "Note one gap to handle",
      "Draft the next application material",
    ];
  }
  if (/learn|reading|resource|course|study|development|practice/.test(text)) {
    return [
      "Open the resource or notes page",
      "Choose the one useful section",
      "Read only that section first",
      "Write five reusable bullets",
    ];
  }
  if (/network|contact|message|intro|referral|coffee/.test(text)) {
    return [
      "Open the contact or message draft",
      "Write the one-line reason for reaching out",
      "Add one specific ask",
      "Send or save the draft",
    ];
  }
  if (/proof|memo|story|portfolio|substack|case/.test(text)) {
    return [
      "Open a blank note",
      "Write the core claim in one sentence",
      "Add one example from your experience",
      "Save the reusable paragraph or bullet",
    ];
  }
  return [
    "Open the place where this task lives",
    "Write what done means in one line",
    "Do the smallest visible piece",
    "Stop after one concrete output",
  ];
}

async function buildSourceContext(task: any) {
  let sourceContext = "";
  let playbook = "";
  if (task.sourceType === "job" && task.sourceId) {
    const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
    if (j) {
      sourceContext = `This is a JOB APPLICATION. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}`;
      playbook = "APPLICATION playbook: open posting → list requirements → map evidence → identify gap → draft next material.";
    }
  } else if (task.sourceType === "learn" && task.sourceId) {
    const l = (await storage.getLearn()).find((x) => x.id === task.sourceId);
    if (l) {
      sourceContext = `This is a LEARNING item. Title: ${l.title}. ${l.url ? "URL: " + l.url + ". " : ""}${l.note ? "Notes: " + l.note + ". " : ""}${l.capabilityBuilt ? "Capability: " + l.capabilityBuilt + ". " : ""}Required output: ${l.requiredOutput || "a concrete output"}.`;
      playbook = "LEARNING playbook: orient → choose useful section → consume lightly → produce reusable output.";
    }
  } else if (task.sourceType === "hustle" && task.sourceId) {
    const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
    if (h) {
      sourceContext = `This is a PROOF-ASSET / project step. ${h.title}. Stage: ${h.stage}. ${h.note || ""}`;
      playbook = "PROOF playbook: choose claim → outline smallest proof → draft one reusable fragment.";
    }
  } else if (task.sourceUrl || task.sourceNote) {
    sourceContext = `${task.sourceNote ? "Context: " + task.sourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  return { sourceContext, playbook };
}

export function registerTaskBreakdownRoutes(app: Express) {
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 500);
    const { sourceContext, playbook } = await buildSourceContext(task);

    let steps: string[] = [];
    try {
      const client = new OpenAI();
      const r = await client.responses.create({
        model: "gpt_5_1",
        input:
          `Break this task into 3-6 tiny, ordered steps for Rohini. ` +
          `Steps must be concrete, grounded in the source, and easy to start. ` +
          `First step must be opening the actual thing or creating the smallest output. ` +
          `Do not ask a question unless absolutely impossible; prefer sensible defaults. ` +
          `Return ONLY JSON like {"steps":["...","..."]}.\n\n` +
          `${playbook ? `Playbook: ${playbook}\n` : ""}` +
          `Task: ${task.title}\nCategory: ${task.category}\nDone when: ${task.doneWhen || task.minimumOutcome || "smallest useful outcome is complete"}\n` +
          `Source context: ${sourceContext || "none"}\n` +
          `${context ? `User context: ${context}\n` : ""}`,
      });
      steps = parseSteps(r.output_text || "");
    } catch {
      steps = [];
    }

    if (!steps.length) steps = fallbackSteps(task, sourceContext);
    const updated = await storage.updateTask(id, { steps: JSON.stringify(steps.map((text) => ({ text, done: false }))) });
    res.json(updated);
  });
}
