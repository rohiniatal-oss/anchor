import { ArrowUpRight, Briefcase, Compass, GraduationCap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPrepStarterDraft } from "@/lib/learnStarter";
import {
  buildPrefillHash,
  PENDING_CONTACT_DRAFT_KEY,
  PENDING_LEARN_DRAFT_KEY,
  Tab,
  queueIntakeDraft,
} from "@/lib/homeTypes";
import {
  broadPursuitGapLines,
  CareerGoalT,
  compactLanePreview,
  displayCombinationLabel,
  goalCompassSummary,
  goalFocusComparisonLines,
  goalFocusSupportLine,
  goalModeInfo,
