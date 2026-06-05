import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";

type SourceBundle = {
  sourceContext: string;
  playbook: string;
  sourceKind: "job" | "learn" | "hustle" | "task";
  source: any;
};

function compact(value: unknown, max = 90) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseSteps(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return cleanSteps(parsed.map(String));
    if (Array.isArray(parsed?.steps)) return cleanSteps(parsed.steps.map(String));
    if (typeof parsed?.question === "string") return [];
  } catch {}
  return cleanSteps(text.split(/\n+/).map((s) => s.replace(/^[-*\d.)\s]+/, "").trim()));
}

function cleanSteps(steps: string[]) {
  return steps
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0 && s.length < 140)
    .slice(0, 6);
}

function keyword(text: string, re: RegExp) {
  return re.test(text.toLowerCase());
}

function inferConcreteNoun(task: any, bundle: SourceBundle) {
  const title = compact(task?.title, 120);
  if (bundle.sourceKind === "job") return compact(`${bundle.source?.title || "role"}${bundle.source?.company ? " at " + bundle.source.company : ""}`, 120);
  if (bundle.sourceKind === "learn") return compact(bundle.source?.title || title, 120);
  if (bundle.sourceKind === "hustle") return compact(bundle.source?.title || title, 120);
  return title || "this task";
}

function intelligentFallbackSteps(task: any, bundle: SourceBundle): string[] {
  const title = compact(task?.title, 140);
  const doneWhen = compact(task?.doneWhen || task?.minimumOutcome, 140);
  const noun = inferConcreteNoun(task, bundle);
  const allText = `${title} ${doneWhen} ${task?.category || ""} ${task?.sourceNote || ""} ${bundle.sourceContext}`.toLowerCase();

  if (bundle.sourceKind === "job") {
    const job = bundle.source || {};
    const role = compact(job.title || title || "role", 90);
    const company = compact(job.company || "the organisation", 70);
    if (keyword(allText, /interview|story bank|star|prep/)) {
      return [
        `Open the ${role} posting`,
        "Pick three requirements to prove",
        "Match one story to each requirement",
        "Draft each story in STAR format",
        "Mark the weakest story to tighten",
      ];
    }
    if (keyword(allText, /cv|resume|tailor/)) {
      return [
        `Open your CV and ${role} posting`,
        "Highlight the role's repeated keywords",
        "Choose three bullets to tailor",
        `Rewrite bullets for ${company}'s needs`,
        "Save the role-specific CV version",
      ];
    }
    if (keyword(allText, /cover|question|answer|application material/)) {
      return [
        `Open the ${role} application form`,
        "Copy every question into notes",
        "Write the strongest angle first",
        "Add evidence from TBI/Bain/Abraaj",
        "Flag any answer that needs proof",
      ];
    }
    if (keyword(allText, /constraint|eligibility|visa|location|salary|gap/)) {
      return [
        `Open the ${role} requirements`,
        "Find the exact constraint wording",
        "Decide explain, reframe, or ask",
        "Write the clean mitigation line",
        "Add it to the application notes",
      ];
    }
    return [
      `Open the ${role} posting`,
      "Extract must-haves and nice-to-haves",
      "Map your strongest matching evidence",
      "Identify one credibility gap",
      "Choose CV, cover, or outreach next",
    ];
  }

  if (bundle.sourceKind === "learn") {
    const learn = bundle.source || {};
    const output = compact(learn.requiredOutput || doneWhen || "usable output", 90);
    if (keyword(allText, /course|fellowship|programme|program|enrol|apply/)) {
      return [
        `Open ${noun}'s official page`,
        "Check deadline and eligibility first",
        "List required materials or modules",
        "Decide apply, enrol, or park",
        `Create the next ${output}`,
      ];
    }
    if (keyword(allText, /interview|talking point|bullet|application/)) {
      return [
        `Open ${noun}`,
        "Skip to the most relevant section",
        "Extract five role-relevant ideas",
        "Turn each idea into interview language",
        "Save bullets under the linked track",
      ];
    }
    return [
      `Open ${noun}`,
      "Identify what this resource is for",
      "Choose one section worth using now",
      "Skip anything not linked to target roles",
      `Produce: ${output}`,
    ];
  }

  if (bundle.sourceKind === "hustle") {
    const proofTitle = noun;
    if (keyword(allText, /substack|article|essay|post|write|publish/)) {
      return [
        `Open the ${proofTitle} draft`,
        "Write the core claim in one sentence",
        "Pick the audience and why now",
        "Outline three supporting points",
        "Draft the ugly first paragraph",
      ];
    }
    if (keyword(allText, /portfolio|case|proof|story|memo/)) {
      return [
        `Open a note for ${proofTitle}`,
        "State the credibility gap it proves",
        "Pick one concrete experience example",
        "Write the reusable proof paragraph",
        "Save it for CV or interview use",
      ];
    }
    return [
      `Open ${proofTitle}`,
      "Define the smallest testable slice",
      "Write what success would show",
      "Build or draft only that slice",
      "Note what to reuse later",
    ];
  }

  if (keyword(allText, /network|contact|message|intro|referral|coffee|whatsapp|email/)) {
    return [
      "Open the contact or target list",
      "Name the purpose of the outreach",
      "Write one specific useful ask",
      "Add one personal credibility line",
      "Send it or save the draft",
    ];
  }
  if (keyword(allText, /research|inspect|role examples|requirements|market|signal/)) {
    return [
      "Open LinkedIn or saved roles",
      "Find three matching role examples",
      "Copy repeated requirements only",
      "Mark which requirements you already prove",
      "Save the pattern under the track",
    ];
  }
  if (keyword(allText, /plan|sequence|prioriti|organise|organize|cleanup|reduce/)) {
    return [
      "Open the current task list",
      "Circle the one outcome that matters",
      "Park anything not serving that outcome",
      "Choose the first visible action",
      "Stop when the list feels executable",
    ];
  }
  return [
    `Open the workspace for ${noun}`,
    "Define the real output in one sentence",
    "Identify the first irreversible action",
    "Do only that action first",
    "Write the next step before stopping",
  ];
}

