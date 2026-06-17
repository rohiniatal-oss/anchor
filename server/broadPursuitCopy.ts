export function broadPursuitPathList(
  combinations: string[] = [],
  fallback = "each role type you still want to test",
  max = combinations.length || 0,
) {
  const shown = combinations.slice(0, Math.max(0, max)).filter(Boolean);
  return shown.length > 0 ? shown.join("; ") : fallback;
}

export function broadPursuitMissingRolesUnlockMove() {
  return "Add one real role or application move to each missing path.";
}

export function broadPursuitMissingRolesTitle() {
  return "Add one real role for each missing path";
}

export function broadPursuitMissingRolesDoneWhen() {
  return "One concrete role or application move exists for each missing path";
}

export function broadPursuitMissingRolesWhyNow() {
  return "you are testing several plausible role types in parallel and need real openings to learn from";
}

export function broadPursuitMissingRolesContextReason(
  combinations: string[] = [],
  currentFocus?: string,
) {
  const missingText = broadPursuitPathList(combinations, "some of the paths you still want to test", 4);
  return `You are testing several plausible paths in parallel, but some still need a real role: ${missingText}. Add one real role or application move to each missing path before doing narrower comparison work.${currentFocus ? ` Current focus: ${currentFocus}.` : ""}`;
}

export function broadPursuitMissingRolesSourceNote(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations);
  return `You are testing several role types in parallel. Missing role types: ${missingText}. Add one real role or application move to each one before narrowing.`;
}

export function broadPursuitMissingRolesFirstStep(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "each path still missing one");
  return `Open your job sources and add one real role for each path still missing one: ${missingText}.`;
}

export function broadPursuitMissingRolesStopRule() {
  return "Stop after one concrete role or application move exists for each missing path.";
}

export function broadPursuitMissingRolesSourceFrame(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the missing paths");
  return `You are testing several paths in parallel, so the best move is to turn the missing ones into real roles or application progress: ${missingText}.`;
}

export function broadPursuitMissingRolesPlanWhy(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the paths still missing one");
  return `You are testing several paths in parallel. Add one real role or application move to each path still missing one: ${missingText}.`;
}

export function broadPursuitMissingRolesPlanSummary() {
  return "You are testing several paths in parallel, so the next move is to make the missing ones real.";
}

export function broadPursuitMissingRolesPlannerNote(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the paths still missing one");
  return `You are testing several paths in parallel. Each missing path needs one real role or application move before narrowing: ${missingText}.`;
}

export function broadPursuitMissingRolesSupportingReasons(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "some path combinations");
  return [
    "You are testing several plausible role types in parallel.",
    `These path combinations still have no saved role: ${missingText}.`,
    "Real role and application moves are more useful now than more abstract narrowing.",
  ];
}

export function broadPursuitMissingRolesPlanNote() {
  return "You are testing several paths in parallel. Turn each missing path into one real role or application move before narrowing anything.";
}

export function broadPursuitMissingRolesDecisionQuestion(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the paths still missing a first real role");
  return `Which paths still need a first real role next: ${missingText}?`;
}

export function broadPursuitNextMissingRoleTodayMustDo(combinations: string[] = []) {
  const target = combinations.length ? combinations[combinations.length - 1] : "the next missing path";
  return `Add the next real role or application move for ${target}.`;
}

export function broadPursuitNextMissingRoleStopRule(combinations: string[] = []) {
  const target = combinations.length ? combinations[combinations.length - 1] : "the next missing path";
  return `Stop after ${target} has one concrete role or application move.`;
}

export function broadPursuitNextMissingRolePlanNote(combinations: string[] = []) {
  const target = combinations.length ? combinations[combinations.length - 1] : "the next missing path";
  return `You are testing several paths in parallel, but ${target} has no real role or application step yet. Do that before drifting back into abstract comparison.`;
}

export function broadPursuitMissingContactsUnlockMove() {
  return "Add one useful contact or outreach path to each live role type still missing one.";
}

export function broadPursuitMissingContactsTitle() {
  return "Add one useful contact for each live path still missing one";
}

export function broadPursuitMissingContactsDoneWhen() {
  return "One useful contact or outreach path exists for each live role type that was missing one";
}

export function broadPursuitMissingContactsWhyNow() {
  return "some live role types still need someone useful to reach out to";
}

export function broadPursuitMissingContactsContextReason(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "some live paths");
  return `Some live role types still need someone useful to reach out to: ${missingText}. Add one contact or outreach path to each of those live paths next.`;
}

export function broadPursuitMissingContactsSourceNote(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the live role types still missing one");
  return `These live role types still need someone useful to reach out to: ${missingText}. Add one contact or outreach path to each one.`;
}

export function broadPursuitMissingContactsFirstStep(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the live paths still missing one");
  return `Open Network and add one person you could realistically reach out to for each live path still missing one: ${missingText}.`;
}

export function broadPursuitMissingContactsStopRule() {
  return "Stop after each live role type that was missing one now has a useful contact or outreach path.";
}

