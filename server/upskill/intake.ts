// Compile the planner input from existing Anchor state. The pure
// gatherUpskillIntake() does the assembly + multi-track weighting; the async
// gatherIntakeFromStorage() wires it to the live storage/repository so routes
// and the recompose orchestrator can call it without duplicating queries.
import type { CareerTrack, UserProfile } from "@shared/schema";
import { summarizeSignals } from "./signals";

export type TrackIntake = {
  id: number;
  name: string;
  description: string;
  targetRoleArchetype: string;
  whyItFits: string;
  aspiration: string;
  priority: number;
  weight: number; // share of the next horizon, sums to ~1 across active tracks
};

export type CompletedItem = { title: string; phaseLabel: string };

export type UpskillIntake = {
  tracks: TrackIntake[];
  profile: { targetRoles: string; locationPreferences: string; searchPhase: string };
  signals: string[];
  recentCompleted: CompletedItem[];
  currentPhaseLabel: string;
};

// Proportional weights from priority. If every active track has priority 0,
// fall back to an equal split (spec: multi-track balancing relies on priority,
// equal split when unset).
export function computeWeights(tracks: { priority: number }[]): number[] {
  const total = tracks.reduce((sum, t) => sum + Math.max(0, t.priority), 0);
  if (tracks.length === 0) return [];
  if (total <= 0) return tracks.map(() => Number((1 / tracks.length).toFixed(2)));
  return tracks.map((t) => Number((Math.max(0, t.priority) / total).toFixed(2)));
}

export function gatherUpskillIntake(
  userTracks: CareerTrack[],
  profile: UserProfile | null,
  signals: string[],
  recentCompleted: CompletedItem[] = [],
  currentPhaseLabel = "",
): UpskillIntake {
  const active = userTracks.filter((t) => t.status === "active");
  const weights = computeWeights(active);
  const tracks: TrackIntake[] = active.map((t, i) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    targetRoleArchetype: t.targetRoleArchetype,
    whyItFits: t.whyItFits,
    aspiration: t.aspiration,
    priority: t.priority,
    weight: weights[i] ?? 0,
  }));
  return {
    tracks,
    profile: {
      targetRoles: profile?.targetRoles || "",
      locationPreferences: profile?.locationPreferences || "",
      searchPhase: profile?.searchPhase || "",
    },
    signals,
    recentCompleted,
    currentPhaseLabel,
  };
}

// Live assembly from storage + the upskill repository. Kept thin: it fetches,
// then defers all shaping to the pure functions above.
export async function gatherIntakeFromStorage(): Promise<UpskillIntake> {
  const { storage } = await import("../storage");
  const repo = await import("./repository");
  const [tracks, profile, activityLog, learn] = await Promise.all([
    storage.getCareerTracks(),
    storage.getProfile(),
    storage.getActivityLog(),
    storage.getLearn(),
  ]);
  const checkins = repo.listCheckins();
  const completed = repo.listRecentCompleted(10);
  const signals = summarizeSignals({ activityLog, learn, dayPlans: [], checkins });
  return gatherUpskillIntake(
    tracks,
    profile,
    signals,
    completed.map((c) => ({ title: c.title, phaseLabel: c.phaseLabel })),
    repo.currentPhaseLabel(),
  );
}
