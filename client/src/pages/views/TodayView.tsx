import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  MoonStar,
  MoveRight,
  Pin,
  Plus,
  Sparkles,
  Target,
  Trophy,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CareerCompassCard } from "@/components/home/CareerCompassCard";
import { GroupLabel } from "@/components/home/GroupLabel";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import {
  broadPursuitPlanTitle,
  DayPlanT,
  firstStepPreview,
  GoalsStateResponseT,
  getBroadPursuitCoverage,
  isBroadPursuitGoalItem,
  isPreShrunkPlanItem,
  PlanItemT,
  SLOT_LABEL,
} from "@/lib/goalSpine";
import {
  deadlineTone,
  formatDeadline,
  parseSteps,
  type Tab,
  todayKey,
  WIN_CATEGORY_LABEL,
} from "@/lib/homeTypes";
import type { Event, Task } from "@shared/schema";
import type { WinCategory } from "@shared/domainState";

function RightNow({ pinned }: { pinned: Task }) {
  const { toast } = useToast();
  const [breaking, setBreaking] = useState(false);
  const [unsticking, setUnsticking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const steps = parseSteps(pinned.steps);
  const currentIdx = steps.findIndex((s) => !s.done);
  const current = currentIdx >= 0 ? steps[currentIdx] : null;
  const allStepsDone = steps.length > 0 && currentIdx === -1;
  const avoided = (pinned.skipped || 0) >= 2;
  const clearlyPreShrunk =
    steps.length > 0 &&
    (avoided || pinned.size === "deep" || ["job", "learn", "contact", "hustle"].includes(String(pinned.sourceType || "")));

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
    setHint(null);
    await mutateAndInvalidate("PATCH", `/api/tasks/${pinned.id}`, { steps: JSON.stringify(next) }, ["/api/tasks"]);
    toast({ title: next.some((s) => !s.done) ? "Nice — next step's up." : "All steps done — you did it." });
  }
  async function finishTask() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/complete`, { day: todayKey() }, ["/api/tasks", "/api/wins", "/api/stats", "/api/jobs"]);
    toast({ title: "Done — and logged as a win 🎉", description: "That's momentum. Pick your next thing when ready." });
  }
  async function unstick() {
    if (!current) return;
    setUnsticking(true);
    try { const res = await mutateAndInvalidate("POST", "/api/unstick", { step: current.text }, []); setHint(res.hint || null); }
    catch { toast({ title: "Couldn't think of one", description: "Try again in a moment." }); }
    finally { setUnsticking(false); }
  }
  async function shrink() {
    await breakdown();
    toast({ title: "Made it smaller.", description: "Just the first tiny step now." });
  }
  async function moveBlock() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/move-later`, { day: todayKey() }, ["/api/tasks"]);
    toast({ title: "Moved to later today.", description: "No problem — it'll be there when you're ready." });
  }
  async function park() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/park`, { day: todayKey() }, ["/api/tasks"]);
    toast({ title: "Parked for another day.", description: "Letting it go for now is a fine choice." });
  }
  async function block() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/block`, { day: todayKey(), reason: "Marked blocked from Today" }, ["/api/tasks"]);
    toast({ title: "Marked blocked.", description: "I'll stop surfacing it until it's unblocked." });
  }

  return (
    <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary mb-2">
        <Pin className="w-4 h-4" fill="currentColor" /> Right now
      </div>
      <p className="font-semibold text-lg leading-snug mb-1">{pinned.title}</p>
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
          This one's been slipping a few days — totally normal. Want it smaller, or park it kindly? No pressure.
        </p>
      )}
      {clearlyPreShrunk && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground" data-testid="badge-made-smaller">
          <Sparkles className="w-3.5 h-3.5" /> Made smaller so starting is easier
        </div>
      )}
      {steps.length === 0 && question && (
        <div className="mt-2" data-testid="breakdown-question">
          <p className="text-sm text-muted-foreground mb-1">One quick question before I break this down…</p>
          <p className="text-sm font-medium mb-2.5">{question}</p>
          <div className="flex items-center gap-2">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") answerQuestion(); }}
              placeholder="Your answer…"
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
          <p className="text-sm text-muted-foreground mb-2.5">Want me to break it into tiny steps so starting is easy?</p>
          <Button size="sm" onClick={() => breakdown()} disabled={breaking} data-testid="button-breakdown-pinned">
            {breaking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />} Break into tiny steps
          </Button>
        </div>
      )}
      {current && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground mb-1.5">Your one next step ({steps.filter((s) => s.done).length}/{steps.length} done):</p>
          <div className="flex items-start gap-3 rounded-lg bg-card border border-card-border p-3">
            <button onClick={checkStep} aria-label="Mark step done" data-testid="button-check-step"
              className="mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 border-primary grid place-items-center hover-elevate" />
            <span className="flex-1 font-medium leading-snug">{current.text}</span>
          </div>
          {steps.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              You do not need to hold the whole task in your head. Finish this step and I&apos;ll surface the next one.
            </p>
          )}
          {hint ? (
            <p className="mt-2 text-sm rounded-lg bg-accent text-accent-foreground px-3 py-2" data-testid="text-unstick-hint">✨ {hint}</p>
          ) : (
            <button onClick={unstick} disabled={unsticking} data-testid="button-unstick"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary disabled:opacity-60">
              {unsticking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {unsticking ? "Thinking…" : "Stuck? help me start"}
            </button>
          )}
        </div>
      )}
      {allStepsDone && (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm text-muted-foreground flex-1">All steps done — finish it off.</p>
          <Button size="sm" onClick={finishTask} data-testid="button-finish-task"><Check className="w-4 h-4 mr-1" /> Mark done</Button>
        </div>
      )}
      {steps.length === 0 && (
        <div className="mt-3"><Button size="sm" variant="outline" onClick={finishTask} data-testid="button-finish-task"><Check className="w-4 h-4 mr-1" /> Just mark it done</Button></div>
      )}
      <div className="mt-4 pt-3 border-t border-primary/15 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-muted-foreground">Not feeling it?</span>
        <button onClick={shrink} data-testid="button-shrink" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><Wand2 className="w-3.5 h-3.5" /> Make it smaller</button>
        <button onClick={moveBlock} data-testid="button-move" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><MoveRight className="w-3.5 h-3.5" /> Move to later</button>
        <button onClick={park} data-testid="button-park" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><MoonStar className="w-3.5 h-3.5" /> Park for another day</button>
        <button onClick={block} data-testid="button-block" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> I'm blocked</button>
      </div>
    </div>
  );
}

