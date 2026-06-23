import { TrackResearchReview as CoverageReview } from "./TrackResearchReviewWithCoverage";
import { DevelopmentPlanReview } from "./DevelopmentPlanReview";

export function TrackResearchReview({ trackId }: { trackId?: number }) {
  return (
    <>
      <CoverageReview trackId={trackId} />
      <DevelopmentPlanReview trackId={trackId} />
    </>
  );
}