async function buildSourceContext(task: any): Promise<SourceBundle> {
  let sourceContext = "";
  let playbook = "";
  let sourceKind: SourceBundle["sourceKind"] = "task";
  let source: any = null;
  if (task.sourceType === "job" && task.sourceId) {
    const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
    if (j) {
      source = j;
      sourceKind = "job";
      sourceContext = `This is a JOB APPLICATION. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. Fit score: ${j.fitScore ?? "unknown"}. Archetype: ${j.roleArchetype || "unknown"}. Narrative angle: ${j.narrativeAngle || "unset"}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}`;
      playbook = "APPLICATION playbook: understand requirements → map Rohini's evidence → handle gaps → create the next material → save the next application action.";
    }
  } else if (task.sourceType === "learn" && task.sourceId) {
    const l = (await storage.getLearn()).find((x) => x.id === task.sourceId);
    if (l) {
      source = l;
      sourceKind = "learn";
      sourceContext = `This is a LEARNING / DEVELOPMENT item. Title: ${l.title}. Type: ${l.type}. ${l.url ? "URL: " + l.url + ". " : ""}${l.note ? "Notes: " + l.note + ". " : ""}${l.capabilityBuilt ? "Capability: " + l.capabilityBuilt + ". " : ""}Required output: ${l.requiredOutput || "a concrete reusable output"}.`;
      playbook = "LEARNING AND DEVELOPMENT playbook: orient to what the resource is → choose the useful slice → skip non-relevant parts → produce a reusable application/interview output.";
    }
  } else if (task.sourceType === "hustle" && task.sourceId) {
    const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
    if (h) {
      source = h;
      sourceKind = "hustle";
      sourceContext = `This is a PROOF-ASSET / project step. Title: ${h.title}. Stage: ${h.stage}. Content pillar: ${h.contentPillar || "unset"}. Core claim: ${h.coreClaim || "unset"}. ${h.note ? "Notes: " + h.note : ""}`;
      playbook = "PROOF playbook: define the credibility gap → choose the claim → pick evidence → draft the smallest reusable proof fragment.";
    }
  } else if (task.sourceUrl || task.sourceNote) {
    sourceContext = `${task.sourceNote ? "Context: " + task.sourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  return { sourceContext, playbook, sourceKind, source };
}

export function registerTaskBreakdownRoutes(app: Express) {
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 500);
    const bundle = await buildSourceContext(task);

    let steps: string[] = [];
    try {
      const client = new OpenAI();
      const r = await client.responses.create({
        model: "gpt_5_1",
        input:
          `You are Anchor's task decomposition engine. Break this into 3-6 tiny but intelligent steps for Rohini. ` +
          `Do NOT output generic productivity steps. Every step must be specific to the role, resource, proof asset, or real source context. ` +
          `Think before writing: what is the real work, what order prevents rework, and what is the smallest meaningful first move? ` +
          `For roles, include requirements/evidence/gaps/materials. For learning, include what to skip and the reusable output. For proof, include claim/audience/evidence. ` +
          `Each step must be concrete, ordered, and under 12 words. Prefer useful defaults over questions. ` +
          `Return ONLY JSON like {"steps":["...","..."]}.\n\n` +
          `${bundle.playbook ? `Relevant playbook: ${bundle.playbook}\n` : ""}` +
          `Task: ${task.title}\nCategory: ${task.category}\nDone when: ${task.doneWhen || task.minimumOutcome || "smallest useful outcome is complete"}\n` +
          `Source context: ${bundle.sourceContext || "none beyond the title"}\n` +
          `${context ? `User context: ${context}\n` : ""}`,
      });
      steps = parseSteps(r.output_text || "");
    } catch {
      steps = [];
    }

    if (!steps.length) steps = intelligentFallbackSteps(task, bundle);
    const updated = await storage.updateTask(id, { steps: JSON.stringify(steps.map((text) => ({ text, done: false }))) });
    res.json(updated);
  });
}
