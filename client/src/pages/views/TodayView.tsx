import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Check, CalendarDays, Loader2, Target, ChevronRight,
  Pin, Wand2, MoveRight, MoonStar, Trophy, Briefcase, Users, GraduationCap,
  X, Sparkles, ExternalLink, Flame, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { todayKey } from "@/lib/utils";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useRecommendations } from "@/hooks/useRecommendations";
import { CareerCompassCard } from "@/components/home/CareerCompassCard";
import { StrategicNextSteps } from "@/components/home/StrategicNextSteps";
import { GroupLabel } from "@/components/home/GroupLabel";
import OnboardingView from "@/pages/views/OnboardingView";
import type { Task, Event, Recommendation } from "@shared/schema";
import type { Tab } from "@/lib/homeTypes";
import {
  type PlanItemT, type DayPlanT, type CareerGoalT, type GoalsStateResponseT,
  SLOT_LABEL, deriveTodayExecutionState, getBroadPursuitCoverage, isPreShrunkPlanItem, isBroadPursuitGoalItem,
  broadPursuitGapLines, broadPursuitPlanTitle, broadPursuitPrimarySummary, goalMorningBriefWithExecution, goalTodayIntroLine,
} from "@/lib/goalSpine";
import { WIN_CATEGORY_LABEL, type WinCategory } from "@/lib/homeTypes";

type WorkflowStateCtx = { workObject?: string; currentStage?: string; stageOutput?: string; completionCriteria?: string[]; advanceCondition?: string };
type Step = { text: string; done: boolean; substeps?: string[]; workflowState?: WorkflowStateCtx };
function parseSteps(raw: string): Step[] {
  try { const s = JSON.parse(raw || "[]"); return Array.isArray(s) ? s : []; } catch { return []; }
}

function daysUntil(d: string): number | null {
  if (!d) return null;
  const due = new Date(d + "T00:00:00");
  if (isNaN(due.getTime())) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}