export function broadPursuitMissingContactsSourceFrame(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the live paths still missing one");
  return `Some live role types still need someone useful to reach out to, so the best move is to add or draft one contact path for each missing one: ${missingText}.`;
}

export function broadPursuitMissingContactsPlanNote() {
  return "You have live role types already, but some still need someone useful to reach out to. Add those contacts before doing extra narrowing work.";
}

export function broadPursuitNextMissingContactTodayMustDo(combinations: string[] = []) {
  const target = broadPursuitPathList(combinations, "the live path still missing outreach", 1);
  return `Add the next useful contact or outreach path for ${target}.`;
}

export function broadPursuitNextMissingContactStopRule(combinations: string[] = []) {
  const target = broadPursuitPathList(combinations, "the live path still missing outreach", 1);
  return `Stop after ${target} has one useful contact or outreach path.`;
}

export function broadPursuitNextMissingContactPlanNote(combinations: string[] = []) {
  const target = broadPursuitPathList(combinations, "the live path still missing outreach", 1);
  return `You have live role types already, but the next missing support move is finding someone useful to reach out to for ${target}. Add that before doing extra narrowing work.`;
}

export function broadPursuitMissingPrepUnlockMove() {
  return "Start learning about each live role type still missing one.";
}

export function broadPursuitMissingPrepTitle() {
  return "Start learning about each live path still missing one";
}

export function broadPursuitMissingPrepDoneWhen() {
  return "One focused learning item exists for each live role type that was missing one";
}

export function broadPursuitMissingPrepWhyNow() {
  return "some live role types still need more focused learning support";
}

export function broadPursuitMissingPrepContextReason(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "some live paths");
  return `Some live role types still need more focused learning support: ${missingText}. Start learning about each of those live paths next.`;
}

export function broadPursuitMissingPrepSourceNote(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the live role types still missing one");
  return `These live role types still need more focused learning support: ${missingText}. Start learning about each one.`;
}

export function broadPursuitMissingPrepFirstStep(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the live paths still missing one");
  return `Use Jobs or Learn to start learning about each live path still missing one: ${missingText}.`;
}

export function broadPursuitMissingPrepStopRule() {
  return "Stop after each live role type that was missing one now has one learning focus.";
}

export function broadPursuitMissingPrepSourceFrame(combinations: string[] = []) {
  const missingText = broadPursuitPathList(combinations, "the live paths still missing one");
  return `Some live role types still need more focused learning support, so the best move is to start learning about each missing one: ${missingText}.`;
}

export function broadPursuitMissingPrepPlanNote() {
  return "You have live role types already, but some still need more focused learning support. Set that up before drifting into lower-value work.";
}

export function broadPursuitNextMissingPrepTodayMustDo(combinations: string[] = []) {
  const target = broadPursuitPathList(combinations, "the live path still missing learning support", 1);
  return `Start learning about ${target}.`;
}

export function broadPursuitNextMissingPrepStopRule(combinations: string[] = []) {
  const target = broadPursuitPathList(combinations, "the live path still missing learning support", 1);
  return `Stop after ${target} has one learning focus.`;
}

export function broadPursuitNextMissingPrepPlanNote(combinations: string[] = []) {
  const target = broadPursuitPathList(combinations, "the live path still missing learning support", 1);
  return `You have live role types already, but the next missing learning move is more focused learning support for ${target}. Add that before drifting into lower-value work.`;
}

export function broadPursuitMissingSupportDetail(
  missingNetwork: string[] = [],
  missingPrep: string[] = [],
) {
  const parts = [
    missingNetwork.length > 0
      ? `someone to reach out to: ${broadPursuitPathList(missingNetwork, "the live paths still missing outreach")}`
      : "",
    missingPrep.length > 0
      ? `learning focus: ${broadPursuitPathList(missingPrep, "the live paths still missing learning support")}`
      : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

export function broadPursuitMissingSupportContextReason(
  missingNetwork: string[] = [],
  missingPrep: string[] = [],
) {
  const detail = broadPursuitMissingSupportDetail(missingNetwork, missingPrep);
  return `Live roles already exist across the paths you are testing, but some still need outreach, more focused learning support, or both: ${detail}. Add the next missing support where it will unlock the strongest live role fastest, without losing momentum on the others.`;
}

export function broadPursuitMissingSupportTodayMustDo(
  missingNetwork: string[] = [],
  missingPrep: string[] = [],
) {
  const detail = broadPursuitMissingSupportDetail(missingNetwork, missingPrep);
  return `Add the next missing support move for the strongest live path: ${detail}`;
}

export function broadPursuitMissingSupportStopRule() {
  return "Stop after each live path has either someone real to reach out to, a learning focus, or both.";
}

export function broadPursuitMissingSupportDecisionQuestion(
  missingNetwork: string[] = [],
  missingPrep: string[] = [],
) {
  const detail = broadPursuitMissingSupportDetail(missingNetwork, missingPrep);
  return `Which live paths still need outreach, more focused learning support, or both next: ${detail}?`;
}
