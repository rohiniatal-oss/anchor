export function laneNarrowingTwoAxisReason(
  topics: string[] = [],
  roleShapes: string[] = [],
) {
  return `You have multiple plausible topics (${topics.join(" vs ")}) and multiple plausible role shapes (${roleShapes.join(" vs ")}). Anchor should keep those options alive in parallel until live evidence starts separating them.`;
}

export function laneNarrowingTwoAxisDecisionQuestion() {
  return "Which options keep earning more attention from real roles, energy, and response over time?";
}

export function laneNarrowingSingleAxisReason(paths: string[] = []) {
  return `You have multiple plausible paths in play (${paths.join(" vs ")}). Anchor should keep them live in parallel long enough to learn from real roles, energy, and response before narrowing.`;
}

export function laneNarrowingSingleAxisDecisionQuestion() {
  return "Which paths keep earning more attention from real role examples, energy, and response?";
}

export function laneNarrowingTwoAxisTodayMustDo(
  topics: string[] = [],
  roleShapes: string[] = [],
) {
  const topicA = topics[0] || "topic one";
  const topicB = topics[1] || "topic two";
  const shapeA = roleShapes[0] || "role shape one";
  const shapeB = roleShapes[1] || "role shape two";
  return `Collect one real role example for each option: ${topicA} x ${shapeA}, ${topicA} x ${shapeB}, ${topicB} x ${shapeA}, and ${topicB} x ${shapeB}`;
}

export function laneNarrowingTwoAxisTodayNext() {
  return "Note which options gain energy, lose energy, or look more gettable once you see the real work";
}

export function laneNarrowingTwoAxisTodayOptional() {
  return "Ask one warm contact which of the four options looks strongest from the outside";
}

export function laneNarrowingTwoAxisTodayStopRule() {
  return "Stop after one concrete role example per option and one shortlist note; do not force a winner just to feel finished.";
}

export function laneNarrowingSingleAxisTodayMustDo(paths: string[] = []) {
  return `Collect one real role example from each live path: ${paths.join(", ")}`;
}

export function laneNarrowingSingleAxisTodayNext() {
  return "Note which paths gain energy, lose energy, or look more credible once you inspect the real work";
}

export function laneNarrowingSingleAxisTodayOptional() {
  return "Ask one warm contact which path looks most credible from the outside";
}

export function laneNarrowingSingleAxisTodayStopRule() {
  return "Stop after one concrete role example per live path and one shortlist note; do not force a final identity choice today.";
}

export function fitDiscoveryDecisionQuestion() {
  return "What kinds of work actually fit your interests, goals, and energy well enough to test in the market?";
}

export function fitDiscoveryTodayMustDo(primary?: string | null) {
  return primary || "Inspect one plausible role family";
}

export function fitDiscoveryTodayNext(next?: string | null) {
  return next || "Write down what energises you and what you do not want";
}

export function fitDiscoveryTodayOptional() {
  return "Capture one emerging hypothesis, even if it is rough";
}

export function fitDiscoveryTodayStopRule() {
  return "Stop after one useful data point or 20 minutes.";
}

export function interviewPrepReason() {
  return "A live interview path exists, so the bottleneck shifts from generic exploration to interview and role readiness.";
}

export function interviewPrepDecisionQuestion() {
  return "What stories, knowledge, and capabilities will make you strong in the interview and in the role?";
}

export function interviewPrepTodayMustDo() {
  return "Prepare 3 concrete stories for the most likely interview themes";
}

export function interviewPrepTodayNext() {
  return "Review the role and company thesis and write one sharp answer for why this role fits";
}

export function interviewPrepTodayOptional() {
  return "Convert one learning item into a job-relevant note, framework, or practice answer";
}

export function interviewPrepTodayStopRule() {
  return "Stop once the interview packet is stronger than it was before.";
}