function MiniTaskRow({ t }: { t: Task }) {
  const { toast } = useToast();
  async function toggle() {
    await mutateAndInvalidate("PATCH", `/api/tasks/${t.id}`, { done: true, status: "done" }, ["/api/tasks"]);
    await mutateAndInvalidate("POST", "/api/wins", { text: t.title }, ["/api/wins", "/api/stats"]);
    toast({ title: "Nice — one down.", description: "Logged as a win too." });
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

function DoneTaskRow({ t }: { t: Task }) {
  const { toast } = useToast();
  const winCategory: WinCategory =
    t.category === "job" || t.category === "interview" ? "job_progress"
    : t.category === "learning" ? "learning"
    : t.category === "substack" || t.category === "hustle" || t.category === "afterline" ? "proof_asset"
    : t.sourceType === "contact" ? "network" : "admin";
  async function promote() {
    await mutateAndInvalidate("POST", "/api/wins", { text: t.title.replace(/^✨\s*/, ""), kind: "source", winCategory }, ["/api/wins", "/api/stats"]);
    toast({ title: "Logged as a win 🎉", description: `Filed under ${WIN_CATEGORY_LABEL[winCategory]}.` });
  }
  return (
    <div className="group flex items-center gap-2 py-0.5 text-sm text-muted-foreground" data-testid={`done-task-${t.id}`}>
      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="flex-1 line-through truncate">{t.title.replace(/^✨\s*/, "")}</span>
      <button onClick={promote} data-testid={`button-promote-win-task-${t.id}`} className="opacity-0 group-hover:opacity-100 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 shrink-0"><Trophy className="w-3 h-3" /> Promote to win</button>
    </div>
  );
}

export default function TodayView({
  onOpenTab,
  onboardingFallback,
}: {
  onOpenTab: (t: Tab) => void;
  onboardingFallback?: ReactNode;
}) {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { data: tracks = [], isLoading: tracksLoading, isError: tracksError } = useCareerTracks();
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const day = todayKey();
  const { data: events = [] } = useQuery<Event[]>({ queryKey: ["/api/events", day] });
  const { data: stats } = useQuery<{ doneThisWeek: number }>({ queryKey: ["/api/stats"] });
  const { toast } = useToast();

  const today = tasks.filter((t) => t.list === "today" && !t.done);
  const doneToday = tasks.filter((t) => t.list === "today" && t.done);
  const pinned = today.find((t) => t.pinned);

  const [plan, setPlan] = useState<DayPlanT | null>(null);
  const [planItems, setPlanItems] = useState<PlanItemT[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [quickText, setQuickText] = useState("");
  async function quickCapture() {
    const t = quickText.trim();
    if (!t) return;
    setQuickText("");
    const created = await mutateAndInvalidate("POST", "/api/tasks", { title: t, list: "inbox", done: false }, ["/api/tasks"]);
    if (created?.id) mutateAndInvalidate("POST", `/api/tasks/${created.id}/enrich`, {}, ["/api/tasks"]).catch(() => {});
    toast({ title: "Captured.", description: "It's in your brain dump — sort it whenever." });
  }
  const [showCapacity, setShowCapacity] = useState(false);
  const [energy, setEnergy] = useState("medium");
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));

  useEffect(() => {
    if (isLoading || tracksLoading || tracks.length === 0 || pinned || plan || loadingPlan) return;
    getPlan("medium");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, tracksLoading, pinned, tracks.length]);

  async function getPlan(e: string) {
    setLoadingPlan(true);
    try {
      const r = e !== "medium" || showCapacity
        ? await mutateAndInvalidate("POST", "/api/plan/recompute", { energy: e, day }, [])
        : await mutateAndInvalidate("GET", `/api/plan/current?day=${day}&energy=${e}`, undefined, []);
      setPlan(r?.plan || null); setPlanItems(Array.isArray(r?.items) ? r.items : []); setShowCapacity(false);
    } catch { toast({ title: "Couldn't shape the day", description: "Try again in a moment." }); }
    finally { setLoadingPlan(false); }
  }
  async function startItem(it: PlanItemT) {
    await mutateAndInvalidate("POST", `/api/plan-items/${it.id}/start`, { day }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles"]);
    setPlan(null); setPlanItems([]);
    toast({ title: "Started — this is your focus.", description: "Tiny steps next. One at a time." });
  }

  const activeItems = planItems.filter((it) => it.status === "planned" || it.status === "started");
  const isMVD = (it: PlanItemT) => plan?.minimumViableItemId === it.id;

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; })();

  if (!tracksLoading && !tracksError && !isLoading && tracks.length === 0) return <>{onboardingFallback ?? null}</>;
  const activeGoal = goalState?.goals?.[0] || null;

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">{greeting}, Rohini</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-3">Here's your day. Start at the top — you don't have to decide.</p>

      {activeGoal && <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" />}
      <div className="mb-5 flex gap-2">
        <Input value={quickText} onChange={(e) => setQuickText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") quickCapture(); }}
          placeholder="Add anything on your mind…" className="h-10" data-testid="input-quick-capture" />
        <Button className="h-10 px-3 shrink-0" variant="outline" onClick={quickCapture} data-testid="button-quick-capture"><Plus className="w-4 h-4 mr-1" /> Capture</Button>
      </div>

      {events.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <CalendarDays className="w-4 h-4 text-primary" />
          {events.map((e, i) => (
            <span key={e.id} className="inline-flex items-center gap-1.5" data-testid={`event-${e.id}`}>
              <span className="text-foreground font-medium tabular-nums">{e.start}</span>{e.title}{i < events.length - 1 && <span className="opacity-40 ml-1">·</span>}
            </span>
          ))}
        </div>
      )}

      {pinned ? (
        <RightNow pinned={pinned} />
      ) : (
        <div className="mb-6">
          {isLoading || loadingPlan ? (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Shaping your day…</div>
            </div>
          ) : plan && plan.enoughForToday ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 text-center" data-testid="done-enough">
              <div className="inline-flex items-center gap-2 text-primary font-semibold"><Check className="w-5 h-5" /> Today counts.</div>
              <p className="text-sm text-muted-foreground mt-1.5">You did the one thing that mattered. Anything else is a bonus — you can stop here.</p>
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
                <button onClick={() => setShowCapacity((s) => !s)} data-testid="button-replan" className="text-xs text-muted-foreground hover:text-foreground">
                  different kind of day?
                </button>
              </div>
              {showCapacity && (
                <div className="mb-3 rounded-lg bg-card border border-card-border p-3">
                  <p className="text-xs text-muted-foreground mb-2">How's your energy? I'll reshape around it.</p>
                  <div className="flex gap-1.5">
                    {[["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([v, l]) => (
                      <button key={v} onClick={() => { setEnergy(v); getPlan(v); }} data-testid={`energy-${v}`}
                        className={`px-3 py-1.5 rounded-full text-sm border ${energy === v ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:text-foreground"}`}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {activeItems.map((it, i) => {
                  const linkedTask = it.taskId ? taskById.get(it.taskId) : undefined;
                  const nextStepText = firstStepPreview(it, linkedTask);
                  const preShrunk = isPreShrunkPlanItem(it);
                  const showPreviewStep = !!nextStepText && (preShrunk || !linkedTask || !it.taskId || i === 0);
                  const broadPursuitItem = isBroadPursuitGoalItem(it, activeGoal);
                  const broadPursuitCoverage = broadPursuitItem && activeGoal ? getBroadPursuitCoverage(activeGoal) : null;
                  const compactTitle = broadPursuitItem ? (broadPursuitPlanTitle(activeGoal) || it.title) : it.title;
                  const compactSummary = broadPursuitItem
                    ? "One credible role per lane is enough to start getting real market signal."
                    : (it.explanation?.summary || it.whySelected);
                  return (
                    <button key={it.id} onClick={() => startItem(it)} data-testid={`plan-item-${i}`}
                      className={`group w-full text-left flex items-start gap-3 rounded-xl bg-card border p-3.5 hover-elevate transition-colors ${isMVD(it) ? "border-primary/40" : "border-card-border"}`}>
                      <span className={`shrink-0 mt-0.5 rounded-md text-[11px] font-semibold px-2 py-1 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>{SLOT_LABEL[it.slot] || it.slot}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium leading-snug">{compactTitle}</p>
                          {isMVD(it) && <span className="shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">do this & today counts</span>}
                          {preShrunk && <span className="shrink-0 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-0.5">made smaller to help you start</span>}
                        </div>
                        {compactSummary && <p className="text-xs text-muted-foreground mt-0.5">{compactSummary}</p>}
                        {broadPursuitCoverage && broadPursuitCoverage.missing.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {broadPursuitCoverage.missing.map((combination) => (
                              <span
                                key={combination}
                                className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                              >
                                {combination}
                              </span>
                            ))}
                          </div>
                        )}
                        {!broadPursuitItem && it.explanation?.whyNow && it.explanation.whyNow !== (it.explanation.summary || it.whySelected) && <p className="text-xs text-muted-foreground/80 mt-0.5">{it.explanation.whyNow}</p>}
                        {showPreviewStep && nextStepText && (
                          <div className="mt-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                              {preShrunk ? "First tiny step" : "Smallest useful move"}
                            </p>
                            <p className="text-xs text-foreground mt-1">{nextStepText}</p>
                          </div>
                        )}
                        {it.doneWhen && <p className="text-xs text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Done when: {it.doneWhen}</p>}
                      </div>
                      <span className="shrink-0 self-center text-muted-foreground group-hover:text-primary inline-flex items-center gap-1 text-xs font-medium">Start <ChevronRight className="w-4 h-4" /></span>
                    </button>
                  );
                })}
              </div>
              {plan.note && <p className="text-xs text-muted-foreground mt-3 italic">{plan.note}</p>}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">Nothing queued to plan yet. Add a thought, a job, or something to learn — then I'll shape a day.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onOpenTab("braindump")}>Brain dump</Button>
                <Button size="sm" variant="outline" onClick={() => getPlan(energy)}>Try again</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(() => {
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
              <GroupLabel>{alsoToday.length > 0 ? "Also on your list" : "Done today"}</GroupLabel>
              {stats && stats.doneThisWeek > 0 && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1" data-testid="text-momentum">
                  <Trophy className="w-3.5 h-3.5 text-primary" /> {stats.doneThisWeek} done this week
                </span>
              )}
            </div>
            {alsoToday.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-3.5">
                <p className="text-xs text-muted-foreground/70 mb-2">Not part of today's order — pick one up only if you have room.</p>
                <div className="space-y-1">
                  {alsoToday.map((t) => <MiniTaskRow key={t.id} t={t} />)}
                </div>
              </div>
            )}
            {doneToday.length > 0 && (
              <div className="mt-3 space-y-1">
                {doneToday.map((t) => <DoneTaskRow key={t.id} t={t} />)}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
