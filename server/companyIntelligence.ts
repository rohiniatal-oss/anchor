import { llmJSON, MODEL_LIGHT } from "./llm";
import { storage } from "./storage";
import type { Job, Task, Contact } from "@shared/schema";

export interface CompanyBrief {
  whatTheyDo: string;
  relevantTeam: string;
  whyYouFit: string;
  landscape: {
    competitors: string[];
    alsoConsider: string[];
    marketContext: string;
  };
  outreachSuggestions: Array<{
    archetype: string;
    why: string;
    searchTip: string;
  }>;
  prepAngle: string;
}

export function parseCompanyBrief(raw: string): CompanyBrief | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function generateCompanyBrief(job: Job): Promise<CompanyBrief | null> {
  if ((job.companyBrief || "").trim()) return parseCompanyBrief(job.companyBrief);
  if (!job.company) return null;

  const profile = await storage.getProfile();
  const cv = (profile?.cvText || "").trim();
  const tracks = await storage.getCareerTracks();
  const activeTrack = tracks.find((t) => t.id === job.relatedTrackId) || tracks.find((t) => t.status === "active");

  const contacts = await storage.getContacts();
  const networks = [...new Set(contacts.map((c) => (c as any).sourceNetwork).filter(Boolean))];

  const prompt = `You are a career strategist helping someone research a specific company and role. Be specific to THIS person's background — not generic career advice.

ROLE: ${job.title} at ${job.company}
${job.location ? `LOCATION: ${job.location}` : ""}
${job.roleArchetype ? `ROLE TYPE: ${job.roleArchetype}` : ""}
${activeTrack ? `CAREER TRACK: ${activeTrack.name} — ${activeTrack.description}` : ""}
${job.jdText ? `JOB DESCRIPTION (first 1500 chars):\n${job.jdText.slice(0, 1500)}` : ""}
${cv ? `CV (first 1500 chars):\n${cv.slice(0, 1500)}` : ""}
${networks.length > 0 ? `THEIR NETWORKS: ${networks.join(", ")}` : ""}

Return JSON with these fields:
{
  "whatTheyDo": "1-2 sentences on what ${job.company} does and what this team/practice specifically focuses on. Be concrete — name their actual work areas, not corporate fluff.",
  "relevantTeam": "Which specific team, practice, or division this role sits in. If you can infer it from the title or JD, name it. If not, say which part of the company it most likely belongs to.",
  "whyYouFit": "1 sentence connecting THIS person's specific experience to THIS role. Reference actual items from their CV. If no CV provided, skip this.",
  "landscape": {
    "competitors": ["2-4 direct competitors or similar organisations hiring for the same kind of role"],
    "alsoConsider": ["2-3 companies the user might not have thought of that hire for similar roles but in adjacent sectors or contexts — expand the search, don't just list the obvious"],
    "marketContext": "1 sentence on what's happening in this space right now — hiring trends, growth areas, or shifts that affect this type of role"
  },
  "outreachSuggestions": [
    {
      "archetype": "A specific type of person to find (e.g. 'SIPA alum at ${job.company}', 'former Bain colleague now in ${job.roleArchetype || "this space"}')",
      "why": "Why this person would be receptive and helpful",
      "searchTip": "Exactly how to find them on LinkedIn — specific search terms"
    }
  ],
  "prepAngle": "One specific thing to learn or prepare before reaching out or applying. Not 'research the company' — something concrete like 'Read their latest annual report section on X' or 'Prepare a 2-minute story about your Y experience framed as Z'."
}

Give 2-3 outreach suggestions, ordered by most likely to respond first. Use the person's actual networks (${networks.join(", ") || "unknown"}) to make suggestions specific. For competitors and alsoConsider, be specific to the ROLE TYPE not just the industry — if this is a strategy role at a development bank, competitors are other development banks AND strategy consultancies working in development, not just any bank.`;

  const brief = await llmJSON<CompanyBrief>(prompt, { model: MODEL_LIGHT });
  if (!brief || !brief.whatTheyDo) return null;

  await storage.updateJob(job.id, { companyBrief: JSON.stringify(brief) });
  await materializeActions(job, brief).catch(() => {});
  return brief;
}

async function materializeActions(job: Job, brief: CompanyBrief): Promise<void> {
  const role = `${job.title}${job.company ? ` at ${job.company}` : ""}`;
  const existingTasks = await storage.getTasks();
  const existingContacts = await storage.getContacts();

  const hasTaskForCompany = (keyword: string) =>
    existingTasks.some((t) => !t.done && t.sourceType === "job" && t.sourceId === job.id && t.title.toLowerCase().includes(keyword.toLowerCase()));
  const hasContactForOrg = (org: string) =>
    existingContacts.some((c) => (c.targetOrg || "").toLowerCase().includes(org.toLowerCase()));

  if (brief.outreachSuggestions?.[0] && job.company && !hasContactForOrg(job.company)) {
    const s = brief.outreachSuggestions[0];
    await storage.createContact({
      name: "",
      who: s.archetype,
      sector: job.roleArchetype || "",
      why: `Could help with ${role}. ${s.why || ""}`.trim(),
      status: "to_contact",
      targetOrg: job.company,
      targetRole: job.title,
      relatedTrackId: job.relatedTrackId ?? undefined,
      note: s.searchTip || "",
    } as any);
  }

  if (brief.prepAngle && !hasTaskForCompany("prep")) {
    const title = brief.prepAngle.length > 80 ? brief.prepAngle.slice(0, 77) + "..." : brief.prepAngle;
    await storage.createTask({
      title,
      list: "inbox",
      done: false,
      category: "learning",
      size: "quick",
      sourceType: "job",
      sourceId: job.id,
      sourceNote: `Prep for ${role}`,
      relatedTrackId: job.relatedTrackId ?? null,
      doneWhen: "You can speak to this confidently in a conversation or cover letter",
    } as any);
  }

  // Competitors and "also consider" companies are stored in the brief JSON
  // and surfaced in the Jobs UI as tappable suggestions — not as tasks.
}