function formatDeadline(d: string): string {
  const diff = daysUntil(d);
  if (diff === null) return d || "";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const due = new Date(d + "T00:00:00");
  if (diff < 7) return due.toLocaleDateString(undefined, { weekday: "short" });
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function deadlineTone(d: string): string {
  const diff = daysUntil(d);
  if (diff === null) return "bg-muted text-muted-foreground";
  if (diff <= 2) return "bg-destructive/10 text-destructive";
  if (diff <= 7) return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

function defaultEnergyForNow() {
  const hour = new Date().getHours();
  if (hour < 11) return "high";
  if (hour < 17) return "medium";
  return "low";
}

function energyModeLabel(energy: string) {
  if (energy === "high") return "higher-energy";
  if (energy === "low") return "lighter";
  return "steady";
}

function nextVisibleStep(task?: Task | null) {
  if (!task) return null;
  const steps = parseSteps(task.steps || "[]");
  return steps.find((step) => !step.done) || steps[0] || null;
}

function firstStepPreview(item: PlanItemT, task?: Task | null) {
  const taskStep = nextVisibleStep(task);
  if (taskStep?.text) return taskStep.text;
  const text = item.explanation?.firstStep?.trim();
  return text || null;
}

function normalizeExplanationText(text?: string | null) {
  return (text || "").trim().replace(/\s+/g, " ");
}

function sameExplanationText(a?: string | null, b?: string | null) {
  return normalizeExplanationText(a).toLowerCase() === normalizeExplanationText(b).toLowerCase();
}

function primaryPlanReason(item: PlanItemT, fallback?: string | null) {
  const whyNow = normalizeExplanationText(item.explanation?.whyNow);
  const summary = normalizeExplanationText(item.explanation?.summary);
  const whySelected = normalizeExplanationText(item.whySelected);
  const fallbackText = normalizeExplanationText(fallback);
  return whyNow || fallbackText || summary || whySelected || "";
}

function secondaryPlanReasons(item: PlanItemT, primaryReason: string, fallback?: string | null) {
  const candidates = [
    normalizeExplanationText(fallback),
    normalizeExplanationText(item.explanation?.summary),
    normalizeExplanationText(item.explanation?.whyThis),
    ...((item.explanation?.supportingReasons || []).map((reason) => normalizeExplanationText(reason))),
  ];
  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (sameExplanationText(candidate, primaryReason)) continue;
    if (unique.some((existing) => sameExplanationText(existing, candidate))) continue;
    unique.push(candidate);
  }
  return unique;
}

function normalizeWinTitle(text: string) {
  return text.replace(/^(?:\u2728|[?]{3})\s*/, "");
}

/* Compact task row used in the block grid */
function MiniTaskRow({ t }: { t: Task }) {
  const { toast } = useToast();
  async function toggle() {
    await mutateAndInvalidate("PATCH", `/api/tasks/${t.id}`, { done: true, status: "done" }, ["/api/tasks"]);
    await mutateAndInvalidate("POST", "/api/wins", { text: t.title }, ["/api/wins", "/api/stats", "/api/wins/summary"]);
    toast({ title: "Nice - one down.", description: "Logged as a win too." });
  }
  async function pin() {
    await mutateAndInvalidate("POST", "/api/brain/accept", { candidate: { source: "task", sourceId: t.id, title: t.title, category: t.category, size: t.size, deadline: t.deadline, block: t.block }, pin: true }, ["/api/tasks"]);
  }
  return (
    <div className="group flex items-start gap-2 py-0.5" data-testid={`task-${t.id}`}>
      <button onClick={toggle} aria-label="Mark done" data-testid={`button-toggle-task-${t.id}`}
        className="mt-0.5 w-4 h-4 shrink-0 rounded-[5px] border border-input grid place-items-center hover:border-primary" />
      <button onClick={pin} className="flex-1 text-left text-sm leading-snug hover:text-primary" title="Make this your focus">
        {t.title}
        {t.deadline && <span className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${deadlineTone(t.deadline)}`}><CalendarDays className="w-2.5 h-2.5" />{formatDeadline(t.deadline)}</span>}
      </button>
    </div>
  );
}

/* Completed task row with an explicit "Promote to win" affordance (WS5). */
function DoneTaskRow({ t }: { t: Task }) {
  const { toast } = useToast();
  const winCategory: WinCategory =
    t.category === "job" || t.category === "interview" ? "job_progress"
    : t.category === "learning" ? "learning"
    : t.category === "substack" || t.category === "hustle" || t.category === "afterline" ? "proof_asset"
    : t.sourceType === "contact" ? "network" : "admin";
  async function promote() {
    await mutateAndInvalidate("POST", "/api/wins", { text: normalizeWinTitle(t.title), kind: "source", winCategory }, ["/api/wins", "/api/stats", "/api/wins/summary"]);
    toast({ title: "Logged as a win.", description: `Filed under ${WIN_CATEGORY_LABEL[winCategory]}.` });
  }
  return (
    <div className="group flex items-center gap-2 py-0.5 text-sm text-muted-foreground" data-testid={`done-task-${t.id}`}>
      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="flex-1 line-through truncate">{normalizeWinTitle(t.title)}</span>
      <button onClick={promote} data-testid={`button-promote-win-task-${t.id}`} className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 shrink-0"><Trophy className="w-3 h-3" /> Promote to win</button>
    </div>
  );
}

/* Right Now — activated focus with steps + gentle replanning */
function RightNow({ pinned, onMilestoneCompleted, pinnedPlanItem }: {
  pinned: Task;
  onMilestoneCompleted: (milestoneId: number, label: string, draft?: string) => void;
  pinnedPlanItem?: PlanItemT | null;
}) {
  const { toast } = useToast();
  const [breaking, setBreaking] = useState(false);
  const [unsticking, setUnsticking] = useState(false);
  // Synthesis panel state — local to RightNow (plan list has its own in TodayView)
  const [synthDraft, setSynthDraft] = useState("");
  const [synthCritique, setSynthCritique] = useState("");
  const [synthError, setSynthError] = useState("");
  const [synthLoadingState, setSynthLoadingState] = useState<"starter" | "critique" | null>(null);
  // P4.6a #7 — breakdown may return ONE clarifying question before it can split
  // the task. Hold it here and re-call breakdown WITH the user's answer as context.
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const steps = parseSteps(pinned.steps);
  const workflowCtx = steps[0]?.workflowState || null;
  const currentIdx = steps.findIndex((s) => !s.done);
  const current = currentIdx >= 0 ? steps[currentIdx] : null;
  const allStepsDone = steps.length > 0 && currentIdx === -1;
  const avoided = (pinned.skipped || 0) >= 2;
  const clearlyPreShrunk =
    steps.length > 0 &&
    (avoided || pinned.size === "deep" || ["job", "learn", "contact", "hustle"].includes(String(pinned.sourceType || "")));

  const autoTriggered = useRef<number | null>(null);
  const autoSynthTriggered = useRef<number | null>(null);
  useEffect(() => {
    if (steps.length === 0 && !question && !breaking && autoTriggered.current !== pinned.id) {
      autoTriggered.current = pinned.id;
      breakdown();
    }
  }, [steps.length, question, pinned.id]);

  async function breakdown(context?: string) {
    setBreaking(true);
    try {
      const res = await mutateAndInvalidate(
        "POST", `/api/tasks/${pinned.id}/breakdown`,
        context ? { context } : {}, ["/api/tasks"],
      );
      if (res && typeof res.question === "string") {
        setQuestion(res.question);
      } else {
        setQuestion(null);
        setAnswer("");
      }
    }
    catch { toast({ title: "Couldn't break it down", description: "Give it another go in a sec." }); }
    finally { setBreaking(false); }
  }
  async function answerQuestion() {
    const ctx = answer.trim();
    if (!ctx) return;
    await breakdown(ctx);
  }
  async function checkStep() {
    if (currentIdx < 0) return;
    const next = steps.map((s, i) => (i === currentIdx ? { ...s, done: true } : s));
    await mutateAndInvalidate("PATCH", `/api/tasks/${pinned.id}`, { steps: JSON.stringify(next) }, ["/api/tasks"]);
    toast({ title: next.some((s) => !s.done) ? "Nice - next step's up." : "All steps done - you did it." });
  }
  // Completion goes through the real endpoint: marks done, logs a win, updates the
  // SOURCE object (e.g. a job → applied), the plan item, and checks the MVD.
  async function finishTask() {
    const res = await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/complete`, { day: todayKey() }, ["/api/tasks", "/api/wins", "/api/wins/summary", "/api/stats", "/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
    toast({ title: "Done - and logged as a win", description: "That's momentum. Pick your next thing when ready." });
    if (res?.completedMilestoneId) {
      onMilestoneCompleted(res.completedMilestoneId, pinned.title, synthDraft || undefined);
    }
  }
  async function unstick() {
    setUnsticking(true);
    try {
      const res = await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/unstick-to-step`, {}, ["/api/tasks"]);
      toast({ title: "Added a tiny first step.", description: res.step || "Just do that one thing." });
    }
    catch { toast({ title: "Couldn't think of one", description: "Try again in a moment." }); }
    finally { setUnsticking(false); }
  }
  async function shrink() {
    await breakdown();
    toast({ title: "Made it smaller.", description: "Just the first tiny step now." });
  }
  async function moveBlock() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/move-later`, { day: todayKey() }, ["/api/tasks"]);
    toast({ title: "Moved to later today.", description: "No problem - it'll be there when you're ready." });
  }
  async function park() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/park`, { day: todayKey() }, ["/api/tasks"]);
    toast({ title: "Parked for another day.", description: "Letting it go for now is a fine choice." });
  }
  async function block() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/block`, { day: todayKey(), reason: "Marked blocked from Today" }, ["/api/tasks"]);
    toast({ title: "Marked blocked.", description: "I'll stop surfacing it until it's unblocked." });
  }

  const checkpoint = pinnedPlanItem?.explanation?.nextCheckpoint;

  async function getPinnedStarter() {
    if (!checkpoint) return;
    setSynthLoadingState("starter");
    try {
      setSynthError("");
      const res = await mutateAndInvalidate("POST", `/api/recommendation-milestones/${checkpoint.id}/synthesis-starter`, {}, []);
      if (res?.draft) setSynthDraft(res.draft);
      setSynthError(res?.error || "");
    } catch {
      setSynthError("Couldn't load a starter right now.");
    } finally { setSynthLoadingState(null); }
  }

  useEffect(() => {
    if (checkpoint && (checkpoint.milestoneType === "synthesis" || checkpoint.milestoneType === "artifact")
      && !synthDraft && !synthLoadingState && autoSynthTriggered.current !== checkpoint.id) {
      autoSynthTriggered.current = checkpoint.id;
      getPinnedStarter();
    }
  }, [checkpoint?.id, checkpoint?.milestoneType, synthDraft, synthLoadingState]);

  async function getPinnedCritique() {
    if (!checkpoint || !synthDraft.trim()) return;
    setSynthLoadingState("critique");
    try {
      setSynthError("");
      const res = await mutateAndInvalidate("POST", `/api/recommendation-milestones/${checkpoint.id}/critique`, { draft: synthDraft }, []);
      if (res?.critique) setSynthCritique(res.critique);
      setSynthError(res?.error || "");
    } catch {
      setSynthError("Couldn't critique this draft right now.");
    } finally { setSynthLoadingState(null); }
  }

  return (
    <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary mb-2">
        <Pin className="w-4 h-4" fill="currentColor" /> Right now
      </div>
      <p className="font-semibold text-lg leading-snug mb-1">{pinned.title}</p>
      {/* Source context: deadline, done-condition, and a direct link to the real thing */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
        {pinned.deadline && <span className={`text-xs font-medium ${deadlineTone(pinned.deadline)}`}>{formatDeadline(pinned.deadline)}</span>}
        {pinned.doneWhen && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Check className="w-3 h-3" /> Done when: {pinned.doneWhen}</span>}
        {pinned.sourceUrl && (
          <a href={pinned.sourceUrl} target="_blank" rel="noreferrer" data-testid="link-source"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open the posting</a>
        )}
      </div>
      {avoided && (
        <p className="text-xs rounded-lg bg-muted text-muted-foreground px-3 py-2 mb-2" data-testid="text-avoidance">
          This one's been slipping a few days - totally normal. Want it smaller, or park it kindly? No pressure.
        </p>
      )}
      {clearlyPreShrunk && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground" data-testid="badge-made-smaller">
          <Sparkles className="w-3.5 h-3.5" /> Made smaller so starting is easier
        </div>
      )}
      {steps.length === 0 && question && (
        <div className="mt-2" data-testid="breakdown-question">
          <p className="text-sm text-muted-foreground mb-1">One quick question before I break this down...</p>
          <p className="text-sm font-medium mb-2.5">{question}</p>
          <div className="flex items-center gap-2">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") answerQuestion(); }}
              placeholder="Your answer..."
              data-testid="input-breakdown-answer"
              className="flex-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            />
            <Button size="sm" onClick={answerQuestion} disabled={breaking || !answer.trim()} data-testid="button-breakdown-answer">
              {breaking ? <Loader2 className="w-4 h-4 animate-spin" /> : "Answer"}
            </Button>
          </div>
        </div>
      )}
      {steps.length === 0 && !question && (
        <div className="mt-2">
          {breaking ? (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Breaking this into steps so starting is easy...</p>
          ) : (
            <Button size="sm" variant="outline" onClick={() => breakdown()} data-testid="button-breakdown-pinned">
              <Wand2 className="w-4 h-4 mr-1" /> Break into steps
            </Button>
          )}
        </div>
      )}
      {workflowCtx?.currentStage && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-primary/80">{workflowCtx.currentStage}</span>
          {workflowCtx.stageOutput && workflowCtx.stageOutput !== pinned.doneWhen && (
            <><span aria-hidden>|</span><span>{workflowCtx.stageOutput}</span></>
          )}
        </div>
      )}
      {current && (
        <div className="mt-3">
          {/* Step progress bar — shows at a glance where you are without overwhelming */}
          {steps.length > 1 && (
            <div className="flex items-center gap-1.5 mb-2.5">
              {steps.map((s, idx) => (
                <span key={idx} className={`h-1.5 rounded-full transition-all ${
                  s.done ? "flex-1 bg-primary" : idx === currentIdx ? "flex-1 bg-primary/40" : "w-3 bg-muted"
                }`} />
              ))}
              <span className="ml-1 text-[11px] text-muted-foreground tabular-nums shrink-0">
                {steps.filter((s) => s.done).length}/{steps.length}
              </span>
            </div>
          )}
          <div
            className="group/step flex items-start gap-3 rounded-xl bg-card border-2 border-primary/25 p-3.5 cursor-pointer"
            onClick={checkStep}
            role="button"
            aria-label="Mark step done"
          >
            <button
              onClick={(e) => { e.stopPropagation(); checkStep(); }}
              data-testid="button-check-step"
              aria-label="Mark step done"
              className="mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 border-primary grid place-items-center transition-colors group-hover/step:bg-primary group-hover/step:border-primary"
            >
              <Check className="w-3 h-3 text-primary opacity-0 group-hover/step:opacity-100 group-hover/step:text-primary-foreground transition-opacity" />
            </button>
            <div className="flex-1 min-w-0">
              <span className="font-medium leading-snug">{current.text}</span>
              {current.substeps && current.substeps.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {current.substeps.map((sub, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0 mt-0.5 text-primary/40" aria-hidden>{">"}</span>
                      {sub}
                    </li>
                  ))}
                </ul>
              )}
              {steps.length > 1 && (
                <p className="text-[11px] text-muted-foreground mt-1.5">Tap to mark done - next step will appear</p>
              )}
            </div>
          </div>
          <button onClick={unstick} disabled={unsticking} data-testid="button-unstick"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary disabled:opacity-60">
              {unsticking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {unsticking ? "Adding step..." : "Stuck? Get a tiny first step"}
            </button>
        </div>
      )}
      {allStepsDone && (
        <div className="mt-3 rounded-xl bg-primary/10 border border-primary/20 p-3.5 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-primary">All steps done</p>
            <p className="text-xs text-muted-foreground mt-0.5">Finish it off and log the win.</p>
          </div>
          <Button size="sm" onClick={finishTask} data-testid="button-finish-task" className="shrink-0">
            <Check className="w-4 h-4 mr-1" /> Done
          </Button>
        </div>
      )}
      {steps.length === 0 && (
        <div className="mt-3"><Button size="sm" variant="outline" onClick={finishTask} data-testid="button-finish-task"><Check className="w-4 h-4 mr-1" /> Just mark it done</Button></div>
      )}
      {/* Milestone progress + synthesis panel for pinned task */}
      {checkpoint && (
        <div className="mt-3">
          {checkpoint.totalMilestones > 0 && (
            <p className="text-[11px] text-muted-foreground mb-1.5 font-medium">
              {checkpoint.doneCount}/{checkpoint.totalMilestones} milestones done
              {checkpoint.doneWhen && <span className="ml-1 font-normal">· Done when: {checkpoint.doneWhen}</span>}
            </p>
          )}
          {checkpoint.milestoneType === "content" && checkpoint.scaffolding && (
            <div className="rounded-lg border border-card-border bg-muted/30 px-3 py-2 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">As you work, ask yourself</p>
              <ul className="space-y-1">
                {checkpoint.scaffolding.split(" | ").filter(Boolean).map((q, qi) => (
                  <li key={qi} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="shrink-0 text-muted-foreground/50 mt-0.5">›</span><span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(checkpoint.milestoneType === "synthesis" || checkpoint.milestoneType === "artifact") && (
            <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-900/10 px-3 py-2.5 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
                {checkpoint.milestoneType === "artifact" ? "Draft your answer" : "Synthesise what you've learned"}
              </p>
              {checkpoint.completionNotes?.length > 0 && (
                <div className="mb-2 rounded-md bg-amber-100/50 dark:bg-amber-800/20 px-2.5 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70 mb-1">What you noted before</p>
                  <ul className="space-y-0.5">
                    {checkpoint.completionNotes.map((note, ni) => (
                      <li key={ni} className="text-xs text-amber-800/80 dark:text-amber-300/80 flex gap-1.5">
                        <span className="shrink-0 mt-0.5">·</span><span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {checkpoint.scaffolding && (
                <ul className="space-y-1 mb-2">
                  {checkpoint.scaffolding.split(" | ").filter(Boolean).map((q, qi) => (
                    <li key={qi} className="text-xs text-amber-800/80 dark:text-amber-300/80 flex gap-1.5">
                      <span className="shrink-0 mt-0.5">›</span><span>{q}</span>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                className="w-full min-h-[80px] text-xs rounded-md border border-amber-200 bg-white/70 dark:bg-amber-900/20 dark:border-amber-700/40 px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
                placeholder={checkpoint.milestoneType === "artifact" ? "Write your draft here…" : "Write your synthesis here…"}
                value={synthDraft}
                onChange={(e) => setSynthDraft(e.target.value)}
              />
              <div className="flex gap-2 mt-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-100"
                  disabled={synthLoadingState === "starter"}
                  onClick={getPinnedStarter}>
                  {synthLoadingState === "starter" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                  Get a starter draft
                </Button>
                {synthDraft.trim() && (
                  <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-100"
                    disabled={synthLoadingState === "critique"}
                    onClick={getPinnedCritique}>
                    {synthLoadingState === "critique" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <MoveRight className="w-3 h-3 mr-1" />}
                    Push back on this
                  </Button>
                )}
              </div>
              {synthError && (
                <div className="mt-2 rounded-md border border-amber-300/70 bg-white/70 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
                  {synthError}
                </div>
              )}
              {synthCritique && (
                <div className="mt-2 rounded-md bg-amber-100/60 dark:bg-amber-900/30 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
                  {synthCritique}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 pt-3 border-t border-primary/15 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Need a smaller next move?</span>
          <button onClick={shrink} data-testid="button-shrink" className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1">
            <Wand2 className="w-3.5 h-3.5" /> Make it smaller
          </button>
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none inline-flex items-center gap-1">
            Need a different move?
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-card-border bg-card px-3 py-2.5">
            <button onClick={moveBlock} data-testid="button-move" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><MoveRight className="w-3.5 h-3.5" /> Move to later</button>
            <button onClick={park} data-testid="button-park" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><MoonStar className="w-3.5 h-3.5" /> Park for another day</button>
            <button onClick={block} data-testid="button-block" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> I'm blocked</button>
          </div>
        </details>
      </div>
    </div>
  );
}

function TodayBrief({
  goal,
  brief,
  searchPicture,
  showDetails,
  onToggleDetails,
}: {
  goal: CareerGoalT;
  brief: ReturnType<typeof goalMorningBriefWithExecution>;
  searchPicture: {
    activeTracks: number;
    rolesInView: number;
    liveProcesses: number;
    interviews: number;
    activeConversations: number;
    dueFollowUps: number;
  };
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5" data-testid="today-brief">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-primary font-semibold">{brief.eyebrow}</p>
          <p className="text-sm text-muted-foreground mt-1">{brief.intro}</p>
        </div>
        <button
          type="button"
          onClick={onToggleDetails}
          className="shrink-0 text-xs text-primary font-medium hover:underline"
          data-testid="button-toggle-today-strategy"
        >
          {showDetails ? "Hide fuller strategy" : "See fuller strategy"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-primary border border-card-border">
          <Target className="w-3 h-3" /> {brief.stateLabel}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-card-border">
          <Sparkles className="w-3 h-3" /> {brief.blockerLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 border border-card-border">
          <Target className="w-3 h-3 text-primary" />
          <span className="font-semibold text-foreground tabular-nums">{searchPicture.activeTracks}</span>
          {searchPicture.activeTracks === 1 ? "role type" : "role types"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 border border-card-border">
          <Briefcase className="w-3 h-3 text-primary" />
          <span className="font-semibold text-foreground tabular-nums">{searchPicture.rolesInView}</span>
          {searchPicture.rolesInView === 1 ? "role in view" : "roles in view"}
        </span>
        {searchPicture.liveProcesses > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 border border-card-border">
            <Check className="w-3 h-3 text-primary" />
            <span className="font-semibold text-foreground tabular-nums">{searchPicture.liveProcesses}</span>
            {searchPicture.liveProcesses === 1 ? "live process" : "live processes"}
          </span>
        )}
        {searchPicture.interviews > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 border border-card-border">
            <Sparkles className="w-3 h-3 text-primary" />
            <span className="font-semibold text-foreground tabular-nums">{searchPicture.interviews}</span>
            {searchPicture.interviews === 1 ? "interview" : "interviews"}
          </span>
        )}
        {searchPicture.activeConversations > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 border border-card-border">
            <Users className="w-3 h-3 text-primary" />
            <span className="font-semibold text-foreground tabular-nums">{searchPicture.activeConversations}</span>
            {searchPicture.activeConversations === 1 ? "conversation moving" : "conversations moving"}
          </span>
        )}
        {searchPicture.dueFollowUps > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 border border-card-border">
            <CalendarDays className="w-3 h-3 text-primary" />
            <span className="font-semibold text-foreground tabular-nums">{searchPicture.dueFollowUps}</span>
            {searchPicture.dueFollowUps === 1 ? "follow-up due" : "follow-ups due"}
          </span>
        )}
      </div>
      {brief.summary && (
        <p className="text-sm font-medium mt-3">{brief.summary}</p>
      )}
      <div className="mt-3 rounded-xl border border-card-border bg-card px-3 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{brief.bestUseLabel}</p>
        <p className="text-sm font-medium mt-1">{brief.bestUseText || goal.todayPlan.mustDo}</p>
      </div>
    </div>
  );
}

export function TodayView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { data: tracks = [], isLoading: tracksLoading, isError: tracksError } = useCareerTracks();
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: diagnosticsData } = useQuery({ queryKey: ["/api/strategy/diagnostics"] });
  const { data: recommendations = [] } = useRecommendations<Recommendation[]>();
  const diagnosticTracks = (diagnosticsData as any)?.tracks || [];
  const day = todayKey();
  const { data: events = [] } = useQuery<Event[]>({ queryKey: ["/api/events", day] });
  const { data: stats } = useQuery<{
    doneThisWeek: number;
    jobProgressThisWeek: number;
    networkThisWeek: number;
    learningThisWeek: number;
    proofAssetThisWeek: number;
    actionsToday: number;
    startsToday: number;
    streak: number;
    yesterdayCompleted: number;
    yesterdayTotal: number;
  }>({ queryKey: ["/api/stats"] });
  const { toast } = useToast();

  const today = tasks.filter((t) => t.list === "today" && !t.done);
  const doneToday = tasks.filter((t) => t.list === "today" && t.done);
  const pinned = today.find((t) => t.pinned);

  const [plan, setPlan] = useState<DayPlanT | null>(null);
  const [planItems, setPlanItems] = useState<PlanItemT[]>([]);
  const pinnedPlanItem = pinned ? planItems.find((it) => it.id === pinned.planItemId) || null : null;
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [showCompass, setShowCompass] = useState(false);
  const [showSecondary, setShowSecondary] = useState<boolean | null>(null);
  const [showDoneList, setShowDoneList] = useState<boolean | null>(null);
  const [showUpcomingPlan, setShowUpcomingPlan] = useState<boolean | null>(null);
  const [showEnergyControls, setShowEnergyControls] = useState(false);
  // Quick-capture: get a stray thought out of your head from Today, without
  // leaving the screen. Lands in the inbox (shows up in Brain dump to sort
  // later) — deliberately NOT onto today, so the plan below stays calm.
  const [quickText, setQuickText] = useState("");
  const [capturingQuick, setCapturingQuick] = useState(false);
  const [quickCaptureNote, setQuickCaptureNote] = useState("");
  // Milestone completion capture — shown after a task is done that advanced a milestone
  const [milestoneCapture, setMilestoneCapture] = useState<{ milestoneId: number; label: string } | null>(null);
  const [captureNote, setCaptureNote] = useState("");
  const [savingCapture, setSavingCapture] = useState(false);
  // Synthesis/artifact panel state — keyed by plan item id
  const [synthDrafts, setSynthDrafts] = useState<Record<number, string>>({});
  const [synthCritiques, setSynthCritiques] = useState<Record<number, string>>({});
  const [synthErrors, setSynthErrors] = useState<Record<number, string>>({});
  const [synthLoading, setSynthLoading] = useState<Record<number, "starter" | "critique" | null>>({});

  async function saveMilestoneCapture() {
    if (!milestoneCapture || savingCapture) return;
    setSavingCapture(true);
    try {
      if (captureNote.trim()) {
        await mutateAndInvalidate("PATCH", `/api/recommendation-milestones/${milestoneCapture.milestoneId}`, { completionNote: captureNote.trim() }, []);
      }
    } finally {
      setSavingCapture(false);
      setMilestoneCapture(null);
      setCaptureNote("");
    }
  }
  async function getSynthesisStarter(itemId: number, milestoneId: number) {
    setSynthLoading((s) => ({ ...s, [itemId]: "starter" }));
    try {
      setSynthErrors((s) => ({ ...s, [itemId]: "" }));
      const res = await mutateAndInvalidate("POST", `/api/recommendation-milestones/${milestoneId}/synthesis-starter`, {}, []);
      if (res?.draft) setSynthDrafts((d) => ({ ...d, [itemId]: res.draft }));
      setSynthErrors((s) => ({ ...s, [itemId]: res?.error || "" }));
    } catch {
      setSynthErrors((s) => ({ ...s, [itemId]: "Couldn't load a starter right now." }));
    } finally { setSynthLoading((s) => ({ ...s, [itemId]: null })); }
  }
  async function getCritique(itemId: number, milestoneId: number) {
    const draft = synthDrafts[itemId];
    if (!draft?.trim()) return;
    setSynthLoading((s) => ({ ...s, [itemId]: "critique" }));
    try {
      setSynthErrors((s) => ({ ...s, [itemId]: "" }));
      const res = await mutateAndInvalidate("POST", `/api/recommendation-milestones/${milestoneId}/critique`, { draft }, []);
      if (res?.critique) setSynthCritiques((c) => ({ ...c, [itemId]: res.critique }));
      setSynthErrors((s) => ({ ...s, [itemId]: res?.error || "" }));
    } catch {
      setSynthErrors((s) => ({ ...s, [itemId]: "Couldn't critique this draft right now." }));
    } finally { setSynthLoading((s) => ({ ...s, [itemId]: null })); }
  }

  async function quickCapture() {
    const t = quickText.trim();
    if (!t || capturingQuick) return;
    setCapturingQuick(true);
    setQuickCaptureNote("");
    setQuickText("");
    try {
      await mutateAndInvalidate("POST", "/api/tasks", { title: t, list: "inbox", done: false }, ["/api/tasks"]);
      setQuickCaptureNote("Saved to Brain dump. It's out of your head and off today's plan.");
      toast({ title: "Captured.", description: "It's out of your head. I kept it off today's plan." });
    } catch {
      setQuickText(t);
      toast({ title: "Couldn't capture that", description: "Try again in a moment." });
    } finally {
      setCapturingQuick(false);
    }
  }
  const [energy, setEnergy] = useState(defaultEnergyForNow);
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));

  // Load the PERSISTED plan (it lives in the DB now — survives reloads).
  useEffect(() => {
    if (isLoading || tracksLoading || tracks.length === 0 || pinned || plan || loadingPlan) return;
    getPlan(energy, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, tracksLoading, pinned, tracks.length]);

  async function getPlan(e: string, recompute = false, preferCurrent = false) {
    setLoadingPlan(true);
    try {
      // On first load, prefer the persisted plan if one exists. Explicit energy
      // changes still reshuffle the day.
      const r = recompute || (!preferCurrent && e !== "medium")
        ? await mutateAndInvalidate("POST", "/api/plan/recompute", { energy: e, day }, [])
        : await mutateAndInvalidate("GET", `/api/plan/current?day=${day}&energy=${e}`, undefined, []);
      setPlan(r?.plan || null); setPlanItems(Array.isArray(r?.items) ? r.items : []);
      setShowUpcomingPlan(null);
      if (typeof r?.plan?.energy === "string" && ["low", "medium", "high"].includes(r.plan.energy)) {
        setEnergy(r.plan.energy);
      }
    } catch { toast({ title: "Couldn't shape the day", description: "Try again in a moment." }); }
    finally { setLoadingPlan(false); }
  }

  async function retunePlan(e: string) {
    setEnergy(e);
    setShowEnergyControls(false);
    await getPlan(e, true);
  }

  // Start an item via the IDENTITY-PRESERVING endpoint: it reads the exact plan
  // item id, creates/reuses the backing task, links taskId both ways, derives the
  // block from the slot (no hardcoded "morning"), and preserves source/doneWhen.
  async function startItem(it: PlanItemT) {
    await mutateAndInvalidate("POST", `/api/plan-items/${it.id}/start`, { day }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles"]);
    setPlan(null); setPlanItems([]);
    toast({ title: "Started - this is your focus.", description: "Tiny steps next. One at a time." });
  }

  const executionState = deriveTodayExecutionState({
    todayTasks: today,
    doneTodayTasks: doneToday,
    planItems,
    events,
    pinnedTask: pinned,
    plan,
    isLoadingPlan: isLoading || loadingPlan,
  });
  const activeItems = executionState.activeItems;
  const isMVD = (it: PlanItemT) => plan?.minimumViableItemId === it.id;
  const hasPrimaryFocus = executionState.hasPrimaryFocus;
  const secondaryOpen = showSecondary ?? executionState.defaultSecondaryOpen;
  const doneListOpen = showDoneList ?? executionState.defaultDoneListOpen;
  const upcomingPlanOpen = showUpcomingPlan ?? false;

  const hadPinned = useRef(false);
  useEffect(() => {
    if (pinned) { hadPinned.current = true; return; }
    if (!hadPinned.current) return;
    hadPinned.current = false;
    if (plan?.enoughForToday) return;
    const next = activeItems[0];
    if (next) startItem(next);
  }, [pinned, activeItems.length]);

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; })();

  // Only gate to onboarding once the tracks query has GENUINELY resolved to an
  // empty list. On a cold backend wake the query can error (retry is off), which
  // leaves tracks defaulting to [] — treating that as "zero tracks" would flash
  // onboarding at a user who actually has data. So an error is NOT empty.
  if (!tracksLoading && !tracksError && !isLoading && tracks.length === 0) return <OnboardingView />;
  const activeGoal = goalState?.goals?.[0] || null;
  const introLine = goalTodayIntroLine(activeGoal);
  const todayBrief = goalMorningBriefWithExecution(activeGoal, executionState.briefInput);
  const activeTrackCount = diagnosticTracks.filter((track: any) => track.status === "active").length;
  const pipeline = activeGoal?.opportunityState?.pipeline;
  const searchPicture = {
    activeTracks: activeTrackCount,
    rolesInView: pipeline?.viableRoles || pipeline?.savedRoles || 0,
    liveProcesses: pipeline?.liveProcesses || 0,
    interviews: pipeline?.interviews || 0,
    activeConversations: pipeline?.activeConversations || 0,
    dueFollowUps: pipeline?.dueFollowUps || 0,
  };

  return (
    <div>
      {/* Milestone completion capture modal */}
      {milestoneCapture && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-card-border p-5 shadow-xl">
            <p className="text-sm font-semibold mb-1">Nice — step complete.</p>
            <p className="text-xs text-muted-foreground mb-3">
              What's the one thing you'll actually carry from this? (Optional — but it builds your prep notes over time.)
            </p>
            <textarea
              autoFocus
              className="w-full min-h-[70px] text-sm rounded-lg border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="e.g. The EU AI Act creates risk tiers — high-risk systems face pre-market approval, unlike the US voluntary approach"
              value={captureNote}
              onChange={(e) => setCaptureNote(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="flex-1" onClick={saveMilestoneCapture} disabled={savingCapture}>
                {savingCapture ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />} Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMilestoneCapture(null)}>Skip</Button>
            </div>
          </div>
        </div>
      )}
      <h1 className="text-xl font-bold tracking-tight">{greeting}, Rohini</h1>
      {!activeGoal && <p className="text-sm text-muted-foreground mt-1 mb-3">{introLine}</p>}
      {stats && (stats.doneThisWeek > 0 || stats.actionsToday > 0 || stats.streak > 1) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {stats.streak > 1 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
              <span className="font-semibold text-foreground tabular-nums">{stats.streak}</span>
              day streak
            </span>
          )}
          {stats.actionsToday > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-foreground tabular-nums">{stats.actionsToday}</span>
              done today
            </span>
          )}
          {stats.doneThisWeek > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Trophy className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-foreground tabular-nums">{stats.doneThisWeek}</span>
              {stats.doneThisWeek === 1 ? "win" : "wins"} this week
            </span>
          )}
          {stats.jobProgressThisWeek > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Briefcase className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-foreground tabular-nums">{stats.jobProgressThisWeek}</span>
              job {stats.jobProgressThisWeek === 1 ? "move" : "moves"}
            </span>
          )}
          {stats.networkThisWeek > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-foreground tabular-nums">{stats.networkThisWeek}</span>
              network {stats.networkThisWeek === 1 ? "touch" : "touches"}
            </span>
          )}
          {stats.learningThisWeek > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <GraduationCap className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-foreground tabular-nums">{stats.learningThisWeek}</span>
              learning
            </span>
          )}
        </div>
      )}

      {/* Quick-capture — always here so a stray thought never needs another tab. */}
      {activeGoal && (
        <>
          <TodayBrief
            goal={activeGoal}
            brief={todayBrief}
            searchPicture={searchPicture}
            showDetails={showCompass}
            onToggleDetails={() => setShowCompass((current) => !current)}
          />
          {showCompass && <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" />}
        </>
      )}
      <div className="mb-5 rounded-xl border border-card-border bg-card p-3.5">
        <div className="flex gap-2">
          <Input
            value={quickText}
            onChange={(e) => { setQuickText(e.target.value); if (quickCaptureNote) setQuickCaptureNote(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") quickCapture(); }}
            placeholder="Get a thought out of your head..."
            className="h-10"
            data-testid="input-quick-capture"
            disabled={capturingQuick}
          />
          <Button
            className="h-10 px-3 shrink-0"
            variant="outline"
            onClick={quickCapture}
            data-testid="button-quick-capture"
            disabled={capturingQuick || !quickText.trim()}
          >
            {capturingQuick ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
            {capturingQuick ? "Saving..." : "Capture"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            This goes to Brain dump, not today's plan. You can sort it later.
          </p>
          {quickCaptureNote ? (
            <button
              type="button"
              onClick={() => onOpenTab("braindump")}
              className="text-xs text-primary hover:underline"
              data-testid="button-open-braindump-after-capture"
            >
              {quickCaptureNote} Open Brain dump
            </button>
          ) : null}
        </div>
      </div>

      {/* Thin calendar line */}
      {events.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <CalendarDays className="w-4 h-4 text-primary" />
          {events.map((e, i) => (
            <span key={e.id} className="inline-flex items-center gap-1.5" data-testid={`event-${e.id}`}>
              <span className="text-foreground font-medium tabular-nums">{e.start}</span>{e.title}{i < events.length - 1 && <span className="opacity-40 ml-1">|</span>}
            </span>
          ))}
        </div>
      )}

      {/* Yesterday recap — only shown when yesterday had a plan */}
      {stats && stats.yesterdayTotal > 0 && !pinned && (
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground" data-testid="yesterday-recap">
          <span className="font-medium tabular-nums">{stats.yesterdayCompleted}/{stats.yesterdayTotal}</span>
          <span>done yesterday{stats.yesterdayCompleted === stats.yesterdayTotal ? " — clean sweep" : stats.yesterdayCompleted === 0 ? " — fresh start today" : ""}</span>
          {stats.streak > 1 && (
            <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400">
              <Flame className="w-3 h-3" /> {stats.streak}d streak
            </span>
          )}
        </div>
      )}

      {/* HERO: either the active focus, or the day plan */}
      {pinned ? (
        <RightNow
          pinned={pinned}
          onMilestoneCompleted={(milestoneId, label, draft) => { setMilestoneCapture({ milestoneId, label }); setCaptureNote(draft || ""); }}
          pinnedPlanItem={pinnedPlanItem}
        />
      ) : (
        <div className="mb-6">
          {isLoading || loadingPlan ? (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Shaping your day...</div>
            </div>
          ) : plan && plan.enoughForToday ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 text-center" data-testid="done-enough">
              <div className="inline-flex items-center gap-2 text-primary font-semibold"><Check className="w-5 h-5" /> Today counts.</div>
              <p className="text-sm text-muted-foreground mt-1.5">You did the one thing that mattered. Anything else is a bonus - you can stop here.</p>
              {activeItems.length > 0 && (
                <button onClick={() => setPlan({ ...plan, enoughForToday: false })} className="mt-3 text-xs text-muted-foreground hover:text-foreground underline">show the rest anyway</button>
              )}
            </div>
          ) : plan && activeItems.length > 0 ? (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                  <Target className="w-4 h-4" /> Today, in order
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline text-[11px] text-muted-foreground">
                    Auto-set for a {energyModeLabel(energy)} day
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowEnergyControls((current) => !current)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    data-testid="button-toggle-energy-controls"
                  >
                    {showEnergyControls ? "Hide energy" : "Adjust energy"}
                  </button>
                </div>
              </div>
              {showEnergyControls && (
                <div className="mb-3 rounded-xl border border-card-border bg-card/75 px-3 py-2.5" aria-label="Energy level">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([["low", "Low"], ["medium", "Medium"], ["high", "High"]] as const).map(([v, l]) => (
                      <button
                        key={v}
                        onClick={() => retunePlan(v)}
                        data-testid={`energy-${v}`}
                        className={`px-2 py-1 rounded-full text-xs font-medium border transition-colors ${energy === v ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Only change this if the plan feels too heavy or too light.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {activeItems.map((it, i) => {
                  if (i > 0 && !upcomingPlanOpen) return null;
                  const linkedTask = it.taskId ? taskById.get(it.taskId) : undefined;
                  const nextStepText = firstStepPreview(it, linkedTask);
                  const preShrunk = isPreShrunkPlanItem(it);
                  const showPreviewStep = !!nextStepText;
                  const broadPursuitItem = isBroadPursuitGoalItem(it, activeGoal);
                  const broadPursuitCoverage = broadPursuitItem && activeGoal ? getBroadPursuitCoverage(activeGoal) : null;
                  const broadPursuitLines = broadPursuitCoverage ? broadPursuitGapLines(broadPursuitCoverage) : [];
                  const compactTitle = broadPursuitItem ? (broadPursuitPlanTitle(activeGoal) || it.title) : it.title;
                  const broadPursuitSummary = broadPursuitItem ? broadPursuitPrimarySummary(activeGoal) : "";
                  const compactSummary = primaryPlanReason(it, broadPursuitSummary);
                  const extraReasons = secondaryPlanReasons(it, compactSummary, broadPursuitSummary);
                  const visibleReasons = i === 0 ? extraReasons.slice(0, 2) : [];
                  const hiddenReasons = i === 0 ? extraReasons.slice(2) : extraReasons;
                  return (
                  <div key={it.id} data-testid={`plan-item-${i}`} data-plan-rank={String(i)}
                    className={`group w-full flex items-start gap-3 rounded-xl bg-card border p-3.5 transition-colors ${isMVD(it) ? "border-primary/40" : "border-card-border"}`}>
                    <span className={`shrink-0 mt-0.5 rounded-md text-[11px] font-semibold px-2 py-1 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>{SLOT_LABEL[it.slot] || it.slot}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium leading-snug">{compactTitle}</p>
                        {(() => {
                          const est = linkedTask?.estimateMinutes;
                          if (!est) return null;
                          return (
                            <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5 shrink-0">
                              ~{est < 60 ? `${est}m` : `${Math.round(est / 60)}h`}
                            </span>
                          );
                        })()}
                        {isMVD(it) && <span className="shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">do this & today counts</span>}
                        {preShrunk && <span className="shrink-0 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-0.5">made smaller to help you start</span>}
                      </div>
                      {compactSummary && <p className="text-xs text-muted-foreground mt-0.5">{compactSummary}</p>}
                      {visibleReasons.length > 0 && (
                        <div className="mt-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Why this is first</p>
                          <div className="mt-1.5 space-y-1">
                            {visibleReasons.map((reason, reasonIndex) => (
                              <p key={`${it.id}-visible-reason-${reasonIndex}`} className="text-xs text-muted-foreground">
                                {reason}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      {broadPursuitCoverage && broadPursuitLines.length > 0 && broadPursuitLines[0].key !== "covered" && (
                        <div className="mt-2 rounded-lg border border-card-border bg-muted/35 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What's left to add</p>
                          <div className="mt-1.5 space-y-1.5">
                            {broadPursuitLines.map((line) => (
                              <p key={line.key} className="text-xs text-muted-foreground">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${line.tone}`}>{line.label}</span>
                                <span className="ml-2">{line.text}</span>
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      {showPreviewStep && nextStepText && (
                        <div className="mt-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                              {preShrunk ? "First tiny step" : "Smallest useful move"}
                            </p>
                            {(it.explanation?.nextCheckpoint?.totalMilestones ?? 0) > 0 && (
                              <span className="text-[10px] font-medium text-primary/60 shrink-0">
                                {it.explanation!.nextCheckpoint!.doneCount}/{it.explanation!.nextCheckpoint!.totalMilestones} done
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-foreground mt-1">{nextStepText}</p>
                          {it.explanation?.nextCheckpoint?.doneWhen && (
                            <p className="text-[11px] text-primary/70 mt-1.5 border-t border-primary/10 pt-1.5">
                              <span className="font-semibold">Done when:</span> {it.explanation.nextCheckpoint.doneWhen}
                            </p>
                          )}
                        </div>
                      )}
                      {/* Scaffolding questions for content milestones */}
                      {it.explanation?.nextCheckpoint?.scaffolding && it.explanation.nextCheckpoint.milestoneType === "content" && (
                        <div className="mt-2 rounded-lg border border-card-border bg-muted/30 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">As you go, ask yourself</p>
                          <ul className="space-y-1">
                            {it.explanation.nextCheckpoint.scaffolding.split(" | ").filter(Boolean).map((q, qi) => (
                              <li key={qi} className="text-xs text-muted-foreground flex gap-1.5">
                                <span className="shrink-0 text-muted-foreground/50 mt-0.5">›</span>
                                <span>{q}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* Synthesis / artifact panel — interactive drafting workspace */}
                      {it.explanation?.nextCheckpoint && (it.explanation.nextCheckpoint.milestoneType === "synthesis" || it.explanation.nextCheckpoint.milestoneType === "artifact") && (
                        <div className="mt-2 rounded-lg border border-amber-200/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-900/10 px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
                            {it.explanation.nextCheckpoint.milestoneType === "artifact" ? "Draft your answer" : "Synthesise what you've learned"}
                          </p>
                          {it.explanation.nextCheckpoint.completionNotes?.length > 0 && (
                            <div className="mb-2 rounded-md bg-amber-100/50 dark:bg-amber-800/20 px-2.5 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70 mb-1">What you noted before</p>
                              <ul className="space-y-0.5">
                                {it.explanation.nextCheckpoint.completionNotes.map((note, ni) => (
                                  <li key={ni} className="text-xs text-amber-800/80 dark:text-amber-300/80 flex gap-1.5">
                                    <span className="shrink-0 mt-0.5">·</span><span>{note}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {it.explanation.nextCheckpoint.scaffolding && (
                            <ul className="space-y-1 mb-2">
                              {it.explanation.nextCheckpoint.scaffolding.split(" | ").filter(Boolean).map((q, qi) => (
                                <li key={qi} className="text-xs text-amber-800/80 dark:text-amber-300/80 flex gap-1.5">
                                  <span className="shrink-0 mt-0.5">›</span><span>{q}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <textarea
                            className="w-full min-h-[80px] text-xs rounded-md border border-amber-200 bg-white/70 dark:bg-amber-900/20 dark:border-amber-700/40 px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
                            placeholder={it.explanation.nextCheckpoint.milestoneType === "artifact" ? "Write your draft here…" : "Write your synthesis here…"}
                            value={synthDrafts[it.id] || ""}
                            onChange={(e) => setSynthDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                          />
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-100"
                              disabled={synthLoading[it.id] === "starter"}
                              onClick={() => getSynthesisStarter(it.id, it.explanation!.nextCheckpoint!.id)}>
                              {synthLoading[it.id] === "starter" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                              Get a starter draft
                            </Button>
                            {synthDrafts[it.id]?.trim() && (
                              <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-100"
                                disabled={synthLoading[it.id] === "critique"}
                                onClick={() => getCritique(it.id, it.explanation!.nextCheckpoint!.id)}>
                                {synthLoading[it.id] === "critique" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <MoveRight className="w-3 h-3 mr-1" />}
                                Push back on this
                              </Button>
                            )}
                          </div>
                          {synthErrors[it.id] && (
                            <div className="mt-2 rounded-md border border-amber-300/70 bg-white/70 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
                              {synthErrors[it.id]}
                            </div>
                          )}
                          {synthCritiques[it.id] && (
                            <div className="mt-2 rounded-md bg-amber-100/60 dark:bg-amber-900/30 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
                              {synthCritiques[it.id]}
                            </div>
                          )}
                        </div>
                      )}
                      {hiddenReasons.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground list-none">
                            Why this is on your list
                          </summary>
                          <div className="mt-2 space-y-1.5 rounded-lg border border-card-border bg-muted/35 px-3 py-2">
                            {hiddenReasons.map((reason, reasonIndex) => (
                              <p key={`${it.id}-reason-${reasonIndex}`} className="text-xs text-muted-foreground">
                                {reason}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                      {it.doneWhen && <p className="text-xs text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Done when: {it.doneWhen}</p>}
                      {linkedTask?.sourceUrl && (
                        <a href={linkedTask.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <ExternalLink className="w-3 h-3" /> View source
                        </a>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 self-center text-muted-foreground group-hover:text-primary"
                      onClick={() => startItem(it)}
                      data-testid={`button-start-plan-item-${i}`}
                    >
                      Start <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )})}
              </div>
              {activeItems.length > 1 && (
                <div className="mt-3 rounded-xl border border-card-border bg-card/70 px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() => setShowUpcomingPlan((current) => current == null ? !upcomingPlanOpen : !current)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                    data-testid="button-toggle-upcoming-plan"
                  >
                    <div>
                      <p className="text-sm font-medium">{upcomingPlanOpen ? "Hide later cards" : `Show ${activeItems.length - 1} later card${activeItems.length - 1 === 1 ? "" : "s"}`}</p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">
                        {upcomingPlanOpen
                          ? "Keep these visible if it helps, but you only need to start with the first card."
                          : `${activeItems.length - 1} more planned move${activeItems.length - 1 === 1 ? "" : "s"} can wait until the first card is started.`}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                      {activeItems.length - 1}
                      <ChevronRight className={`w-4 h-4 transition-transform ${upcomingPlanOpen ? "rotate-90" : ""}`} />
                    </span>
                  </button>
                </div>
              )}
              {plan.note && <p className="text-xs text-muted-foreground mt-3 italic">{plan.note}</p>}
            </div>
          ) : (
            <StrategicNextSteps
              tracks={diagnosticTracks}
              recommendations={recommendations}
              onOpenTab={onOpenTab}
            />
          )}
        </div>
      )}

      {/* Strategic compact callout — shown when plan has items but track still has unaddressed bottlenecks */}
      {!pinned && activeItems.length > 0 && diagnosticTracks.some((t: any) => t.status === "active" && t.bottleneck !== "none" && t.bottleneck !== "execution") && (
        <StrategicNextSteps
          tracks={diagnosticTracks}
          recommendations={recommendations}
          onOpenTab={onOpenTab}
          compact
          modeFilter="setup-only"
        />
      )}

      {/* Also on your list — ONE secondary list, deduped against the plan above.
          No morning/afternoon/evening buckets: the plan IS the order, so a second
          time-of-day model would just compete with it. We only show tasks the plan
          hasn't already surfaced, so nothing appears twice. */}
      {(() => {
        // A task is already "in the plan" if a plan item is backed by it, or points
        // at the same source object (e.g. the same job/learn/hustle).
        const planTaskIds = new Set(activeItems.map((it) => it.taskId).filter(Boolean) as number[]);
        const planSourceKeys = new Set(
          activeItems.filter((it) => it.sourceType && it.sourceId != null).map((it) => `${it.sourceType}:${it.sourceId}`)
        );
        const alsoToday = today.filter((t) =>
          !t.pinned &&
          !planTaskIds.has(t.id) &&
          !(t.sourceType && t.sourceId != null && planSourceKeys.has(`${t.sourceType}:${t.sourceId}`))
        );
        if (alsoToday.length === 0 && doneToday.length === 0) return null;
        return (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2.5">
              <GroupLabel>{alsoToday.length > 0 ? "Other tasks" : "Done today"}</GroupLabel>
            </div>
            {alsoToday.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-3.5">
                <button
                  type="button"
                  onClick={() => setShowSecondary((current) => current == null ? !secondaryOpen : !current)}
                  className="w-full flex items-center justify-between gap-3 text-left"
                  data-testid="button-toggle-secondary-tasks"
                >
                  <div>
                    <p className="text-sm font-medium">{hasPrimaryFocus ? "If you still have room" : "Other tasks"}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {hasPrimaryFocus
                        ? `${alsoToday.length} more task${alsoToday.length === 1 ? "" : "s"} sit outside today's order. Ignore these until the main plan is done.`
                        : `${alsoToday.length} task${alsoToday.length === 1 ? "" : "s"} waiting outside the main plan.`}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    {alsoToday.length}
                    <ChevronRight className={`w-4 h-4 transition-transform ${secondaryOpen ? "rotate-90" : ""}`} />
                  </span>
                </button>
                {secondaryOpen && (
                  <div className="space-y-1 mt-3 pt-3 border-t border-card-border">
                    {alsoToday.map((t) => <MiniTaskRow key={t.id} t={t} />)}
                  </div>
                )}
              </div>
            )}
            {/* Completed today — each can be explicitly promoted to a categorised win */}
            {doneToday.length > 0 && (
              <div className="mt-3 rounded-xl border border-card-border bg-card p-3.5">
                <button
                  type="button"
                  onClick={() => setShowDoneList((current) => current == null ? !doneListOpen : !current)}
                  className="w-full flex items-center justify-between gap-3 text-left"
                  data-testid="button-toggle-done-today"
                >
                  <div>
                    <p className="text-sm font-medium">Done today</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {doneToday.length} thing{doneToday.length === 1 ? "" : "s"} finished. Open this if you want to log or review them.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    {doneToday.length}
                    <ChevronRight className={`w-4 h-4 transition-transform ${doneListOpen ? "rotate-90" : ""}`} />
                  </span>
                </button>
                {doneListOpen && (
                  <div className="mt-3 pt-3 border-t border-card-border space-y-1">
                    {doneToday.map((t) => <DoneTaskRow key={t.id} t={t} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
