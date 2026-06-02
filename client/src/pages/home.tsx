import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sun, Moon, Sparkles, ListTodo, Briefcase, GraduationCap, Trophy,
  Plus, X, ArrowRight, Check, ExternalLink, Clock, Trash2,
  Target, Pin, Wand2, Loader2, CalendarDays, Star, ChevronDown, ChevronRight,
  Rocket, MoveRight, MoonStar, Lightbulb, Users, MessageCircle, RefreshCw,
  Compass, ArrowUpRight, Link2, ListChecks, AlertTriangle,
} from "lucide-react";
import { AnchorLogo } from "@/components/AnchorLogo";
import { useTheme } from "@/components/ThemeProvider";
import { mutateAndInvalidate } from "@/lib/api";
import type { Task, Job, Learn, Win, Event, Hustle, Contact, CareerTrack } from "@shared/schema";
import { type TrackedEntity, getTrackId, WIN_CATEGORIES, type WinCategory } from "@shared/domainState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

type Step = { text: string; done: boolean };
function parseSteps(raw: string): Step[] {
  try { const s = JSON.parse(raw || "[]"); return Array.isArray(s) ? s : []; } catch { return []; }
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const SIZE_LABEL: Record<string, string> = { quick: "quick", medium: "~45m", deep: "deep" };
function sizeChipLabel(s: string) { return s === "medium" ? "~45m" : s; }

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

type Tab = "today" | "strategy" | "braindump" | "jobs" | "network" | "learn" | "hustle" | "wins";
const MORE_TABS: { id: Tab; label: string; icon: typeof Sun; blurb: string }[] = [
  { id: "strategy", label: "Strategy", icon: Compass, blurb: "Your paths, at a glance" },
  { id: "braindump", label: "Brain dump", icon: Sparkles, blurb: "Empty your head" },
  { id: "jobs", label: "Jobs", icon: Briefcase, blurb: "Your applications" },
  { id: "network", label: "Network", icon: Users, blurb: "People to reach" },
  { id: "learn", label: "Learn", icon: GraduationCap, blurb: "What you're learning" },
  { id: "hustle", label: "Hustle", icon: Rocket, blurb: "Projects & side income" },
  { id: "wins", label: "Wins", icon: Trophy, blurb: "What's gone well" },
];

export default function Home() {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>("today");
  const [moreOpen, setMoreOpen] = useState(false);
  function go(t: Tab) { setTab(t); setMoreOpen(false); }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => go("today")} className="flex items-center gap-2.5" data-testid="button-home">
            <span className="text-primary"><AnchorLogo className="w-7 h-7" /></span>
            <div className="leading-tight text-left">
              <div className="font-bold text-lg tracking-tight" data-testid="text-appname">Anchor</div>
              <div className="text-xs text-muted-foreground -mt-0.5">your calm home base</div>
            </div>
          </button>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <button onClick={() => setMoreOpen((o) => !o)} data-testid="button-more"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium hover-elevate ${tab !== "today" ? "text-foreground" : "text-muted-foreground"}`}>
                More <ChevronDown className={`w-4 h-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 mt-1 w-56 rounded-xl border border-card-border bg-card shadow-lg p-1.5 z-40">
                    {MORE_TABS.map(({ id, label, icon: Icon, blurb }) => (
                      <button key={id} onClick={() => go(id)} data-testid={`tab-${id}`}
                        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left hover-elevate ${tab === id ? "text-primary" : ""}`}>
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1">
                          <span className="block text-sm font-medium leading-tight">{label}</span>
                          <span className="block text-xs text-muted-foreground">{blurb}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={toggle} aria-label="Toggle theme" data-testid="button-theme"
              className="w-9 h-9 grid place-items-center rounded-md hover-elevate text-muted-foreground">
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-7">
        {tab !== "today" && (
          <button onClick={() => go("today")} data-testid="button-back-today" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight className="w-4 h-4 rotate-180" /> Back to Today
          </button>
        )}
        {tab === "today" && <TodayView onOpenTab={go} />}
        {tab === "strategy" && <StrategyView onOpenTab={go} />}
        {tab === "braindump" && <BrainDumpView />}
        {tab === "jobs" && <JobsView />}
        {tab === "network" && <NetworkView />}
        {tab === "learn" && <LearnView />}
        {tab === "hustle" && <HustleView />}
        {tab === "wins" && <WinsView />}
      </main>
    </div>
  );
}

/* ---------------- shared bits ---------------- */
function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1 max-w-xl">{sub}</p>
    </div>
  );
}
function GroupLabel({ children, count }: { children: any; count?: number }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
      {children}{typeof count === "number" && <span className="tabular-nums opacity-70">({count})</span>}
    </div>
  );
}
function Empty({ icon: Icon, text }: { icon: typeof Sun; text: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <Icon className="w-8 h-8 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
function Loading() {
  return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}</div>;
}

/* ---------------- P3.5 shared: track coherence + card actions + clarity ---------------- */
const ENTITY_QUERY: Record<TrackedEntity, string> = {
  jobs: "/api/jobs", learn: "/api/learn", contacts: "/api/contacts", hustles: "/api/hustles", tasks: "/api/tasks",
};

function useCareerTracks() {
  return useQuery<CareerTrack[]>({ queryKey: ["/api/career-tracks"] });
}

// A small pill showing the linked track, or an "unlinked" warning when none.
function TrackChip({ trackId, tracks }: { trackId: number | null; tracks: CareerTrack[] }) {
  if (!trackId) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid="badge-unlinked">
        <AlertTriangle className="w-2.5 h-2.5" /> unlinked
      </span>
    );
  }
  const t = tracks.find((x) => x.id === trackId);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" data-testid="badge-track">
      <Compass className="w-2.5 h-2.5" /> {t?.name || `Track ${trackId}`}
    </span>
  );
}

// Popover control to link/unlink an entity to a career track in place.
function LinkTrackControl({ entity, id, trackId, tracks }: { entity: TrackedEntity; id: number; trackId: number | null; tracks: CareerTrack[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  async function link(next: number | null) {
    await mutateAndInvalidate("PATCH", `/api/${entity}/${id}/link-track`, { trackId: next }, [ENTITY_QUERY[entity], "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked"]);
    setOpen(false);
    toast({ title: next ? "Linked to track." : "Unlinked.", description: next ? "It'll show up under this path in Strategy." : "Removed from its track." });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid={`button-link-track-${entity}-${id}`} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
          <Link2 className="w-3.5 h-3.5" /> {trackId ? "Track" : "Link track"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5" align="start">
        <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a track</p>
        <div className="space-y-0.5">
          {tracks.map((t) => (
            <button key={t.id} onClick={() => link(t.id)} data-testid={`option-track-${t.id}`}
              className={`w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate ${trackId === t.id ? "text-primary font-medium" : ""}`}>
              {t.name}
            </button>
          ))}
          {trackId && (
            <button onClick={() => link(null)} className="w-full text-left text-sm px-2 py-1.5 rounded-md text-muted-foreground hover-elevate">Unlink</button>
          )}
          {tracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tracks yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Consistent actions row for source cards: Create next task / View linked tasks / Link track.
function CardActions({ entity, id, trackId, tracks, onViewTasks }: { entity: Exclude<TrackedEntity, "tasks">; id: number; trackId: number | null; tracks: CareerTrack[]; onViewTasks: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function createNext() {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/${entity}/${id}/create-next-task`, {}, ["/api/tasks"]);
      toast({ title: r?.reused ? "Already on your list." : "Next task created.", description: r?.reused ? "There's already an open task for this." : "Find it in your inbox / brain dump." });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 pt-2 border-t border-card-border">
      <button onClick={createNext} disabled={busy} data-testid={`button-create-next-${entity}-${id}`} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create next task
      </button>
      <button onClick={onViewTasks} data-testid={`button-view-tasks-${entity}-${id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ListChecks className="w-3.5 h-3.5" /> View linked tasks
      </button>
      <LinkTrackControl entity={entity} id={id} trackId={trackId} tracks={tracks} />
    </div>
  );
}

// Small constraint badge used in card clarity strips.
function ConstraintBadge({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" }) {
  const cls = tone === "warn" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{text}</span>;
}

// Count of open (not done) tasks serving a given source — for "View linked tasks".
function useLinkedTaskCount(tasks: Task[], sourceType: string, sourceId: number) {
  return tasks.filter((t) => t.sourceType === sourceType && t.sourceId === sourceId && !t.done).length;
}

/* ================= TODAY (day-first hero) ================= */
type PlanItemT = { id: number; slot: string; title: string; whySelected: string; doneWhen: string; status: string; sourceType: string; sourceId: number | null; taskId: number | null };
type DayPlanT = { id: number; mode: string; note: string; status: string; minimumViableItemId: number | null; enoughForToday: boolean };
const SLOT_LABEL: Record<string, string> = { now: "Now", next: "Next", later: "Later", bonus: "Bonus" };

function TodayView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
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
  const [showCapacity, setShowCapacity] = useState(false);
  const [energy, setEnergy] = useState("medium");

  // Load the PERSISTED plan (it lives in the DB now — survives reloads).
  useEffect(() => {
    if (isLoading || pinned || plan || loadingPlan) return;
    getPlan("medium");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, pinned]);

  async function getPlan(e: string) {
    setLoadingPlan(true);
    try {
      // Recompute when energy is explicitly chosen; otherwise just read current.
      const r = e !== "medium" || showCapacity
        ? await mutateAndInvalidate("POST", "/api/plan/recompute", { energy: e, day }, [])
        : await mutateAndInvalidate("GET", `/api/plan/current?day=${day}&energy=${e}`, undefined, []);
      setPlan(r?.plan || null); setPlanItems(Array.isArray(r?.items) ? r.items : []); setShowCapacity(false);
    } catch { toast({ title: "Couldn't shape the day", description: "Try again in a moment." }); }
    finally { setLoadingPlan(false); }
  }
  // Start an item: materialise it as the active focus, carrying its source context.
  async function startItem(it: PlanItemT) {
    const candidate = {
      source: it.sourceType, sourceId: it.sourceId, title: it.title,
      category: it.sourceType === "job" ? "job" : it.sourceType === "learn" ? "learning" : it.sourceType === "hustle" ? "hustle" : "admin",
      size: "medium", deadline: "", doneWhen: it.doneWhen, block: "morning",
    };
    await mutateAndInvalidate("POST", "/api/brain/accept", { candidate, pin: true }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles"]);
    setPlan(null); setPlanItems([]);
    toast({ title: "Started — this is your focus.", description: "Tiny steps next. One at a time." });
  }

  const activeItems = planItems.filter((it) => it.status === "planned" || it.status === "started");
  const isMVD = (it: PlanItemT) => plan?.minimumViableItemId === it.id;

  // Daily Coach — ONE concrete next action. Tap to drop it into the day; "something
  // else" swaps it. Not a list, no browsing.
  type CoachSug = { title: string; category: string; size: string; why: string };
  const [coach, setCoach] = useState<CoachSug | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachDone, setCoachDone] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  async function fetchCoach(exclude: string[]) {
    setCoachLoading(true);
    try {
      const r = await mutateAndInvalidate("POST", "/api/coach", { exclude }, []);
      setCoach(r?.suggestion || null);
    } catch { setCoach(null); }
    finally { setCoachLoading(false); }
  }
  useEffect(() => {
    if (isLoading) return;
    const key = `coach-${day}`;
    if ((window as any).__coachRan === key) return;
    (window as any).__coachRan = key;
    fetchCoach([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, day]);
  async function acceptCoach() {
    if (!coach) return;
    await mutateAndInvalidate("POST", "/api/coach/accept", coach, ["/api/tasks"]);
    setCoachDone(true);
    toast({ title: "Added to today.", description: "It's slotted into your day." });
  }
  function anotherCoach() {
    if (!coach) return;
    const next = [...seen, coach.title];
    setSeen(next);
    fetchCoach(next);
  }

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; })();

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">{greeting}, Rohini</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-5">Here's your day — a few different things, not one giant list. You don't have to decide.</p>

      {/* Thin calendar line */}
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

      {/* HERO: either the active focus, or the day plan */}
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
                {activeItems.map((it, i) => (
                  <button key={it.id} onClick={() => startItem(it)} data-testid={`plan-item-${i}`}
                    className={`group w-full text-left flex items-start gap-3 rounded-xl bg-card border p-3.5 hover-elevate transition-colors ${isMVD(it) ? "border-primary/40" : "border-card-border"}`}>
                    <span className={`shrink-0 mt-0.5 rounded-md text-[11px] font-semibold px-2 py-1 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>{SLOT_LABEL[it.slot] || it.slot}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium leading-snug">{it.title}</p>
                        {isMVD(it) && <span className="shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">do this & today counts</span>}
                      </div>
                      {it.whySelected && <p className="text-xs text-muted-foreground mt-0.5">{it.whySelected}</p>}
                      {it.doneWhen && <p className="text-xs text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Done when: {it.doneWhen}</p>}
                    </div>
                    <span className="shrink-0 self-center text-muted-foreground group-hover:text-primary inline-flex items-center gap-1 text-xs font-medium">Start <ChevronRight className="w-4 h-4" /></span>
                  </button>
                ))}
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

      {/* Coach — ONE concrete next action, one tap into the day */}
      {!coachDone && (coachLoading || coach) && (
        <div className="mb-6 rounded-xl border border-accent-foreground/15 bg-accent/40 p-4" data-testid="coach-card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-foreground mb-2">
            <Lightbulb className="w-4 h-4" /> Coach
          </div>
          {coachLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Thinking of your next move…</div>
          ) : coach ? (
            <div>
              <p className="text-sm font-medium leading-snug">{coach.title}</p>
              {coach.why && <p className="text-xs text-muted-foreground mt-0.5">{coach.why}</p>}
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={acceptCoach} data-testid="button-coach-accept"><Plus className="w-4 h-4 mr-1" /> Do this today</Button>
                <button onClick={anotherCoach} data-testid="button-coach-another" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> something else</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {coachDone && (
        <p className="mb-6 text-sm text-muted-foreground inline-flex items-center gap-1.5"><Check className="w-4 h-4 text-primary" /> Coach's pick is in your day.</p>
      )}

      {/* The rest of the day — secondary, below the fold */}
      {(today.filter((t) => !t.pinned).length > 0 || doneToday.length > 0) && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2.5">
            <GroupLabel>The rest of today</GroupLabel>
            {stats && stats.doneThisWeek > 0 && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1" data-testid="text-momentum">
                <Trophy className="w-3.5 h-3.5 text-primary" /> {stats.doneThisWeek} done this week
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["morning", "afternoon", "evening"].map((block) => {
              const items = today.filter((t) => t.block === block && !t.pinned);
              return (
                <div key={block} className="rounded-xl border border-card-border bg-card p-3.5">
                  <div className="flex items-center gap-1.5 mb-2"><Clock className="w-3.5 h-3.5 text-muted-foreground" /><h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground capitalize">{block}</h2></div>
                  <div className="space-y-1">
                    {items.map((t) => <MiniTaskRow key={t.id} t={t} />)}
                    {items.length === 0 && <p className="text-xs text-muted-foreground/60 py-0.5">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Completed today — each can be explicitly promoted to a categorised win */}
          {doneToday.length > 0 && (
            <div className="mt-3 space-y-1">
              {doneToday.map((t) => <DoneTaskRow key={t.id} t={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= STRATEGY (the quiet bird's-eye view) ================= */
type StrategyTrack = {
  id: number; slug: string; name: string; status: string; priority: number; whyItFits: string;
  roles: number; applied: number; topFit: number;
  learning: number; learningActive: number;
  contacts: number; warmContacts: number;
  proofAssets: number; proofLive: number;
  bottleneck: string; nextMove: string;
};
type TrackDiagnostic = {
  id: number; slug: string; name: string; status: string; priority: number; whyItFits: string;
  counts: { jobs: number; learn: number; contacts: number; hustles: number; tasks: number };
  signals: { directionGap: number; readinessGap: number; proofGap: number; warmthGap: number; executionGap: number };
  bottleneck: string; bottleneckLabel: string; recommendedMove: string;
};
type UnlinkedItem = { entity: "jobs" | "learn" | "contacts" | "hustles"; id: number; title: string; status: string };
const BOTTLENECK_LABEL: Record<string, string> = {
  direction: "Direction", readiness: "Readiness", proof: "Proof", warmth: "Warmth", execution: "Execution", none: "Healthy",
};
function StrategyView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const { data, isLoading } = useQuery<{ tracks: StrategyTrack[]; insights: string[] }>({ queryKey: ["/api/strategy"] });
  const { data: diag } = useQuery<{ tracks: TrackDiagnostic[] }>({ queryKey: ["/api/strategy/diagnostics"] });
  const { data: unlinked } = useQuery<{ items: UnlinkedItem[]; counts: Record<string, number> }>({ queryKey: ["/api/strategy/unlinked"] });
  const { data: careerTracks = [] } = useCareerTracks();
  if (isLoading) return <Loading />;
  const tracks = data?.tracks || [];
  const insights = data?.insights || [];
  const diagById = new Map((diag?.tracks || []).map((d) => [d.id, d] as const));
  const unlinkedItems = unlinked?.items || [];
  const active = tracks.filter((t) => t.status === "active");
  const watching = tracks.filter((t) => t.status !== "active");

  const Stat = ({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) => (
    <div className="flex flex-col">
      <span className={`text-sm font-semibold tabular-nums ${dim ? "text-muted-foreground" : "text-foreground"}`}>{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );

  const Card = ({ t }: { t: StrategyTrack }) => {
    const d = diagById.get(t.id);
    // Prefer the computed diagnostic (the five bottleneck types); fall back to the
    // legacy /api/strategy bottleneck text if diagnostics haven't loaded.
    const bottleneckLabel = d ? d.bottleneckLabel : t.bottleneck;
    const recommendedMove = d ? d.recommendedMove : t.nextMove;
    const health = d?.bottleneck ?? "none";
    return (
      <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`track-${t.slug}`}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug">{t.name}</h3>
            {t.whyItFits && <p className="text-xs text-muted-foreground mt-0.5">{t.whyItFits}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full text-[11px] font-semibold px-2 py-0.5 ${health === "none" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`} data-testid={`track-health-${t.slug}`}>{BOTTLENECK_LABEL[health] || health}</span>
            {t.topFit > 0 && <span className="rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-2 py-0.5">fit {t.topFit}</span>}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <Stat label="Roles" value={t.roles} dim={t.roles === 0} />
          <Stat label="Learning" value={t.learning} dim={t.learning === 0} />
          <Stat label="Contacts" value={t.contacts} dim={t.contacts === 0} />
          <Stat label="Proof" value={t.proofLive ? `${t.proofLive}/${t.proofAssets}` : t.proofAssets} dim={t.proofAssets === 0} />
        </div>
        <div className="rounded-lg bg-muted/60 px-3 py-2">
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Bottleneck:</span> {bottleneckLabel}</p>
          <p className="text-xs text-primary mt-1 inline-flex items-center gap-1"><ArrowUpRight className="w-3.5 h-3.5" /> {recommendedMove}</p>
        </div>
      </div>
    );
  };

  const ENTITY_TAB: Record<UnlinkedItem["entity"], Tab> = { jobs: "jobs", learn: "learn", contacts: "network", hustles: "hustle" };
  const ENTITY_LABEL: Record<UnlinkedItem["entity"], string> = { jobs: "Job", learn: "Learn", contacts: "Contact", hustles: "Proof" };
  async function linkUnlinked(it: UnlinkedItem, trackId: number) {
    await mutateAndInvalidate("PATCH", `/api/${it.entity}/${it.id}/link-track`, { trackId }, [`/api/${it.entity}`, "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked"]);
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Your paths</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-5">The bird's-eye view — where each path stands and the one thing holding it back. Today stays your calm execution screen; this is just for orientation.</p>

      {insights.length > 0 && (
        <div className="mb-6 space-y-2">
          {insights.map((ins, i) => (
            <div key={i} className="rounded-xl border border-accent-foreground/15 bg-accent/40 p-4 flex items-start gap-2.5" data-testid={`insight-${i}`}>
              <Lightbulb className="w-4 h-4 text-accent-foreground shrink-0 mt-0.5" />
              <p className="text-sm leading-snug">{ins}</p>
            </div>
          ))}
        </div>
      )}

      <GroupLabel>Active paths</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
        {active.map((t) => <Card key={t.id} t={t} />)}
      </div>

      {watching.length > 0 && (
        <>
          <GroupLabel>Watching</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {watching.map((t) => <Card key={t.id} t={t} />)}
          </div>
        </>
      )}

      {/* Unlinked bucket — orphaned source items, fixable in place */}
      {unlinkedItems.length > 0 && (
        <div className="mb-6">
          <GroupLabel count={unlinkedItems.length}><AlertTriangle className="w-4 h-4 text-destructive" /> Unlinked — no track yet</GroupLabel>
          <p className="text-xs text-muted-foreground mb-2">These live items aren't tied to a path, so they don't count toward any track's health. Link each one.</p>
          <div className="space-y-2">
            {unlinkedItems.map((it) => (
              <div key={`${it.entity}-${it.id}`} className="flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2" data-testid={`unlinked-${it.entity}-${it.id}`}>
                <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 shrink-0">{ENTITY_LABEL[it.entity]}</span>
                <span className="flex-1 text-sm truncate">{it.title}</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 shrink-0" data-testid={`button-link-unlinked-${it.entity}-${it.id}`}><Link2 className="w-3.5 h-3.5" /> Link</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-1.5" align="end">
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a track</p>
                    <div className="space-y-0.5">
                      {careerTracks.map((t) => (
                        <button key={t.id} onClick={() => linkUnlinked(it, t.id)} className="w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate">{t.name}</button>
                      ))}
                      {careerTracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tracks yet.</p>}
                    </div>
                  </PopoverContent>
                </Popover>
                <button onClick={() => onOpenTab(ENTITY_TAB[it.entity])} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onOpenTab("jobs")}><Briefcase className="w-4 h-4 mr-1" /> Jobs</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("network")}><Users className="w-4 h-4 mr-1" /> Network</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("today")}><Target className="w-4 h-4 mr-1" /> Back to Today</Button>
      </div>
    </div>
  );
}

/* Right Now — activated focus with steps + gentle replanning */
function RightNow({ pinned }: { pinned: Task }) {
  const { toast } = useToast();
  const [breaking, setBreaking] = useState(false);
  const [unsticking, setUnsticking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const steps = parseSteps(pinned.steps);
  const currentIdx = steps.findIndex((s) => !s.done);
  const current = currentIdx >= 0 ? steps[currentIdx] : null;
  const allStepsDone = steps.length > 0 && currentIdx === -1;
  const avoided = (pinned.skipped || 0) >= 2;

  async function breakdown() {
    setBreaking(true);
    try { await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/breakdown`, {}, ["/api/tasks"]); }
    catch { toast({ title: "Couldn't break it down", description: "Give it another go in a sec." }); }
    finally { setBreaking(false); }
  }
  async function checkStep() {
    if (currentIdx < 0) return;
    const next = steps.map((s, i) => (i === currentIdx ? { ...s, done: true } : s));
    setHint(null);
    await mutateAndInvalidate("PATCH", `/api/tasks/${pinned.id}`, { steps: JSON.stringify(next) }, ["/api/tasks"]);
    toast({ title: next.some((s) => !s.done) ? "Nice — next step's up." : "All steps done — you did it." });
  }
  // Completion goes through the real endpoint: marks done, logs a win, updates the
  // SOURCE object (e.g. a job → applied), the plan item, and checks the MVD.
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
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/breakdown`, {}, ["/api/tasks"]);
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
          This one's been slipping a few days — totally normal. Want it smaller, or park it kindly? No pressure.
        </p>
      )}
      {steps.length === 0 && (
        <div className="mt-2">
          <p className="text-sm text-muted-foreground mb-2.5">Want me to break it into tiny steps so starting is easy?</p>
          <Button size="sm" onClick={breakdown} disabled={breaking} data-testid="button-breakdown-pinned">
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

/* Compact task row used in the block grid */
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

/* Completed task row with an explicit "Promote to win" affordance (WS5). */
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

/* ---------------- BRAIN DUMP ---------------- */
const SORT_LABELS: Record<string, string> = { today: "Today", job: "Jobs", learn: "Learn", hustle: "Hustle" };
function BrainDumpView() {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [text, setText] = useState("");
  const [sorting, setSorting] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<number, string>>({});
  const { toast } = useToast();
  const inbox = tasks.filter((t) => t.list === "inbox");

  async function add() {
    if (!text.trim()) return;
    const created = await mutateAndInvalidate("POST", "/api/tasks", { title: text.trim(), list: "inbox", done: false }, ["/api/tasks"]);
    setText("");
    if (created?.id) mutateAndInvalidate("POST", `/api/tasks/${created.id}/enrich`, {}, ["/api/tasks"]).catch(() => {});
  }
  async function addToDay(t: Task) {
    // Pick a sensible block by size: deep -> morning, else afternoon.
    const block = t.size === "deep" ? "morning" : "afternoon";
    await mutateAndInvalidate("PATCH", `/api/tasks/${t.id}`, { list: "today", block }, ["/api/tasks"]);
    toast({ title: "Added to today.", description: "It's in your day now." });
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/tasks/${id}`, undefined, ["/api/tasks"]); }
  async function sortAll() {
    setSorting(true);
    try {
      const res = await mutateAndInvalidate("POST", "/api/braindump/sort", {}, []);
      const map: Record<number, string> = {};
      (res.suggestions || []).forEach((s: { id: number; category: string }) => { if (s.category !== "keep") map[s.id] = s.category; });
      setSuggestions(map);
      if (Object.keys(map).length === 0) toast({ title: "Nothing to route", description: "These look like loose thoughts — keeping them here." });
    } catch { toast({ title: "Couldn't sort right now", description: "Give it another go in a moment." }); }
    finally { setSorting(false); }
  }
  async function accept(t: Task, category: string) {
    await mutateAndInvalidate("POST", `/api/braindump/${t.id}/move`, { category }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles"]);
    setSuggestions((s) => { const n = { ...s }; delete n[t.id]; return n; });
    toast({ title: `Moved to ${SORT_LABELS[category]}`, description: "You can find it there anytime." });
  }

  return (
    <div>
      <SectionHeading title="Brain dump" sub="Got a thought buzzing? Drop it here and forget it. When you're ready, tap 'Sort these for me' and I'll suggest where each belongs." />
      <div className="flex gap-2 mb-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Type anything and hit Enter…" className="h-11" data-testid="input-braindump" />
        <Button className="h-11 px-4" onClick={add} data-testid="button-add-braindump"><Plus className="w-4 h-4 mr-1" /> Add</Button>
      </div>
      {inbox.length > 1 && (
        <button onClick={sortAll} disabled={sorting} data-testid="button-sort-braindump"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline disabled:opacity-60">
          {sorting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{sorting ? "Sorting…" : "Sort these for me"}
        </button>
      )}
      {isLoading ? <Loading /> : inbox.length === 0 ? (
        <Empty icon={Sparkles} text="Empty head, clear mind. Add a thought above when one shows up." />
      ) : (
        <div className="space-y-2">
          {inbox.map((t) => (
            <div key={t.id} className="group rounded-lg border border-card-border bg-card px-3 py-2.5" data-testid={`braindump-${t.id}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm">
                  {t.title}
                  {t.source === "coach" && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-medium"><Lightbulb className="w-2.5 h-2.5" />from Coach</span>}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => addToDay(t)} data-testid={`button-addday-${t.id}`}>Add to day</Button>
                  <button onClick={() => remove(t.id)} aria-label="Delete" data-testid={`button-delete-braindump-${t.id}`} className="text-muted-foreground hover:text-destructive ml-0.5"><X className="w-4 h-4" /></button>
                </div>
              </div>
              {suggestions[t.id] && (
                <div className="mt-2 pt-2 border-t border-card-border flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Looks like a {SORT_LABELS[suggestions[t.id]]} item —</span>
                  <button onClick={() => accept(t, suggestions[t.id])} data-testid={`button-accept-sort-${t.id}`}
                    className="text-xs font-medium text-primary inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 hover-elevate">
                    <ArrowRight className="w-3 h-3" /> Move to {SORT_LABELS[suggestions[t.id]]}
                  </button>
                  <button onClick={() => setSuggestions((s) => { const n = { ...s }; delete n[t.id]; return n; })} data-testid={`button-dismiss-sort-${t.id}`} className="text-xs text-muted-foreground hover:text-foreground">keep here</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- JOBS ---------------- */
const JOB_COLS = [
  { id: "wishlist", label: "Want to apply" }, { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interviewing" }, { id: "closed", label: "Closed" },
] as const;
// Sort: roles with a deadline first (soonest), then the rest (newest first).
function sortJobs(a: Job, b: Job): number {
  const da = daysUntil(a.deadline), db = daysUntil(b.deadline);
  if (da !== null && db !== null) return da - db;
  if (da !== null) return -1;
  if (db !== null) return 1;
  return b.id - a.id;
}
function JobsView() {
  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", company: "", location: "", url: "", note: "", nextStep: "", deadline: "" });
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/jobs", { ...form, status: "wishlist", flag: "" }, ["/api/jobs"]);
    setForm({ title: "", company: "", location: "", url: "", note: "", nextStep: "", deadline: "" }); setShowForm(false);
  }
  async function move(j: Job, dir: 1 | -1) {
    const idx = JOB_COLS.findIndex((c) => c.id === j.status);
    const next = JOB_COLS[idx + dir];
    if (next) await mutateAndInvalidate("PATCH", `/api/jobs/${j.id}`, { status: next.id }, ["/api/jobs"]);
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/jobs/${id}`, undefined, ["/api/jobs"]); }

  // Only show columns that have items (plus always 'wishlist'); shrink empties to a thin line.
  const grouped = JOB_COLS.map((col) => ({ col, items: jobs.filter((j) => j.status === col.id).sort(sortJobs) }));
  const active = grouped.filter((g) => g.items.length > 0 || g.col.id === "wishlist");
  const empty = grouped.filter((g) => g.items.length === 0 && g.col.id !== "wishlist");

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Job tracker" sub="Every role in one place, soonest deadlines first. Move a card right as you progress." />
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0" data-testid="button-toggle-job-form"><Plus className="w-4 h-4 mr-1" /> Add role</Button>
      </div>
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2 sm:grid-cols-2">
          <Input placeholder="Role title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-job-title" />
          <Input placeholder="Company / org" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} data-testid="input-job-company" />
          <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-job-location" />
          <Input placeholder="Deadline (YYYY-MM-DD)" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} data-testid="input-job-deadline" />
          <Input placeholder="Link to posting" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="sm:col-span-2" data-testid="input-job-url" />
          <Input placeholder="Next step (e.g. tailor CV)" value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} className="sm:col-span-2" data-testid="input-job-nextstep" />
          <div className="sm:col-span-2 flex gap-2 justify-end"><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={add} data-testid="button-save-job">Save role</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {active.map(({ col, items }) => (
              <div key={col.id} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between mb-2.5 px-1"><h2 className="font-semibold text-sm">{col.label}</h2><span className="text-xs text-muted-foreground tabular-nums">{items.length}</span></div>
                <div className="space-y-2">
                  {items.map((j) => <JobCard key={j.id} j={j} tracks={tracks} tasks={tasks} onMove={move} onRemove={() => remove(j.id)} />)}
                  {items.length === 0 && <p className="text-xs text-muted-foreground px-1 py-3">Add roles you want to apply for.</p>}
                </div>
              </div>
            ))}
          </div>
          {empty.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Empty: {empty.map((g) => g.col.label).join(" · ")} — cards appear here as you move them along.</p>
          )}
        </>
      )}
    </div>
  );
}
function JobCard({ j, tracks, tasks, onMove, onRemove }: { j: Job; tracks: CareerTrack[]; tasks: Task[]; onMove: (j: Job, d: 1 | -1) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const idx = JOB_COLS.findIndex((c) => c.id === j.status);
  const trackId = getTrackId("jobs", j);
  const linked = useLinkedTaskCount(tasks, "job", j.id);
  return (
    <div className="group rounded-lg border border-card-border bg-card p-3" data-testid={`job-${j.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm leading-snug">{j.title}</h3>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-job-${j.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {(j.company || j.location) && <p className="text-xs text-muted-foreground mt-0.5">{[j.company, j.location].filter(Boolean).join(" · ")}</p>}
      {/* Clarity strip: track chip + canonical state + constraint badges */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {j.deadline && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${deadlineTone(j.deadline)}`}><CalendarDays className="w-2.5 h-2.5" />{formatDeadline(j.deadline)}</span>}
        {j.applicationWindowStatus === "closing" && <ConstraintBadge text="window closing" tone="warn" />}
        {j.eligibilityRisk && j.eligibilityRisk !== "" && <ConstraintBadge text={`eligibility: ${j.eligibilityRisk}`} tone="warn" />}
        {(j.status === "wishlist" && (j.applicationReadiness === "none")) && <ConstraintBadge text="not started" />}
        {j.flag && <ConstraintBadge text={j.flag} />}
      </div>
      {j.note && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{j.note}</p>}
      {j.nextStep && <p className="text-xs mt-2 inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground px-1.5 py-0.5"><ArrowRight className="w-3 h-3" /> {j.nextStep}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-1">
          {idx > 0 && <button onClick={() => onMove(j, -1)} data-testid={`button-job-back-${j.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">←</button>}
          {idx < JOB_COLS.length - 1 && <button onClick={() => onMove(j, 1)} data-testid={`button-job-fwd-${j.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">{JOB_COLS[idx + 1].label} →</button>}
        </div>
        <div className="flex items-center gap-2">
          {(j.status === "applied" || j.status === "interviewing") && (
            <button data-testid={`button-promote-win-job-${j.id}`}
              onClick={async () => { await mutateAndInvalidate("POST", "/api/wins", { text: `Applied: ${j.title}${j.company ? " @ " + j.company : ""}`, kind: "source", winCategory: "job_progress" }, ["/api/wins", "/api/stats"]); toast({ title: "Logged as a win 🎉", description: "Application progress counts." }); }}
              className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"><Trophy className="w-3.5 h-3.5" /> Promote to win</button>
          )}
          {j.url && <a href={j.url} target="_blank" rel="noopener noreferrer" data-testid={`link-job-${j.id}`} className="text-muted-foreground hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      </div>
      <CardActions entity="jobs" id={j.id} trackId={trackId} tracks={tracks}
        onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "They're in your inbox / today list." : "Use 'Create next task' to make one." })} />
    </div>
  );
}

/* ---------------- NETWORK (outreach pipeline) ---------------- */
const OUTREACH_COLS = [
  { id: "to_contact", label: "To reach" },
  { id: "messaged", label: "Messaged" },
  { id: "replied", label: "Replied" },
] as const;
function NetworkView() {
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { toast } = useToast();
  const [sug, setSug] = useState<{ who: string; sector: string; why: string } | null>(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);

  async function fetchSug(exclude: string[]) {
    setSugLoading(true);
    try { const r = await mutateAndInvalidate("POST", "/api/networking/suggest", { exclude }, []); setSug(r?.suggestion || null); }
    catch { setSug(null); }
    finally { setSugLoading(false); }
  }
  useEffect(() => { fetchSug([]); /* eslint-disable-next-line */ }, []);
  async function addSug() {
    if (!sug) return;
    await mutateAndInvalidate("POST", "/api/networking/accept", sug, ["/api/contacts"]);
    toast({ title: "Added to your outreach list.", description: "Pop in a name when one comes to mind." });
    const next = [...seen, sug.who]; setSeen(next); fetchSug(next);
  }
  function another() { if (!sug) return; const next = [...seen, sug.who]; setSeen(next); fetchSug(next); }
  async function setName(c: Contact, name: string) { await mutateAndInvalidate("PATCH", `/api/contacts/${c.id}`, { name }, ["/api/contacts"]); }
  async function moveStatus(c: Contact, status: string) { await mutateAndInvalidate("PATCH", `/api/contacts/${c.id}`, { status }, ["/api/contacts"]); }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/contacts/${id}`, undefined, ["/api/contacts"]); }

  return (
    <div>
      <SectionHeading title="Network" sub="Warm intros beat cold applications. Coach suggests who to reach — tied to your target roles — and you track each from 'to reach' through to a reply." />

      {/* Coach's one networking suggestion */}
      {(sugLoading || sug) && (
        <div className="mb-6 rounded-xl border border-accent-foreground/15 bg-accent/40 p-4" data-testid="network-suggestion">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-foreground mb-2">
            <Lightbulb className="w-4 h-4" /> Who to reach next
          </div>
          {sugLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Thinking about your warm routes…</div>
          ) : sug ? (
            <div>
              <p className="text-sm font-medium leading-snug">{sug.who}{sug.sector && <span className="ml-2 inline-flex items-center rounded-full bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{sug.sector}</span>}</p>
              {sug.why && <p className="text-xs text-muted-foreground mt-0.5">{sug.why}</p>}
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={addSug} data-testid="button-network-add"><Plus className="w-4 h-4 mr-1" /> Add to list</Button>
                <button onClick={another} data-testid="button-network-another" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> someone else</button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {isLoading ? <Loading /> : contacts.length === 0 ? (
        <Empty icon={Users} text="No one on your list yet. Add Coach's suggestion above to start your outreach pipeline." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {OUTREACH_COLS.map((col) => {
            const items = contacts.filter((c) => c.status === col.id);
            return (
              <div key={col.id} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between mb-2.5 px-1"><h2 className="font-semibold text-sm">{col.label}</h2><span className="text-xs text-muted-foreground tabular-nums">{items.length}</span></div>
                <div className="space-y-2">
                  {items.map((c) => <ContactCard key={c.id} c={c} tracks={tracks} tasks={tasks} onName={setName} onMove={moveStatus} onRemove={() => remove(c.id)} />)}
                  {items.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function ContactCard({ c, tracks, tasks, onName, onMove, onRemove }: { c: Contact; tracks: CareerTrack[]; tasks: Task[]; onName: (c: Contact, n: string) => void; onMove: (c: Contact, s: string) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const [name, setNameLocal] = useState(c.name || "");
  const idx = OUTREACH_COLS.findIndex((s) => s.id === c.status);
  const trackId = getTrackId("contacts", c);
  const linked = useLinkedTaskCount(tasks, "contact", c.id);
  return (
    <div className="group rounded-lg border border-card-border bg-card p-3" data-testid={`contact-${c.id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{c.who}</p>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-contact-${c.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {/* Clarity strip: track chip + sector + constraint badges */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {c.sector && <span className="inline-flex items-center text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{c.sector}</span>}
        {!c.askType && <ConstraintBadge text="no ask type" tone="warn" />}
      </div>
      {c.why && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{c.why}</p>}
      <input value={name} onChange={(e) => setNameLocal(e.target.value)} onBlur={() => name !== c.name && onName(c, name)}
        placeholder="Add a name…" data-testid={`input-contact-name-${c.id}`}
        className="mt-2 w-full text-xs bg-transparent border-b border-input pb-1 focus:outline-none focus:border-primary" />
      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onMove(c, OUTREACH_COLS[idx - 1].id)} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate" data-testid={`button-contact-back-${c.id}`}>←</button>}
        {idx < OUTREACH_COLS.length - 1 && <button onClick={() => onMove(c, OUTREACH_COLS[idx + 1].id)} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate" data-testid={`button-contact-fwd-${c.id}`}>{OUTREACH_COLS[idx + 1].label} →</button>}
      </div>
      <CardActions entity="contacts" id={c.id} trackId={trackId} tracks={tracks}
        onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "They're in your inbox / today list." : "Use 'Create next task' to make one." })} />
    </div>
  );
}

/* ---------------- LEARN ---------------- */
// Group parked items by status prefix in the category ("· OPEN", "· WATCH") or "Resource".
function learnGroup(l: Learn): "open" | "watch" | "resource" {
  const cat = (l.category || "").toUpperCase();
  if (cat.includes("OPEN")) return "open";
  if (cat.includes("WATCH")) return "watch";
  return "resource";
}
function LearnView() {
  const { data: items = [], isLoading } = useQuery<Learn[]>({ queryKey: ["/api/learn"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [showForm, setShowForm] = useState(false);
  const [showShelf, setShowShelf] = useState(false);
  const [form, setForm] = useState({ title: "", category: "", url: "", note: "" });
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/learn", { ...form, done: false, active: false }, ["/api/learn"]);
    setForm({ title: "", category: "", url: "", note: "" }); setShowForm(false);
  }
  async function toggle(l: Learn) { await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { done: !l.done }, ["/api/learn"]); }
  async function toggleActive(l: Learn) { await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { active: !l.active }, ["/api/learn"]); }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/learn/${id}`, undefined, ["/api/learn"]); }

  const active = items.filter((l) => l.active && !l.done);
  const shelf = items.filter((l) => (!l.active || l.done));
  const open = shelf.filter((l) => learnGroup(l) === "open" && !l.done);
  const watch = shelf.filter((l) => learnGroup(l) === "watch" && !l.done);
  const resources = shelf.filter((l) => learnGroup(l) === "resource" && !l.done);
  const done = shelf.filter((l) => l.done);

  function CardList({ list }: { list: Learn[] }) {
    return <div className="grid gap-2.5 sm:grid-cols-2">{list.map((l) => <LearnCard key={l.id} l={l} tracks={tracks} tasks={tasks} onToggle={() => toggle(l)} onToggleActive={() => toggleActive(l)} onRemove={() => remove(l.id)} />)}</div>;
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Learn" sub="Only what you're working on now sits up top. Everything else is on the shelf, grouped by what's open, what to watch, and reference. Star to make active." />
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0" data-testid="button-toggle-learn-form"><Plus className="w-4 h-4 mr-1" /> Add</Button>
      </div>
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2 sm:grid-cols-2">
          <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-learn-title" />
          <Input placeholder="Track / category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="input-learn-category" />
          <Input placeholder="Link" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="sm:col-span-2" data-testid="input-learn-url" />
          <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sm:col-span-2" data-testid="input-learn-note" />
          <div className="sm:col-span-2 flex gap-2 justify-end"><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={add} data-testid="button-save-learn">Save</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : items.length === 0 ? (
        <Empty icon={GraduationCap} text="No resources yet. Add a course, fellowship, or book above." />
      ) : (
        <>
          <GroupLabel count={active.length}><Star className="w-4 h-4 text-primary" fill="currentColor" /> Active now</GroupLabel>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-4 mb-6">Nothing active yet. Open the shelf and star 1–2 things to focus on.</p>
          ) : <div className="mb-6"><CardList list={active} /></div>}

          {open.length > 0 && (<div className="mb-5"><GroupLabel count={open.length}><Clock className="w-4 h-4 text-primary" /> Open now — applications you can make</GroupLabel><CardList list={open} /></div>)}

          <button onClick={() => setShowShelf((s) => !s)} data-testid="button-toggle-shelf" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5 hover:text-foreground">
            {showShelf ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} On the shelf ({watch.length + resources.length + done.length})
          </button>
          {showShelf && (
            <div className="space-y-5">
              {watch.length > 0 && (<div><GroupLabel count={watch.length}>Watch — closed, re-opening later</GroupLabel><CardList list={watch} /></div>)}
              {resources.length > 0 && (<div><GroupLabel count={resources.length}>Resources — books & reading</GroupLabel><CardList list={resources} /></div>)}
              {done.length > 0 && (<div><GroupLabel count={done.length}>Done</GroupLabel><CardList list={done} /></div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
function LearnCard({ l, tracks, tasks, onToggle, onToggleActive, onRemove }: { l: Learn; tracks: CareerTrack[]; tasks: Task[]; onToggle: () => void; onToggleActive: () => void; onRemove: () => void }) {
  const { toast } = useToast();
  // Strip the status suffix from the category for a clean track label.
  const track = (l.category || "").split("·")[0].trim();
  const trackId = getTrackId("learn", l);
  const linked = useLinkedTaskCount(tasks, "learn", l.id);
  return (
    <div className={`group rounded-xl border bg-card p-4 ${l.active && !l.done ? "border-primary/40" : "border-card-border"} ${l.done ? "opacity-60" : ""}`} data-testid={`learn-${l.id}`}>
      <div className="flex items-start gap-2.5">
        <button onClick={onToggle} aria-label={l.done ? "Mark not done" : "Mark done"} data-testid={`button-toggle-learn-${l.id}`}
          className={`mt-0.5 w-4 h-4 shrink-0 rounded-[5px] border grid place-items-center ${l.done ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>{l.done && <Check className="w-3 h-3" />}</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`font-medium text-sm leading-snug ${l.done ? "line-through" : ""}`}>{l.title}</h3>
            <button onClick={onToggleActive} aria-label={l.active ? "Park this" : "Make active"} title={l.active ? "Park this" : "Make active"} data-testid={`button-active-learn-${l.id}`}
              className={`shrink-0 ${l.active ? "text-primary" : "text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100"}`}><Star className="w-4 h-4" fill={l.active ? "currentColor" : "none"} /></button>
          </div>
          {/* Clarity strip: track chip + track label + missing-output constraint */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <TrackChip trackId={trackId} tracks={tracks} />
            {track && <span className="text-[10px] rounded-md bg-accent text-accent-foreground px-1.5 py-0.5">{track}</span>}
            {!l.requiredOutput && <ConstraintBadge text="no output" tone="warn" />}
          </div>
          {l.note && <p className="text-xs text-muted-foreground mt-2 leading-snug">{l.note}</p>}
          <div className="flex items-center gap-3 mt-2">
            {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer" data-testid={`link-learn-${l.id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">Open <ExternalLink className="w-3 h-3" /></a>}
            <button onClick={onRemove} data-testid={`button-delete-learn-${l.id}`} className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Remove</button>
          </div>
          <CardActions entity="learn" id={l.id} trackId={trackId} tracks={tracks}
            onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "They're in your inbox / today list." : "Use 'Create next task' to make one." })} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- HUSTLE ---------------- */
const HUSTLE_STAGES = [
  { id: "idea", label: "Ideas", hint: "Worth exploring" },
  { id: "testing", label: "Testing", hint: "Trying it out" },
  { id: "earning", label: "Live / earning", hint: "Making it real" },
] as const;
function HustleView() {
  const { data: hustles = [], isLoading } = useQuery<Hustle[]>({ queryKey: ["/api/hustles"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", note: "", nextStep: "" });
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/hustles", { ...form, stage: "idea" }, ["/api/hustles"]);
    setForm({ title: "", note: "", nextStep: "" }); setShowForm(false);
  }
  async function move(h: Hustle, dir: 1 | -1) {
    const idx = HUSTLE_STAGES.findIndex((s) => s.id === h.stage);
    const next = HUSTLE_STAGES[idx + dir];
    if (next) await mutateAndInvalidate("PATCH", `/api/hustles/${h.id}`, { stage: next.id }, ["/api/hustles"]);
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/hustles/${id}`, undefined, ["/api/hustles"]); }

  const grouped = HUSTLE_STAGES.map((stage) => ({ stage, items: hustles.filter((h) => h.stage === stage.id) }));
  const active = grouped.filter((g) => g.items.length > 0);
  const empty = grouped.filter((g) => g.items.length === 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Hustle" sub="Your flagship projects — the Substack and Afterline. Move each right as it gets real; their next steps feed into your day plan." />
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0" data-testid="button-toggle-hustle-form"><Plus className="w-4 h-4 mr-1" /> Add idea</Button>
      </div>
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2">
          <Input placeholder="What's the idea? *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-hustle-title" />
          <Input placeholder="Note (who's it for, how it earns)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="input-hustle-note" />
          <Input placeholder="Next step" value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} data-testid="input-hustle-nextstep" />
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={add} data-testid="button-save-hustle">Save</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : hustles.length === 0 ? (
        <Empty icon={Rocket} text="No projects yet. Add the Substack or Afterline above." />
      ) : (
        <>
          <div className={`grid gap-4 ${active.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {active.map(({ stage, items }) => (
              <div key={stage.id} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="mb-2.5 px-1"><div className="flex items-center justify-between"><h2 className="font-semibold text-sm">{stage.label}</h2><span className="text-xs text-muted-foreground tabular-nums">{items.length}</span></div><p className="text-xs text-muted-foreground">{stage.hint}</p></div>
                <div className="space-y-2">{items.map((h) => <HustleCard key={h.id} h={h} tracks={tracks} tasks={tasks} onMove={move} onRemove={() => remove(h.id)} />)}</div>
              </div>
            ))}
          </div>
          {empty.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Next stages: {empty.map((g) => g.stage.label).join(" · ")} — projects move here as they progress.</p>}
        </>
      )}
    </div>
  );
}
function HustleCard({ h, tracks, tasks, onMove, onRemove }: { h: Hustle; tracks: CareerTrack[]; tasks: Task[]; onMove: (h: Hustle, d: 1 | -1) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const idx = HUSTLE_STAGES.findIndex((s) => s.id === h.stage);
  const trackId = getTrackId("hustles", h);
  const linked = useLinkedTaskCount(tasks, "hustle", h.id);
  return (
    <div className="group rounded-lg border border-card-border bg-card p-3" data-testid={`hustle-${h.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm leading-snug">{h.title}</h3>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-hustle-${h.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {/* Clarity strip: track chip + stage + idea constraint */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {h.stage === "idea" && <ConstraintBadge text="still an idea" />}
      </div>
      {h.note && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{h.note}</p>}
      {h.nextStep && <p className="text-xs mt-2 inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground px-1.5 py-0.5"><ArrowRight className="w-3 h-3" /> {h.nextStep}</p>}
      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onMove(h, -1)} data-testid={`button-hustle-back-${h.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">←</button>}
        {idx < HUSTLE_STAGES.length - 1 && <button onClick={() => onMove(h, 1)} data-testid={`button-hustle-fwd-${h.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">{HUSTLE_STAGES[idx + 1].label} →</button>}
      </div>
      <CardActions entity="hustles" id={h.id} trackId={trackId} tracks={tracks}
        onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "They're in your inbox / today list." : "Use 'Create next task' to make one." })} />
    </div>
  );
}

/* ---------------- WINS ---------------- */
const WIN_CATEGORY_LABEL: Record<WinCategory, string> = {
  job_progress: "Job progress", learning: "Learning", network: "Network",
  proof_asset: "Proof asset", mindset: "Mindset", admin: "Admin",
};
function WinsView() {
  const { data: wins = [], isLoading } = useQuery<Win[]>({ queryKey: ["/api/wins"] });
  const { data: stats } = useQuery<{ doneThisWeek: number }>({ queryKey: ["/api/stats"] });
  const [text, setText] = useState("");
  const [category, setCategory] = useState<WinCategory>("mindset");
  async function add() {
    if (!text.trim()) return;
    await mutateAndInvalidate("POST", "/api/wins", { text: text.trim(), winCategory: category }, ["/api/wins", "/api/stats"]);
    setText("");
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/wins/${id}`, undefined, ["/api/wins", "/api/stats"]); }
  function dayLabel(ts: number) { return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = wins.filter((w) => w.createdAt >= weekAgo);
  const earlier = wins.filter((w) => w.createdAt < weekAgo);

  function Row({ w }: { w: Win }) {
    return (
      <div className="group flex items-center gap-3 rounded-lg border border-card-border bg-card px-3.5 py-3" data-testid={`win-${w.id}`}>
        <Trophy className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 text-sm">{w.text}</span>
        {w.winCategory && <span className="hidden sm:inline-flex shrink-0 text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{WIN_CATEGORY_LABEL[w.winCategory as WinCategory] || w.winCategory}</span>}
        <span className="text-xs text-muted-foreground shrink-0">{dayLabel(w.createdAt)}</span>
        <button onClick={() => remove(w.id)} aria-label="Delete" data-testid={`button-delete-win-${w.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Wins" sub="Log the small stuff — sent an application, made a call, got out for a walk. Your brain forgets progress; this remembers it for you." />
        {stats && stats.doneThisWeek > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 rounded-full bg-accent text-accent-foreground px-3 py-1.5 text-sm font-medium" data-testid="text-wins-momentum">
            <Trophy className="w-4 h-4" /> {stats.doneThisWeek} this week
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="What went well? Anything counts…" className="h-11 flex-1 min-w-[12rem]" data-testid="input-win" />
        <select value={category} onChange={(e) => setCategory(e.target.value as WinCategory)} data-testid="select-win-category"
          className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          {WIN_CATEGORIES.map((c) => <option key={c} value={c}>{WIN_CATEGORY_LABEL[c]}</option>)}
        </select>
        <Button className="h-11 px-4" onClick={add} data-testid="button-add-win"><Trophy className="w-4 h-4 mr-1" /> Log win</Button>
      </div>
      {isLoading ? <Loading /> : wins.length === 0 ? (
        <Empty icon={Trophy} text="No wins logged yet. Start with one small thing you did today." />
      ) : (
        <div className="space-y-6">
          {thisWeek.length > 0 && (<div><GroupLabel count={thisWeek.length}>This week</GroupLabel><div className="space-y-2">{thisWeek.map((w) => <Row key={w.id} w={w} />)}</div></div>)}
          {earlier.length > 0 && (<div><GroupLabel count={earlier.length}>Earlier</GroupLabel><div className="space-y-2">{earlier.map((w) => <Row key={w.id} w={w} />)}</div></div>)}
        </div>
      )}
    </div>
  );
}
