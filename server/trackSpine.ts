import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { buildLaneOperatingModel, type LaneState } from "./laneState";
import { buildAllTrackPlans } from "./trackPlanner";
import { buildMarketabilityPlan } from "./marketabilityEngine";
import { LANE_NAME, normalizeLaneName, type CanonicalLaneName } from "./lanes";

export type TrackSpineLane = {
  name: CanonicalLaneName;
  stage: string;
  priority: number;
  bottleneck: string;
  unlockMove: string;
  stopRule: string;
  evidence: string[];
};

export type TrackSpineTrack = {
  id: number;
  name: string;
  status: string;
  stage: string;
  health: string;
  priority: number;
  lanes: TrackSpineLane[];
  primaryLane: CanonicalLaneName;
  primaryMove: string;
  doneWhen: string;
  reason: string;
  supportMoves: string[];
  ongoingMoves: string[];
  redundantCount: number;
};

export type TrackSpine = {
  goal: string;
  activeTrack: TrackSpineTrack | null;
  tracks: TrackSpineTrack[];
  globalLanes: TrackSpineLane[];
  bottleneckLane: CanonicalLaneName;
  bestMove: {
    title: string;
    firstStep: string;
    doneWhen: string;
    stopWhen: string;
    source: "track_spine" | "marketability" | "fallback";
    trackId?: number;
    trackName?: string;
    lane: CanonicalLaneName;
    reason: string;
  };
  marketability: ReturnType<typeof buildMarketabilityPlan>;
  trace: string[];
};

function toSpineLane(lane: LaneState): TrackSpineLane {
  return {
    name: normalizeLaneName(lane.name),
    stage: lane.stage,
    priority: lane.priority,
    bottleneck: lane.bottleneck,
    unlockMove: lane.unlockMove,
    stopRule: lane.stopRule,
    evidence: lane.evidence,
  };
}

function firstStepFor(title: string, lane: CanonicalLaneName) {
  if (lane === LANE_NAME.APPLICATIONS) return "Open the role, CV, or application material.";
  if (lane === LANE_NAME.NETWORK) return "Open the contact list or draft message.";
  if (lane === LANE_NAME.LEARNING_DEVELOPMENT) return "Open the learning item or a blank note for one short practice attempt or useful note.";
  if (lane === LANE_NAME.PROOF_ASSETS) return "Open a blank note and create the smallest useful or publishable piece.";
  if (/role|inspect|requirements/i.test(title)) return "Open LinkedIn or a saved role.";
  return "Open the task and do the smallest visible first step.";
}

export function buildTrackSpine(input: {
  tasks: Task[];
  jobs: Job[];
  learn: Learn[];
  hustles: Hustle[];
  contacts: Contact[];
  tracks: CareerTrack[];
}): TrackSpine {
  const laneModel = buildLaneOperatingModel(input.tasks, input.jobs, input.learn, input.hustles, input.contacts);
  const globalLanes = laneModel.lanes.map(toSpineLane);
  const plans = buildAllTrackPlans(input.tracks, {
    tasks: input.tasks,
    jobs: input.jobs,
    learn: input.learn,
    hustles: input.hustles,
    contacts: input.contacts,
  });
  const marketability = buildMarketabilityPlan(input);

  const tracks: TrackSpineTrack[] = plans.map((plan) => {
    const anchor = plan.sequence.anchor;
    return {
      id: plan.track.id,
      name: plan.track.name,
      status: plan.track.status,
      stage: plan.stage,
      health: plan.health,
      priority: anchor.priority,
      lanes: globalLanes,
      primaryLane: normalizeLaneName(anchor.lane),
      primaryMove: anchor.move,
      doneWhen: anchor.doneWhen,
      reason: anchor.reason,
      supportMoves: plan.sequence.next.map((n) => n.move),
      ongoingMoves: plan.sequence.ongoing.map((n) => n.move),
      redundantCount: plan.redundant.length,
    };
  });

  const activeTrack = tracks[0] || null;
  const marketMove = marketability.topMoves[0] || null;
  const bottleneckLane = activeTrack?.primaryLane || normalizeLaneName(laneModel.bottleneckLane.name);
  const bestMove = activeTrack ? {
    title: activeTrack.primaryMove,
    firstStep: firstStepFor(activeTrack.primaryMove, activeTrack.primaryLane),
    doneWhen: activeTrack.doneWhen,
    stopWhen: activeTrack.primaryLane === LANE_NAME.APPLICATIONS ? "Stop after one concrete application/material step." : "Stop after one useful result exists.",
    source: "track_spine" as const,
    trackId: activeTrack.id,
    trackName: activeTrack.name,
    lane: activeTrack.primaryLane,
    reason: activeTrack.reason,
  } : marketMove ? {
    title: marketMove.title,
    firstStep: firstStepFor(marketMove.title, normalizeLaneName(marketMove.lane)),
    doneWhen: marketMove.doneWhen,
    stopWhen: "Stop once the required result exists.",
    source: "marketability" as const,
    trackId: marketMove.trackId,
    trackName: marketMove.trackName,
    lane: normalizeLaneName(marketMove.lane),
    reason: marketMove.reason,
  } : {
    title: laneModel.bottleneckLane.unlockMove,
    firstStep: firstStepFor(laneModel.bottleneckLane.unlockMove, bottleneckLane),
    doneWhen: "One useful signal or result exists.",
    stopWhen: laneModel.bottleneckLane.stopRule,
    source: "fallback" as const,
    lane: bottleneckLane,
    reason: laneModel.bottleneckLane.bottleneck,
  };

  return {
    goal: "Find a fulfilling next role",
    activeTrack,
    tracks,
    globalLanes,
    bottleneckLane,
    bestMove,
    marketability,
    trace: [
      "Built canonical Tracks × Lanes spine.",
      activeTrack ? `Active track is ${activeTrack.name}.` : "No active track plan found.",
      `Primary focus area is ${bottleneckLane}.`,
      `Best move source is ${bestMove.source}.`,
    ],
  };
}
