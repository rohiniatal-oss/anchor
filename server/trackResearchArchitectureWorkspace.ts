import type { CareerArchitecture } from "./trackResearchArchitecture";

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function architectureWorkspaceView(workspace: any, architecture: CareerArchitecture | null) {
  if (!architecture) return workspace || null;

  const assessmentQueue = architecture.userReview.map((review, index) => ({
    id: `architecture-review-${index + 1}`,
    rank: index + 1,
    lane: "Evidence and updating",
    title: review.title,
    action: review.reason,
    doneWhen: "Anchor has enough evidence to update the relevant requirement, gap, intervention, or development plan.",
    why: "This is one of the few assumptions worth surfacing to the user.",
    evidence: review.reason,
    priority: 90 - index,
    sourceType: "architecture_review",
    savedIn: "career_tracks.trackIntelligence.careerArchitecture.userReview",
    activationTarget: "evidence update",
  }));

  return {
    ...(workspace || {}),
    savedTo: [
      {
        label: "Opportunity landscape",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.opportunity_landscape",
        status: "stored_now",
        contains: ["market map", "role families", "opportunity characteristics"],
      },
      {
        label: "Requirement map",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.requirements",
        status: "stored_now",
        contains: ["knowledge", "skills", "evidence", "network", "credentials", "narrative"],
      },
      {
        label: "Evidence-backed assets",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.assets",
        status: "stored_now",
        contains: ["experience", "knowledge", "skills", "proof", "network", "credentials", "story"],
      },
      {
        label: "Gap and intervention logic",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.gaps/interventions",
        status: "stored_now",
        contains: ["information gaps", "capability gaps", "evidence gaps", "best interventions"],
      },
      {
        label: "Automatic activation defaults",
        storage: "career_tracks.trackIntelligence.automaticSelection",
        status: "stored_now",
        contains: ["accepted", "needs evidence", "parked", "rejected"],
      },
      {
        label: "Execution objects",
        storage: "jobs/learn/contacts/hustles after automatic filtering",
        status: "created_on_activation",
        contains: ["role examples", "knowledge resources", "network targets", "proof assets"],
      },
    ],
    sortingLogic: [
      {
        rule: "Understand before developing",
        reason: "Anchor now sequences landscape, role families, requirements, assets, gaps, interventions, development, then evidence updates.",
      },
      {
        rule: "Interest is assumed, not re-litigated",
        reason: "A user-entered career area is treated as worth exploring; fit evaluation belongs later when multiple paths can be compared.",
      },
      {
        rule: "Assets require evidence",
        reason: "Anchor should infer capability from experience plus evidence, not from job titles alone.",
      },
      {
        rule: "Information gaps come first",
        reason: "When the market is unclear, research or practitioner evidence should come before heavy learning plans.",
      },
      {
        rule: "Selection is automatic",
        reason: "The user should only see high-impact assumptions, while Anchor accepts, parks, or marks items as needs-evidence in the background.",
      },
    ],
    lanes: architecture.stages.map((stage) => ({
      lane: stage.title,
      purpose: stage.question,
      savedIn: `career_tracks.trackIntelligence.careerArchitecture.stages.${stage.id}`,
      activationTarget: stage.output,
      items: stage.items.slice(0, 6).map((entry, index) => ({
        id: entry.id,
        rank: index + 1,
        lane: stage.title,
        title: entry.label,
        action: entry.detail || stage.output,
        doneWhen: stage.output,
        why: compact(entry.reason) || stage.question,
        evidence: compact(entry.evidence),
        priority: 80 - index,
        sourceType: entry.sourceType,
        savedIn: `career_tracks.trackIntelligence.careerArchitecture.stages.${stage.id}`,
        activationTarget: compact(entry.status) || "context",
      })),
    })),
    assessmentQueue: assessmentQueue.length ? assessmentQueue : workspace?.assessmentQueue || [],
    priorityQueue: assessmentQueue.length ? assessmentQueue : workspace?.priorityQueue || [],
    organizedAt: Date.now(),
  };
}
