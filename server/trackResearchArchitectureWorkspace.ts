import type { CareerArchitecture } from "./trackResearchArchitecture";
import type { BottleneckDiagnosis } from "./trackResearchBottlenecks";

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function architectureWorkspaceView(workspace: any, architecture: CareerArchitecture | null, bottleneckDiagnosis?: BottleneckDiagnosis | null) {
  if (!architecture) return workspace || null;

  const bottleneckQueue = (bottleneckDiagnosis?.crossRouteBottlenecks || []).slice(0, 3).map((bottleneck, index) => ({
    id: `bottleneck-review-${index + 1}`,
    rank: index + 1,
    lane: "Bottleneck diagnosis",
    title: bottleneck.label,
    action: bottleneck.recommendedBet,
    doneWhen: bottleneck.evidenceToResolve,
    why: bottleneck.whyItMightBeTheBottleneck,
    evidence: bottleneck.evidenceToResolve,
    priority: Math.round(bottleneck.score || (95 - index)),
    sourceType: "bottleneck_diagnosis",
    savedIn: "career_tracks.trackIntelligence.bottleneckDiagnosis.crossRouteBottlenecks",
    activationTarget: bottleneck.kind,
  }));

  const assessmentQueue = bottleneckQueue.length ? bottleneckQueue : architecture.userReview.map((review, index) => ({
    id: `architecture-review-${index + 1}`,
    rank: index + 1,
    lane: "Evidence updates",
    title: review.title,
    action: review.reason,
    doneWhen: "Anchor has enough evidence to update the requirement, gap priority, or development plan.",
    why: "This is one of the few assumptions worth surfacing because it affects how to get to the chosen target.",
    evidence: review.reason,
    priority: 90 - index,
    sourceType: "architecture_review",
    savedIn: "career_tracks.trackIntelligence.careerArchitecture.userReview",
    activationTarget: "plan update",
  }));

  const bottleneckLane = bottleneckDiagnosis ? [{
    lane: "Bottleneck Diagnosis",
    purpose: "Which route-specific bottleneck hypotheses best explain what may block competitiveness?",
    savedIn: "career_tracks.trackIntelligence.bottleneckDiagnosis",
    activationTarget: "Evidence-backed bottleneck hypotheses, not definitive gaps.",
    items: bottleneckDiagnosis.crossRouteBottlenecks.map((bottleneck, index) => ({
      id: bottleneck.id,
      rank: index + 1,
      lane: "Bottleneck Diagnosis",
      title: bottleneck.label,
      action: bottleneck.recommendedBet,
      doneWhen: bottleneck.evidenceToResolve,
      why: bottleneck.whyItMightBeTheBottleneck,
      evidence: bottleneck.evidenceToResolve,
      priority: Math.round(bottleneck.score || (90 - index)),
      sourceType: "bottleneck_diagnosis",
      savedIn: "career_tracks.trackIntelligence.bottleneckDiagnosis.crossRouteBottlenecks",
      activationTarget: bottleneck.kind,
    })),
  }] : [];

  return {
    ...(workspace || {}),
    savedTo: [
      {
        label: "Target state",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.target_state",
        status: "stored_now",
        contains: ["target market", "role families", "requirements", "success signals"],
      },
      {
        label: "Current state",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.current_state",
        status: "stored_now",
        contains: ["evidence-backed assets", "provisional assets", "unknowns"],
      },
      {
        label: "Bottleneck diagnosis",
        storage: "career_tracks.trackIntelligence.bottleneckDiagnosis",
        status: "stored_now",
        contains: ["route requirements", "coverage states", "bottleneck hypotheses", "evidence to resolve"],
      },
      {
        label: "Gap analysis",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.gap_analysis",
        status: "stored_now",
        contains: ["knowledge", "skill", "evidence", "network", "access", "credential", "narrative", "information"],
      },
      {
        label: "Gap prioritization",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.gap_prioritization",
        status: "stored_now",
        contains: ["severity", "dependency value", "cross-path leverage", "evidence strength"],
      },
      {
        label: "Development plan",
        storage: "career_tracks.trackIntelligence.careerArchitecture.stages.development_plan",
        status: "stored_now",
        contains: ["learning", "practice", "proof", "network", "positioning", "access"],
      },
      {
        label: "Execution objects",
        storage: "jobs/learn/contacts/hustles after gap-driven filtering",
        status: "created_on_activation",
        contains: ["role examples", "knowledge resources", "network targets", "proof assets"],
      },
    ],
    sortingLogic: [
      {
        rule: "Target is assumed",
        reason: "The user has chosen the direction; Anchor should help them become competitive rather than ask whether the target is valid.",
      },
      {
        rule: "Target before current state",
        reason: "Anchor first defines what success requires, then maps the user's current assets against that target.",
      },
      {
        rule: "Bottlenecks are hypotheses",
        reason: "Required levels and user capability are uncertain, so Anchor should diagnose likely blockers rather than assert clean gaps.",
      },
      {
        rule: "Assets require evidence",
        reason: "Capability should be inferred from experience plus evidence, not from job titles alone.",
      },
      {
        rule: "Prioritize blocking bottlenecks",
        reason: "The next plan should focus on the route-specific bottlenecks most likely to constrain competitiveness.",
      },
      {
        rule: "Activation is diagnosis-driven",
        reason: "Anchor materializes roles, learning, contacts, or proof only when they resolve a bottleneck hypothesis; caps are clutter guards, not the decision rule.",
      },
    ],
    lanes: [
      ...bottleneckLane,
      ...architecture.stages.map((stage) => ({
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
          priority: Math.round(entry.score || (80 - index)),
          sourceType: entry.sourceType,
          savedIn: `career_tracks.trackIntelligence.careerArchitecture.stages.${stage.id}`,
          activationTarget: compact(entry.status) || "context",
        })),
      })),
    ],
    assessmentQueue: assessmentQueue.length ? assessmentQueue : workspace?.assessmentQueue || [],
    priorityQueue: assessmentQueue.length ? assessmentQueue : workspace?.priorityQueue || [],
    organizedAt: Date.now(),
  };
}
