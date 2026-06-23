import { llmJSON, MODEL_LIGHT } from "./llm";
import { storage } from "./storage";
import type { Job } from "@shared/schema";

export interface RoleModelRequirement {
  text: string;
  explicit: boolean;
  confidence?: "high" | "medium" | "low";
}

export interface RoleModel {
  mandate: string;
  coreWork: string[];
  capabilityRequirements: RoleModelRequirement[];
  sectorFluency: RoleModelRequirement[];
  evidenceBar: RoleModelRequirement[];
  fitSignals: RoleModelRequirement[];
  hiddenRequirements: RoleModelRequirement[];
  ambiguities: string[];
}

export function parseRoleModel(raw: string): RoleModel | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function hasEnoughInputForRoleModel(job: Job): boolean {
  const jd = (job.jdText || "").trim();
  const title = (job.title || "").trim();
  return title.length > 3 && (jd.length > 30 || (job.company || "").trim().length > 0);
}

export async function generateRoleModel(job: Job): Promise<RoleModel | null> {
  if ((job.roleModel || "").trim()) return parseRoleModel(job.roleModel);
  if (!hasEnoughInputForRoleModel(job)) return null;

  const jd = (job.jdText || "").trim();
  const company = (job.company || "").trim();
  const archetype = (job.roleArchetype || "").trim();
  const location = (job.location || "").trim();
  const narrative = (job.narrativeAngle || "").trim();
  const companyBrief = (job.companyBrief || "").trim();

  let companyContext = "";
  if (companyBrief) {
    try {
      const brief = JSON.parse(companyBrief);
      if (brief.whatTheyDo) companyContext = `Company context: ${brief.whatTheyDo}`;
      if (brief.relevantTeam) companyContext += ` Team: ${brief.relevantTeam}`;
      if (brief.landscape?.marketContext) companyContext += ` Market: ${brief.landscape.marketContext}`;
    } catch {}
  }

  const prompt = `You are an expert career analyst. Given the following role information, produce a structured Role Model — a deep analysis of what this role actually requires. Do NOT compare to any specific candidate. This is pure role understanding.

ROLE: ${job.title}${company ? ` at ${company}` : ""}
${location ? `LOCATION: ${location}` : ""}
${archetype ? `ROLE TYPE: ${archetype}` : ""}
${jd ? `JOB DESCRIPTION:\n${jd.slice(0, 2500)}` : ""}
${narrative ? `NARRATIVE CONTEXT: ${narrative}` : ""}
${companyContext}

Return a JSON object with these fields. Be specific to THIS role — not generic career advice. Preserve the actual requirements from the JD rather than abstracting them into vague categories.

{
  "mandate": "One paragraph: what this role exists to achieve. Not the job title — the actual purpose. What problem does the organisation solve by hiring this person? What does success look like in year one?",
  "coreWork": ["3-6 strings: the actual work this person will do. Include likely deliverables, decisions they'll make, workflows they'll run, and who they'll work with. Be concrete — 'Draft regulatory position papers for EU AI Act consultations' not 'produce written work'."],
  "capabilityRequirements": [
    {"text": "Specific skill, method, tool, or execution capability needed. Preserve the language of the JD — 'stakeholder translation' not 'communication skills'. Each requirement should be distinct and meaningful.", "explicit": true}
  ],
  "sectorFluency": [
    {"text": "Specific market, policy, regulatory, institutional, geographic, or technical context the person must understand. Name the actual domains — 'EU AI Act and cross-jurisdiction governance frameworks' not 'regulatory knowledge'.", "explicit": true}
  ],
  "evidenceBar": [
    {"text": "What proof a credible candidate would need. Prior roles, project types, outputs, credentials, or story themes. Be specific — 'Has led a cross-functional policy initiative from draft to adoption' not 'leadership experience'.", "explicit": true}
  ],
  "fitSignals": [
    {"text": "Working style, seniority signals, ambiguity tolerance, stakeholder style, or narrative expectations implied. 'Comfortable operating across technical and non-technical audiences without defaulting to either' not 'good communicator'.", "explicit": true}
  ],
  "hiddenRequirements": [
    {"text": "Requirement not explicitly stated but likely important given the role, company, and sector. Explain why you infer it.", "explicit": false, "confidence": "medium"}
  ],
  "ambiguities": ["What the JD does not make clear. What should not be overclaimed. What a candidate should ask about or investigate."]
}

For explicit vs inferred:
- "explicit": true — directly stated or clearly implied by JD text
- "explicit": false — inferred from context, role type, company, or sector norms

For confidence on inferred items: "high" = very likely required, "medium" = probably required, "low" = possibly required.

Keep each requirement item to 1-2 sentences max. Aim for 3-6 items per category, more for roles with detailed JDs. Quality over quantity — every item should tell the reader something they couldn't have guessed from the job title alone.`;

  const model = await llmJSON<RoleModel>(prompt, { model: MODEL_LIGHT });
  if (!model || !model.mandate) return null;

  if (!Array.isArray(model.coreWork)) model.coreWork = [];
  if (!Array.isArray(model.capabilityRequirements)) model.capabilityRequirements = [];
  if (!Array.isArray(model.sectorFluency)) model.sectorFluency = [];
  if (!Array.isArray(model.evidenceBar)) model.evidenceBar = [];
  if (!Array.isArray(model.fitSignals)) model.fitSignals = [];
  if (!Array.isArray(model.hiddenRequirements)) model.hiddenRequirements = [];
  if (!Array.isArray(model.ambiguities)) model.ambiguities = [];

  for (const arr of [model.capabilityRequirements, model.sectorFluency, model.evidenceBar, model.fitSignals, model.hiddenRequirements]) {
    for (const item of arr) {
      if (typeof item.explicit !== "boolean") item.explicit = true;
    }
  }

  await storage.updateJob(job.id, { roleModel: JSON.stringify(model) });
  return model;
}

export async function getRoleModel(job: Job): Promise<RoleModel | null> {
  if ((job.roleModel || "").trim()) return parseRoleModel(job.roleModel);
  return generateRoleModel(job);
}
