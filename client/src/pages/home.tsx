import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Sun, Moon, Sparkles, ListTodo, Briefcase, GraduationCap, Trophy,
  Plus, X, ArrowRight, Check, ExternalLink, Clock, Trash2,
  Target, Pin, Wand2, Loader2, CalendarDays, Star, ChevronDown, ChevronRight,
  Rocket, MoveRight, MoonStar, Lightbulb, Users, MessageCircle, RefreshCw,
  Compass, ArrowUpRight, Link2, ListChecks, AlertTriangle,
  Lock, Pencil, ArrowUp, ArrowDown, Ban, CheckCircle2,
  MessageSquare, Flame, Send, FileText, Newspaper, Package,
  BookOpen, Hammer, BadgeCheck, Layers,
} from "lucide-react";
import { NETWORK_LANES, OPEN_LANE, ALL_LANE_KEYS, laneForSourceNetwork, laneLabel } from "@shared/networkLanes";
import { CAPABILITY_DOMAIN_KEYS, domainForLearn, domainLabel } from "@shared/capabilityDomains";
import { requiredDomainsForTrack } from "@shared/capabilityTargets";
import { classifyProofAsset, PROOF_ASSET_KIND_LABEL, type ProofAssetKind } from "@shared/proofAssetTemplates";
import { AnchorLogo } from "@/components/AnchorLogo";
import { useTheme } from "@/components/ThemeProvider";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { todayKey } from "@/lib/utils";
import type { Task, Job, Learn, Win, Event, Hustle, Contact, CareerTrack, JobPipelineStep, ProofAssetStep } from "@shared/schema";
import { type TrackedEntity, getTrackId, getRelationshipStrength, WIN_CATEGORIES, type WinCategory, getLearnOutputState, learnNeedsOutputNudge, type LearnOutputState, getLearnStatus, type LearnStatus, isFellowship } from "@shared/domainState";
import { isFellowshipLearnRow } from "@shared/fellowshipLane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

type WorkflowStateCtx = { workObject?: string; currentStage?: string; stageOutput?: string; completionCriteria?: string[]; advanceCondition?: string };
type Step = { text: string; done: boolean; substeps?: string[]; workflowState?: WorkflowStateCtx };
function parseSteps(raw: string): Step[] {
  try { const s = JSON.parse(raw || "[]"); return Array.isArray(s) ? s : []; } catch { return []; }
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

type Tab = "today" | "strategy" | "braindump" | "jobs" | "network" | "learn" | "wins" | "profile";
// Tabs always visible in the header (icon-only on mobile, icon+label on sm+)
const HEADER_TABS: { id: Tab; label: string; icon: typeof Sun }[] = [
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "network", label: "Network", icon: Users },
  { id: "braindump", label: "Capture", icon: Sparkles },
];
// Remaining tabs in the More dropdown
const MORE_TABS: { id: Tab; label: string; icon: typeof Sun; blurb: string }[] = [
  { id: "strategy", label: "Strategy", icon: Compass, blurb: "Your paths, at a glance" },
  { id: "learn", label: "Learn", icon: GraduationCap, blurb: "What you're learning" },
  { id: "wins", label: "Wins", icon: Trophy, blurb: "What's gone well" },
  { id: "profile", label: "Profile", icon: FileText, blurb: "Your CV for tailored suggestions" },
];

const GOAL_SPINE_QUERY_KEYS = ["/api/goals/state", "/api/strategy/front-door", "/api/strategy/diagnostics"] as const;
const PENDING_CONTACT_DRAFT_KEY = "anchor.pending-contact-draft";
const PENDING_LEARN_DRAFT_KEY = "anchor.pending-learn-draft";

function queueIntakeDraft(key: string, draft: Record<string, unknown>) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Best-effort only. If session storage is unavailable, fall back to plain navigation.
  }
}

function takeIntakeDraft<T extends object>(key: string): Partial<T> | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    try { window.sessionStorage.removeItem(key); } catch {}
    return null;
  }
}

function routeBase(path: string) {
  return path.split("?")[0] || path;
}

function buildPrefillHash(path: string, draftParam: string, draft: Record<string, unknown>) {
  const params = new URLSearchParams();
  params.set(draftParam, JSON.stringify(draft));
  return `${path}?${params.toString()}`;
}

function takeHashDraft<T extends object>(draftParam: string): Partial<T> | null {
  try {
    const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const [path, search = ""] = rawHash.split("?");
    if (!search) return null;
    const params = new URLSearchParams(search);
    const raw = params.get(draftParam);
    if (!raw) return null;
    params.delete(draftParam);
    const nextHash = params.toString() ? `${path}?${params.toString()}` : path;
    window.history.replaceState(null, "", `#${nextHash}`);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}

function tabFromPath(path: string): Tab {
  switch (routeBase(path)) {
    case "/strategy":
      return "strategy";
    case "/braindump":
      return "braindump";
    case "/jobs":
      return "jobs";
    case "/network":
      return "network";
    case "/learn":
      return "learn";
    case "/wins":
      return "wins";
    default:
      return "today";
  }
}

function pathForTab(tab: Tab): string {
  return tab === "today" ? "/" : `/${tab}`;
}

export default function Home() {
  const { theme, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>(() => tabFromPath(location));
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const next = tabFromPath(location);
    setTab((current) => (current === next ? current : next));
  }, [location]);

  function go(t: Tab) {
    setTab(t);
    setMoreOpen(false);
    const nextPath = pathForTab(t);
    if (location !== nextPath) navigate(nextPath);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => go("today")} className="flex items-center gap-2.5" data-testid="button-home">
            <span className="text-primary"><AnchorLogo className="w-7 h-7" /></span>
            <div className="leading-tight text-left">
              <div className="font-bold text-lg tracking-tight" data-testid="text-appname">Anchor</div>
            </div>
          </button>
          <div className="flex items-center gap-0.5">
            {HEADER_TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => go(id)} data-testid={`tab-${id}`}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm font-medium hover-elevate transition-colors ${tab === id ? "text-foreground bg-muted/60" : "text-muted-foreground"}`}>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            <div className="relative">
              <button onClick={() => setMoreOpen((o) => !o)} data-testid="button-more"
                className={`flex items-center gap-1 px-2.5 py-2 rounded-md text-sm font-medium hover-elevate transition-colors ${MORE_TABS.some((t) => t.id === tab) ? "text-foreground bg-muted/60" : "text-muted-foreground"}`}>
                <span className="hidden sm:inline">More</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
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

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-7 pb-28 sm:pb-24">
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

        {tab === "wins" && <WinsView />}
        {tab === "profile" && <ProfileView />}
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
    await mutateAndInvalidate("PATCH", `/api/${entity}/${id}/link-track`, { trackId: next }, [ENTITY_QUERY[entity], "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked", ...GOAL_SPINE_QUERY_KEYS]);
    setOpen(false);
    toast({ title: next ? "Linked to track." : "Unlinked.", description: next ? "It'll show up under this path in Strategy." : "Removed from its track." });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid={`button-link-track-${entity}-${id}`} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
          <Link2 className="w-3.5 h-3.5" /> {trackId ? "Role type" : "Link role type"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5" align="start">
        <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a role type</p>
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
          {tracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No role types yet.</p>}
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
      const r = await mutateAndInvalidate("POST", `/api/${entity}/${id}/create-next-task`, {}, ["/api/tasks", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : "Next task created.", description: r?.reused ? "There's already an open task for this." : "Find it in Brain dump, or in Today if it gets planned." });
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

/* ================= ONBOARDING (first-time setup) ================= */
type OnboardingRole = { archetype: string; priority: string; fitLogic: string; nextExperiment: string };

function OnboardingView() {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<OnboardingRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    apiRequest("GET", "/api/strategy-builder")
      .then((r) => r.json())
      .then((d) => setRoles((d.roleArchetypes || []).slice(0, 4)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function acceptRole(r: OnboardingRole) {
    setAccepting(r.archetype);
    try {
      await apiRequest("POST", "/api/strategy-builder/accept-role", r);
      setAccepted((prev) => new Set([...prev, r.archetype]));
      queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/goals/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy/front-door"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy/diagnostics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plan/current"] });
    } catch {
      toast({ title: "Couldn't add that track", description: "Try again in a moment." });
    } finally {
      setAccepting(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Let's set up your strategy</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Add the role types you want to pursue. Anchor builds your plan around several directions at once and narrows based on what's actually moving.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Thinking about your options…
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map((r) => {
            const isAccepted = accepted.has(r.archetype);
            const isBusy = accepting === r.archetype;
            return (
              <div key={r.archetype}
                className={`rounded-xl border p-4 transition-colors ${isAccepted ? "border-primary/40 bg-primary/5" : "border-card-border bg-card"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{r.archetype}</p>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{r.priority}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.fitLogic}</p>
                    {r.nextExperiment && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">First step:</span> {r.nextExperiment}
                      </p>
                    )}
                  </div>
                  <button onClick={() => !isAccepted && acceptRole(r)} disabled={isAccepted || isBusy}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                      isAccepted ? "bg-primary/10 text-primary" : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}>
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isAccepted ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    {isAccepted ? "Added" : "Add role type"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {accepted.size > 0 && (
        <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">{accepted.size === 1 ? "1 role type added" : `${accepted.size} role types added`} — building your plan…</p>
            <p className="text-xs text-muted-foreground mt-0.5">Anchor is shaping today around {accepted.size === 1 ? "it" : "them"} while keeping the wider search coherent. Your first moves will appear in a moment.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= TODAY (day-first hero) ================= */
type PlanItemExplanationT = { summary: string; whyNow: string; whyThis: string; supportingReasons: string[]; firstStep: string; stopRule: string };
type PlanItemT = { id: number; slot: string; title: string; whySelected: string; doneWhen: string; status: string; sourceType: string; sourceId: number | null; taskId: number | null; explanation?: PlanItemExplanationT };
type DayPlanT = { id: number; mode: string; note: string; status: string; minimumViableItemId: number | null; enoughForToday: boolean };
type GoalTrajectoryT = { key: string; title: string; status: "complete" | "current" | "pending"; description: string };
type GoalTodayPlanT = { mustDo: string; next: string; optional: string; stopRule: string };
type GoalPortfolioItemT = { combination: string; whyPlausible: string; nextMove: string };
type BroadPursuitCoverageT = {
  combinations: string[];
  covered: string[];
  missing: string[];
  networkSupported: string[];
  capabilitySupported: string[];
  missingNetworkSupport: string[];
  missingCapabilitySupport: string[];
  fullySupported: string[];
};
type GoalWorkstreamT = {
  name: string;
  status: "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
  progress: "not_started" | "early" | "developing" | "ready";
  bottleneck: string;
  nextMoveType: "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";
  evidence: string[];
  nextMoves: string[];
};
type CareerGoalT = {
  goal: string;
  objective: string;
  phase: "fit-discovery" | "lane-narrowing" | "role-targeting" | "interview-prep";
  dayType: string;
  recommendedFocus: string;
  reason: string;
  decisionQuestion: string;
  decisionMode: "single-track" | "forced-comparison" | "parallel-exploration" | "broad-parallel-pursuit";
  landingPriority: string;
  selectionRule: string;
  pursuitPortfolio?: GoalPortfolioItemT[];
  trajectory: GoalTrajectoryT[];
  workstreams: GoalWorkstreamT[];
  todayPlan: GoalTodayPlanT;
  broadPursuitCoverage?: BroadPursuitCoverageT;
};
type JobFormT = {
  title: string;
  company: string;
  location: string;
  url: string;
  note: string;
  nextStep: string;
  deadline: string;
  relatedTrackId: number | null;
  roleArchetype: string;
  narrativeAngle: string;
  sourceType: string;
  jdText: string;
};
type JobTruthStripT = {
  jobId: number;
  action: "apply" | "warm" | "prove" | "reject" | "clarify" | "prepare" | "follow_up";
  actionLabel: string;
  headline: string;
  nextMove: string;
  reasons: string[];
  risks: string[];
};
type GoalsStateResponseT = { goals: CareerGoalT[] };
const SLOT_LABEL: Record<string, string> = { now: "Now", next: "Next", later: "Later", bonus: "Bonus" };
const PHASE_LABEL: Record<CareerGoalT["phase"], string> = {
  "fit-discovery": "Discover fit",
  "lane-narrowing": "Narrow focus",
  "role-targeting": "Target roles",
  "interview-prep": "Interview prep",
};
const DECISION_MODE_LABEL: Record<CareerGoalT["decisionMode"], string> = {
  "single-track": "One path",
  "forced-comparison": "Comparing options",
  "parallel-exploration": "Exploring options",
  "broad-parallel-pursuit": "Multiple targets",
};
const DAY_TYPE_LABEL: Record<string, string> = {
  "signal-building": "Signal building",
  "network-building": "Network building",
  "conversion": "Conversion",
  "capability-building": "Capability building",
  "interview-prep": "Interview prep",
  "stabilising": "Stabilising",
};
const PRE_SHRUNK_RE = /pre-shrunk|made smaller|pre-split|easier execution steps|easier start/i;

function isPreShrunkPlanItem(item: PlanItemT) {
  const text = `${item.explanation?.summary || ""} ${item.explanation?.whyNow || ""}`;
  return PRE_SHRUNK_RE.test(text);
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

function isBroadPursuitGoalItem(item: PlanItemT, goal?: CareerGoalT | null) {
  return goal?.decisionMode === "broad-parallel-pursuit" && item.sourceType === "goal";
}

function broadPursuitPlanTitle(goal?: CareerGoalT | null) {
  if (!goal) return null;
  const coverage = getBroadPursuitCoverage(goal);
  if (coverage.missing.length === 0) return "Keep your active targets moving";
  if (coverage.missing.length === 1) return "Add a role for the last target";
  return `Add roles for ${coverage.missing.length} targets`;
}

function getBroadPursuitCoverage(goal: CareerGoalT): BroadPursuitCoverageT {
  const fallbackCombinations = goal.pursuitPortfolio?.map((item) => item.combination) || [];
  const raw = goal.broadPursuitCoverage;
  if (!raw) {
    return {
      combinations: fallbackCombinations,
      covered: [],
      missing: fallbackCombinations,
      networkSupported: [],
      capabilitySupported: [],
      missingNetworkSupport: [],
      missingCapabilitySupport: [],
      fullySupported: [],
    };
  }
  const combinations = raw.combinations?.length ? raw.combinations : fallbackCombinations;
  const covered = raw.covered || [];
  const missing = raw.missing?.length
    ? raw.missing
    : combinations.filter((combination) => !covered.includes(combination));
  const networkSupported = raw.networkSupported || [];
  const capabilitySupported = raw.capabilitySupported || [];
  const missingNetworkSupport = raw.missingNetworkSupport?.length
    ? raw.missingNetworkSupport
    : covered.filter((combination) => !networkSupported.includes(combination));
  const missingCapabilitySupport = raw.missingCapabilitySupport?.length
    ? raw.missingCapabilitySupport
    : covered.filter((combination) => !capabilitySupported.includes(combination));
  const fullySupported = raw.fullySupported?.length
    ? raw.fullySupported
    : covered.filter((combination) => networkSupported.includes(combination) && capabilitySupported.includes(combination));
  return {
    combinations,
    covered,
    missing,
    networkSupported,
    capabilitySupported,
    missingNetworkSupport,
    missingCapabilitySupport,
    fullySupported,
  };
}

function combinationCoverageState(goal: CareerGoalT, combination: string): "covered" | "missing" | "unknown" {
  const coverage = getBroadPursuitCoverage(goal);
  if (coverage.covered.includes(combination)) return "covered";
  if (coverage.missing.includes(combination)) return "missing";
  return "unknown";
}

function combinationSupportState(goal: CareerGoalT, combination: string) {
  const coverage = getBroadPursuitCoverage(goal);
  return {
    hasRole: coverage.covered.includes(combination),
    hasNetworkSupport: coverage.networkSupported.includes(combination),
    hasCapabilitySupport: coverage.capabilitySupported.includes(combination),
    fullySupported: coverage.fullySupported.includes(combination),
  };
}

function nextLaneGap(goal: CareerGoalT, combination: string) {
  const support = combinationSupportState(goal, combination);
  if (!support.hasRole) {
    return {
      label: "Needs first real role",
      detail: "Save one real role for this target.",
      tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  if (!support.hasNetworkSupport) {
    return {
      label: "Needs first contact",
      detail: "Add one contact who could help here.",
      tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    };
  }
  if (!support.hasCapabilitySupport) {
    return {
      label: "Needs learning support",
      detail: "Add one learning item for this target.",
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    };
  }
  return {
    label: "Well supported",
    detail: "This target has a role, a contact, and learning support.",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
}

function compactLanePreview(items: string[], fallback: string, limit = 2) {
  if (items.length === 0) return fallback;
  const shown = items.slice(0, limit);
  const remainder = items.length - shown.length;
  return `${shown.join("; ")}${remainder > 0 ? ` +${remainder} more` : ""}`;
}

function CareerCompassCard({
  goal,
  onOpenTab,
  variant = "full",
  showOpenStrategy = true,
}: {
  goal: CareerGoalT;
  onOpenTab: (t: Tab) => void;
  variant?: "full" | "compact";
  showOpenStrategy?: boolean;
}) {
  const coverage = getBroadPursuitCoverage(goal);
  const hasCoverage = goal.decisionMode === "broad-parallel-pursuit" && coverage.combinations.length > 0;
  const isCompact = variant === "compact";
  const compassSummary = hasCoverage
    ? "Keep multiple plausible lanes live and turn them into real roles before narrowing anything."
    : goal.reason;
  return (
    <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5" data-testid="career-compass">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-semibold">
              <Compass className="w-3 h-3" /> {PHASE_LABEL[goal.phase]}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-card text-muted-foreground px-2 py-0.5 text-[11px] font-medium border border-card-border">
              {DECISION_MODE_LABEL[goal.decisionMode]}
            </span>
            {goal.landingPriority === "credible-role-quickly" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-card text-muted-foreground px-2 py-0.5 text-[11px] font-medium border border-card-border">
                land something credible soon
              </span>
            )}
          </div>
          <h2 className="text-sm font-semibold leading-snug">Career compass</h2>
          <p className="text-xs text-muted-foreground mt-1">{compassSummary}</p>
        </div>
        {showOpenStrategy && (
          <button onClick={() => onOpenTab("strategy")} className="shrink-0 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1" data-testid="button-open-strategy-from-compass">
            Open strategy <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className={`mt-3 grid gap-3 ${isCompact ? "sm:grid-cols-1" : "sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]"}`}>
        <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">What matters now</p>
          <p className="text-sm font-medium mt-1">{goal.todayPlan.mustDo}</p>
          <p className="text-xs text-muted-foreground mt-1">{goal.selectionRule}</p>
        </div>
        {!isCompact && <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{hasCoverage ? "Missing next" : "Decision note"}</p>
          {hasCoverage ? (
            <>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {coverage.covered.length} covered
                </span>
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {coverage.missing.length} empty
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {coverage.missing.length > 0
                  ? `Role gaps: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
                  : "Every target has a real role."}
              </p>
              {(coverage.missingNetworkSupport.length > 0 || coverage.missingCapabilitySupport.length > 0) && (
                <p className="text-xs text-muted-foreground mt-1">
                  {coverage.missingNetworkSupport.length > 0
                    ? `${coverage.missingNetworkSupport.length} contact gap${coverage.missingNetworkSupport.length > 1 ? "s" : ""}`
                    : "No contact gaps"}
                  {" · "}
                  {coverage.missingCapabilitySupport.length > 0
                    ? `${coverage.missingCapabilitySupport.length} capability gap${coverage.missingCapabilitySupport.length > 1 ? "s" : ""}`
                    : "No capability gaps"}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-medium mt-1">{goal.decisionQuestion}</p>
          )}
        </div>}
      </div>

      {hasCoverage && !isCompact && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="broad-pursuit-coverage-summary">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Still empty</p>
          {coverage.missing.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {coverage.missing.map((combination) => (
                <span key={combination} className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {combination}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Every active combination already has a real role.</p>
          )}
        </div>
      )}

      {hasCoverage && isCompact && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="broad-pursuit-coverage-summary">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {coverage.covered.length} covered
            </span>
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              {coverage.missing.length} empty
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {coverage.missing.length > 0
              ? `Still empty: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
              : "Every target has a real role."}
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {goal.todayPlan.stopRule}
      </p>
    </div>
  );
}

function WorkstreamGrid({ goal }: { goal: CareerGoalT }) {
  const top = goal.workstreams.filter((w) => w.nextMoveType !== "wait").slice(0, 4);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <GroupLabel>What needs attention</GroupLabel>
        <span className="text-xs text-muted-foreground">Focus: {goal.recommendedFocus}</span>
      </div>
      <div className="space-y-2">
        {top.map((w) => (
          <div
            key={w.name}
            className={`rounded-xl border p-3 ${goal.recommendedFocus === w.name ? "border-primary/25 bg-primary/5" : "border-card-border bg-card"}`}
            data-testid={`workstream-${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{w.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{w.nextMoves[0] || w.bottleneck}</p>
              </div>
              {goal.recommendedFocus === w.name && (
                <span className="inline-flex rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">focus</span>
              )}
            </div>
            {w.evidence.length > 0 && <p className="text-[11px] text-muted-foreground/80 mt-2">{w.evidence[0]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PursuitPortfolioGrid({ goal }: { goal: CareerGoalT }) {
  const portfolio = goal.pursuitPortfolio || [];
  if (goal.decisionMode !== "broad-parallel-pursuit" || portfolio.length === 0) return null;
  const coverage = getBroadPursuitCoverage(goal);

  return (
    <div className="mb-6" data-testid="pursuit-portfolio">
      <div className="flex items-center justify-between gap-3 mb-2">
        <GroupLabel>Live lanes</GroupLabel>
        <span className="text-xs text-muted-foreground">
          {coverage.missing.length > 0
            ? `${coverage.missing.length} still empty`
            : "Every target has a real role"}
        </span>
      </div>
      <div className="space-y-2">
        {portfolio.map((item) => (
          (() => {
            const state = combinationCoverageState(goal, item.combination);
            const gap = nextLaneGap(goal, item.combination);
            const tone = state === "covered"
              ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10"
              : state === "missing"
              ? "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/10"
              : "border-card-border bg-card";
            const badge = state === "covered"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : state === "missing"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-muted text-muted-foreground";
            const badgeLabel = state === "covered" ? "covered" : state === "missing" ? "still empty" : "watch";
            return (
              <div
                key={item.combination}
                className={`rounded-xl border p-3 ${tone}`}
                data-testid={`pursuit-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{item.combination}</p>
                    <p className="text-xs text-muted-foreground mt-1">{gap.detail}</p>
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}>{badgeLabel}</span>
                </div>
              </div>
            );
          })()
        ))}
      </div>
    </div>
  );
}

function workstreamTone(name: string, goal: CareerGoalT) {
  return goal.recommendedFocus === name
    ? "bg-primary/10 text-primary border-primary/20"
    : "bg-muted text-muted-foreground border-card-border";
}

function viewRelevantWorkstreams(view: "jobs" | "network" | "learn", goal: CareerGoalT) {
  if (view === "jobs" && goal.decisionMode === "broad-parallel-pursuit") {
    return ["Direction", "Market map", "Applications", "Positioning"]
      .map((name) => goal.workstreams.find((w) => w.name === name))
      .filter(Boolean) as GoalWorkstreamT[];
  }
  const map: Record<typeof view, string[]> = {
    jobs: ["Applications", "Positioning", "Interview readiness", "Proof"],
    network: ["Network", "Applications", "Interview readiness", "Direction"],
    learn: ["Capability ramp", "Proof", "Positioning", "Direction"],
  };
  return map[view]
    .map((name) => goal.workstreams.find((w) => w.name === name))
    .filter(Boolean) as GoalWorkstreamT[];
}

function leadWorkstreamForView(view: "jobs" | "network" | "learn", goal: CareerGoalT, relevant: GoalWorkstreamT[]) {
  if (view === "jobs" && goal.decisionMode === "broad-parallel-pursuit") {
    const direction = goal.workstreams.find((w) => w.name === "Direction");
    const marketMap = goal.workstreams.find((w) => w.name === "Market map");
    const applications = goal.workstreams.find((w) => w.name === "Applications");
    return direction || marketMap || applications || relevant[0];
  }
  return relevant[0];
}

function ViewSpineCallout({
  view,
  goal,
}: {
  view: "jobs" | "network" | "learn";
  goal: CareerGoalT;
}) {
  const relevant = viewRelevantWorkstreams(view, goal);
  if (relevant.length === 0) return null;
  const lead = leadWorkstreamForView(view, goal, relevant);

  return (
    <div className="mb-5 rounded-xl border border-card-border bg-card p-4" data-testid={`${view}-spine-callout`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why this page matters now</p>
          <p className="text-sm font-medium mt-1">{lead.nextMoves[0] || goal.todayPlan.mustDo}</p>
          <p className="text-xs text-muted-foreground mt-1">{lead.bottleneck}</p>
        </div>
        {goal.recommendedFocus === lead.name && (
          <span className="inline-flex shrink-0 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
            focus
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {relevant.slice(0, 3).map((w) => (
          <span key={w.name} className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${workstreamTone(w.name, goal)}`}>
            {w.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function BroadPursuitJobsKickoff({
  goal,
  onStartLane,
}: {
  goal: CareerGoalT;
  onStartLane: (item: GoalPortfolioItemT) => void;
  }) {
  const portfolio = goal.pursuitPortfolio || [];
  if (goal.decisionMode !== "broad-parallel-pursuit" || portfolio.length === 0) return null;
  const coverage = getBroadPursuitCoverage(goal);
  const visiblePortfolio = portfolio.filter((item) => combinationCoverageState(goal, item.combination) === "missing");
  if (visiblePortfolio.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="jobs-broad-pursuit-kickoff">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">First roles</p>
        <p className="text-sm font-medium mt-1">Save one credible role in each empty lane.</p>
        <p className="text-xs text-muted-foreground mt-1">
          That is enough to start getting real market signal.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {coverage.missing.length} lane{coverage.missing.length === 1 ? "" : "s"} still need a first real role.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mt-4">
        {visiblePortfolio.map((item) => {
          const state = combinationCoverageState(goal, item.combination);
          const tone = state === "covered"
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/10"
            : state === "missing"
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/10"
            : "border-card-border bg-card";
          const badge = state === "covered"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : state === "missing"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            : "bg-muted text-muted-foreground";
          const buttonLabel = state === "covered" ? "Add another role" : "Add first role";
          return (
          <div
            key={item.combination}
            className={`rounded-xl border p-3 ${tone}`}
            data-testid={`jobs-kickoff-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug">{item.combination}</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}>
                {state === "covered" ? "covered" : state === "missing" ? "still empty" : "watch"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{laneGuideForCombination(item.combination).fitHint}</p>
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => onStartLane(item)} data-testid={`button-start-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <Plus className="w-4 h-4 mr-1" /> {buttonLabel}
              </Button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function BroadPursuitParallelSupportKickoff({
  goal,
  mode,
  onStartLane,
}: {
  goal: CareerGoalT;
  mode: "network" | "learn";
  onStartLane: (item: GoalPortfolioItemT) => void;
}) {
  const portfolio = goal.pursuitPortfolio || [];
  if (goal.decisionMode !== "broad-parallel-pursuit" || portfolio.length === 0) return null;
  const coverage = getBroadPursuitCoverage(goal);
  const missingSupport = mode === "network" ? coverage.missingNetworkSupport : coverage.missingCapabilitySupport;
  const orderedPortfolio = [...portfolio].sort((a, b) => {
    const left = combinationSupportState(goal, a.combination);
    const right = combinationSupportState(goal, b.combination);
    const leftMissing = mode === "network" ? !left.hasNetworkSupport : !left.hasCapabilitySupport;
    const rightMissing = mode === "network" ? !right.hasNetworkSupport : !right.hasCapabilitySupport;
    const leftPriority = left.hasRole && leftMissing ? 0 : leftMissing ? 1 : 2;
    const rightPriority = right.hasRole && rightMissing ? 0 : rightMissing ? 1 : 2;
    return leftPriority - rightPriority;
  });
  const visiblePortfolio = orderedPortfolio.filter((item) => {
    const support = combinationSupportState(goal, item.combination);
    return mode === "network" ? !support.hasNetworkSupport : !support.hasCapabilitySupport;
  });
  const allVisibleWithoutRoles = visiblePortfolio.length > 0 && visiblePortfolio.every((item) => !combinationSupportState(goal, item.combination).hasRole);
  const canStartWithoutRole = allVisibleWithoutRoles;

  return (
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid={`${mode}-broad-pursuit-kickoff`}>
      <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {mode === "network" ? "Contact paths" : "Capability support"}
          </p>
          <p className="text-sm font-medium mt-1">
            {mode === "network" ? "Add one contact for your weakest role targets." : "Add one learning item for your weakest role targets."}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === "network"
              ? `${missingSupport.length} role type${missingSupport.length === 1 ? "" : "s"} still need a contact.`
              : `${missingSupport.length} role type${missingSupport.length === 1 ? "" : "s"} still need learning support.`}
          </p>
          {canStartWithoutRole && (
            <p className="text-xs text-muted-foreground mt-1">
              These can start before a saved role exists.
            </p>
          )}
      </div>

      <div className={`mt-4 ${canStartWithoutRole ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}`}>
        {visiblePortfolio.map((item) => {
          const state = combinationCoverageState(goal, item.combination);
          const support = combinationSupportState(goal, item.combination);
          const gap = nextLaneGap(goal, item.combination);
          const supportGap = !support.hasRole
            ? mode === "network"
              ? {
                  label: "Can warm now",
                  detail: "This can start before a role exists.",
                  tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
                }
              : {
                  label: "Can support now",
                  detail: "This can start before a role exists.",
                  tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
                }
            : gap;
          const supportMissing = mode === "network" ? !support.hasNetworkSupport : !support.hasCapabilitySupport;
          const tone = state === "covered"
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/10"
            : state === "missing"
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/10"
            : "border-card-border bg-card";
          const buttonLabel = mode === "network"
            ? supportMissing
              ? (support.hasRole ? "Add first contact" : "Add contact for this target")
              : "Add another contact"
            : supportMissing
              ? (support.hasRole ? "Add first learning item" : "Add learning item for this target")
              : "Add another learning item";
          const showRoleStateBadge = !canStartWithoutRole;
          const showSupportDetail = !canStartWithoutRole;
          return (
            <div
              key={`${mode}-${item.combination}`}
              className={`rounded-xl border p-3 ${tone} ${canStartWithoutRole ? "flex items-center justify-between gap-3" : ""}`}
              data-testid={`${mode}-kickoff-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{item.combination}</p>
                  {showRoleStateBadge && (
                    <span className="inline-flex rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {state === "covered" ? "live role exists" : state === "missing" ? "no live role yet" : "watch"}
                    </span>
                  )}
                </div>
                <div className={`flex flex-wrap items-center gap-2 ${showSupportDetail ? "mt-3" : "mt-2"}`}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${supportGap.tone}`}>{supportGap.label}</span>
                  {showSupportDetail && <p className="text-xs text-muted-foreground">{supportGap.detail}</p>}
                </div>
              </div>
              <div className={canStartWithoutRole ? "shrink-0" : "mt-3"}>
                <Button size="sm" variant="outline" onClick={() => onStartLane(item)} data-testid={`button-start-${mode}-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  <Plus className="w-4 h-4 mr-1" /> {buttonLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const JOB_ARCHETYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "advisory", label: "Advisory" },
  { value: "chief_of_staff", label: "Chief of staff" },
  { value: "ops", label: "Operations" },
  { value: "policy", label: "Policy" },
  { value: "research", label: "Research" },
];

const EMPTY_JOB_FORM: JobFormT = {
  title: "",
  company: "",
  location: "",
  url: "",
  note: "",
  nextStep: "",
  deadline: "",
  relatedTrackId: null,
  roleArchetype: "",
  narrativeAngle: "",
  sourceType: "posting",
  jdText: "",
};

function roleArchetypeForLane(combination: string): string {
  if (/ops \/ chief of staff/i.test(combination)) return "chief_of_staff";
  return "advisory";
}

type LaneGuideT = {
  roleArchetype: string;
  fitHint: string;
  searchHint: string;
  nextStep: string;
  titlePlaceholder: string;
  notePrefix: string;
  trackKeywords: string[];
};

function laneGuideForCombination(combination: string): LaneGuideT {
  if (/ai \/ technology strategy x ops \/ chief of staff/i.test(combination)) {
    return {
      roleArchetype: "chief_of_staff",
      fitHint: "Look for execution-heavy roles translating AI or technology priorities into cross-functional delivery, founder support, or operating cadence.",
      searchHint: "Try terms like chief of staff, strategy and operations, special projects, or business operations in AI, frontier tech, or policy-adjacent orgs.",
      nextStep: "Save one AI or technology role where you would help turn priorities into execution, then decide if it is credible soon.",
      titlePlaceholder: "Chief of Staff, Strategy & Ops, Special Projects...",
      notePrefix: "Lane focus: AI / technology strategy x Ops / chief of staff.",
      trackKeywords: ["ai", "technology", "ops", "operations", "chief of staff", "special projects", "execution"],
    };
  }
  if (/ai \/ technology strategy x strategy \/ advisory/i.test(combination)) {
    return {
      roleArchetype: "advisory",
      fitHint: "Look for roles shaping AI, technology, risk, governance, policy, or strategic direction rather than owning pure implementation.",
      searchHint: "Try terms like strategy, advisory, policy, governance, public affairs, or market intelligence in AI or frontier technology orgs.",
      nextStep: "Save one AI or technology strategy role with clear strategic scope, then decide if it is a credible near-term target.",
      titlePlaceholder: "Strategy Associate, AI Policy Advisor, Tech Strategy...",
      notePrefix: "Lane focus: AI / technology strategy x Strategy / advisory.",
      trackKeywords: ["ai", "technology", "strategy", "advisory", "governance", "policy", "risk"],
    };
  }
  if (/geopolitics \/ geopolitical advisory x ops \/ chief of staff/i.test(combination)) {
    return {
      roleArchetype: "chief_of_staff",
      fitHint: "Look for execution and coordination roles inside policy, geopolitical, advisory, or international-facing teams.",
      searchHint: "Try terms like chief of staff, strategy and operations, programme operations, special projects, or executive office in geopolitical or policy orgs.",
      nextStep: "Save one geopolitics-adjacent operations role where you would coordinate priorities or delivery, then decide if it is credible soon.",
      titlePlaceholder: "Chief of Staff, Programme Operations, Strategy & Ops...",
      notePrefix: "Lane focus: Geopolitics / geopolitical advisory x Ops / chief of staff.",
      trackKeywords: ["geopolitics", "geopolitical", "policy", "international", "ops", "operations", "chief of staff"],
    };
  }
  return {
    roleArchetype: "advisory",
    fitHint: "Look for roles with substantive regional, geopolitical, public policy, or advisory scope rather than generic admin support.",
    searchHint: "Try terms like geopolitical advisory, policy advisor, research and strategy, public affairs, or international policy in think tanks, consultancies, multilaterals, and governments.",
    nextStep: "Save one geopolitical advisory role with substantive regional or policy scope, then decide if it is a credible near-term target.",
    titlePlaceholder: "Policy Advisor, Geopolitical Analyst, Strategy Associate...",
    notePrefix: "Lane focus: Geopolitics / geopolitical advisory x Strategy / advisory.",
    trackKeywords: ["geopolitics", "geopolitical", "policy", "advisory", "international", "research", "public affairs"],
  };
}

function normalizeLaneText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function bestTrackForLane(combination: string, tracks: CareerTrack[]): number | null {
  const guide = laneGuideForCombination(combination);
  const scored = tracks
    .filter((track) => track.status !== "paused")
    .map((track) => {
      const haystack = normalizeLaneText(`${track.name} ${track.description} ${track.whyItFits} ${track.targetRoleArchetype}`);
      let score = 0;
      for (const keyword of guide.trackKeywords) {
        if (haystack.includes(normalizeLaneText(keyword).trim())) score += 2;
      }
      if (guide.roleArchetype && haystack.includes(normalizeLaneText(guide.roleArchetype).trim())) score += 1;
      score += track.priority || 0;
      return { id: track.id, score };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
  return scored[0]?.score > 0 ? scored[0].id : null;
}

function lanePresetForJob(item: GoalPortfolioItemT, tracks: CareerTrack[]): Partial<JobFormT> {
  const guide = laneGuideForCombination(item.combination);
  return {
    roleArchetype: guide.roleArchetype || roleArchetypeForLane(item.combination),
    narrativeAngle: item.combination,
    note: `${guide.notePrefix} ${item.whyPlausible}`,
    nextStep: guide.nextStep,
    relatedTrackId: bestTrackForLane(item.combination, tracks),
    sourceType: "posting",
  };
}

function contactPresetForLane(item: GoalPortfolioItemT, tracks: CareerTrack[]): Partial<ContactFormT> {
  const guide = laneGuideForCombination(item.combination);
  return {
    sector: item.combination,
    why: `Use this contact to warm ${item.combination} in parallel while the role pipeline is still filling out. ${item.whyPlausible}`,
    targetRole: guide.titlePlaceholder,
    askType: "advice",
    relationshipStrength: "cold",
    relatedTrackId: bestTrackForLane(item.combination, tracks),
    status: "to_contact",
  };
}

function learnPresetForLane(item: GoalPortfolioItemT, tracks: CareerTrack[]): Partial<LearnFormT> {
  const guide = laneGuideForCombination(item.combination);
  const capabilityBuilt = /ai \/ technology/i.test(item.combination)
    ? "AI / technology strategy judgment"
    : /ops \/ chief of staff/i.test(item.combination)
    ? "Operating cadence, decision support, and execution follow-through"
    : "Geopolitical or policy judgment";
  const requiredOutput = /ops \/ chief of staff/i.test(item.combination)
    ? "One reusable operating artifact or memo you could show in future conversations."
    : "One reusable note, memo, or brief that strengthens this role type.";
  return {
    title: `${item.combination} capability support`,
    category: capabilityBuilt,
    capabilityBuilt,
    requiredOutput,
    note: `Support ${item.combination} in parallel while roles are still being added. ${guide.fitHint}`,
    relatedTrackId: bestTrackForLane(item.combination, tracks),
    proofIntent: true,
    learnStatus: "open",
  };
}

function TodayView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
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
  // Quick-capture: get a stray thought out of your head from Today, without
  // leaving the screen. Lands in the inbox (shows up in Brain dump to sort
  // later) — deliberately NOT onto today, so the plan below stays calm.
  const [quickText, setQuickText] = useState("");
  async function quickCapture() {
    const t = quickText.trim();
    if (!t) return;
    setQuickText("");
    const created = await mutateAndInvalidate("POST", "/api/tasks", { title: t, list: "inbox", done: false }, ["/api/tasks"]);
    if (created?.id) mutateAndInvalidate("POST", `/api/tasks/${created.id}/enrich`, {}, ["/api/tasks"]).catch(() => {});
    toast({ title: "Captured.", description: "It's in your brain dump — sort it whenever." });
  }
  const [energy, setEnergy] = useState("medium");
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));

  // Load the PERSISTED plan (it lives in the DB now — survives reloads).
  useEffect(() => {
    if (isLoading || tracksLoading || tracks.length === 0 || pinned || plan || loadingPlan) return;
    getPlan("medium");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, tracksLoading, pinned, tracks.length]);

  async function getPlan(e: string, recompute = false) {
    setLoadingPlan(true);
    try {
      // Recompute when energy is explicitly chosen; otherwise just read current.
      const r = recompute || e !== "medium"
        ? await mutateAndInvalidate("POST", "/api/plan/recompute", { energy: e, day }, [])
        : await mutateAndInvalidate("GET", `/api/plan/current?day=${day}&energy=${e}`, undefined, []);
      setPlan(r?.plan || null); setPlanItems(Array.isArray(r?.items) ? r.items : []);
    } catch { toast({ title: "Couldn't shape the day", description: "Try again in a moment." }); }
    finally { setLoadingPlan(false); }
  }
  // Start an item via the IDENTITY-PRESERVING endpoint: it reads the exact plan
  // item id, creates/reuses the backing task, links taskId both ways, derives the
  // block from the slot (no hardcoded "morning"), and preserves source/doneWhen.
  async function startItem(it: PlanItemT) {
    await mutateAndInvalidate("POST", `/api/plan-items/${it.id}/start`, { day }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles"]);
    setPlan(null); setPlanItems([]);
    toast({ title: "Started — this is your focus.", description: "Tiny steps next. One at a time." });
  }

  const activeItems = planItems.filter((it) => it.status === "planned" || it.status === "started");
  const isMVD = (it: PlanItemT) => plan?.minimumViableItemId === it.id;

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; })();

  // Only gate to onboarding once the tracks query has GENUINELY resolved to an
  // empty list. On a cold backend wake the query can error (retry is off), which
  // leaves tracks defaulting to [] — treating that as "zero tracks" would flash
  // onboarding at a user who actually has data. So an error is NOT empty.
  if (!tracksLoading && !tracksError && !isLoading && tracks.length === 0) return <OnboardingView />;
  const activeGoal = goalState?.goals?.[0] || null;

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">{greeting}, Rohini</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-3">Here's your day. Start at the top — you don't have to decide.</p>

      {/* Quick-capture — always here so a stray thought never needs another tab. */}
      {activeGoal && <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" />}
      <div className="mb-5 flex gap-2">
        <Input value={quickText} onChange={(e) => setQuickText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") quickCapture(); }}
          placeholder="Add anything on your mind…" className="h-10" data-testid="input-quick-capture" />
        <Button className="h-10 px-3 shrink-0" variant="outline" onClick={quickCapture} data-testid="button-quick-capture"><Plus className="w-4 h-4 mr-1" /> Capture</Button>
      </div>

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
                <div className="flex items-center gap-1" aria-label="Energy level">
                  {([["low", "Low"], ["medium", "Medium"], ["high", "High"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => { setEnergy(v); getPlan(v, true); }} data-testid={`energy-${v}`}
                      className={`px-2 py-1 rounded-full text-xs font-medium border transition-colors ${energy === v ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {activeItems.map((it, i) => {
                  const linkedTask = it.taskId ? taskById.get(it.taskId) : undefined;
                  const nextStepText = firstStepPreview(it, linkedTask);
                  const preShrunk = isPreShrunkPlanItem(it);
                  const showPreviewStep = !!nextStepText;
                  const broadPursuitItem = isBroadPursuitGoalItem(it, activeGoal);
                  const broadPursuitCoverage = broadPursuitItem && activeGoal ? getBroadPursuitCoverage(activeGoal) : null;
                  const compactTitle = broadPursuitItem ? (broadPursuitPlanTitle(activeGoal) || it.title) : it.title;
                  const compactSummary = broadPursuitItem
                    ? "One real role per target type is enough to start getting market signal."
                    : (it.explanation?.summary || it.whySelected);
                  return (
                  <button key={it.id} onClick={() => startItem(it)} data-testid={`plan-item-${i}`} data-plan-rank={String(i)}
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
                )})}
              </div>
              {plan.note && <p className="text-xs text-muted-foreground mt-3 italic">{plan.note}</p>}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">Nothing queued to plan yet. Add a thought, a job, or something to learn — then I'll shape a day.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onOpenTab("braindump")}>Brain dump</Button>
                <Button size="sm" variant="outline" onClick={() => getPlan(energy, true)}>Try again</Button>
              </div>
            </div>
          )}
        </div>
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
            {/* Completed today — each can be explicitly promoted to a categorised win */}
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

/* ================= STRATEGY (the quiet bird's-eye view) ================= */
type TrackDiagnostic = {
  id: number; slug: string; name: string; status: string; priority: number; whyItFits: string;
  counts: { jobs: number; learn: number; contacts: number; hustles: number; tasks: number };
  signals: { directionGap: number; readinessGap: number; proofGap: number; warmthGap: number; executionGap: number; learningGap?: number; learnProofGap?: number; evidenceGap?: number };
  evidence?: {
    count: number; topCategory: WinCategory | null;
    producingVsPlanning: "producing" | "balanced" | "planning" | "idle";
    executionRatio: number | null; lastEvidenceAt: number | null;
  };
  learningGap?: {
    requiredCount: number; evidencedCount: number; gapCount: number;
    topGapLabel: string | null; topGapHasResource: boolean; recommendedMove: string | null;
  } | null;
  bottleneck: string; bottleneckLabel: string; recommendedMove: string;
};
type UnlinkedItem = { entity: "jobs" | "learn" | "contacts" | "hustles"; id: number; title: string; status: string };
type StrategyInsight = { kind: string; text: string };
// P4.6a #5 — the single unified Strategy payload (one diagnostics engine).
type LearningGapSignal = {
  trackId: number; trackName: string; gapDomains: string[];
  topGap: { domain: string; label: string };
  recommendedMove: string; hasResource: boolean;
};
type FrontDoor = {
  tracks: TrackDiagnostic[];
  topThree: TrackDiagnostic[];
  insights: StrategyInsight[];
  unlinked: { items: UnlinkedItem[]; counts: Record<string, number> };
  evidence?: unknown;
  learningGap?: LearningGapSignal | null;
};
const BOTTLENECK_LABEL: Record<string, string> = {
  direction: "Direction", readiness: "Readiness", proof: "Proof support", warmth: "Warmth", execution: "Execution", learning: "Capability", none: "Healthy",
};
// P4.5 — compact, in-palette evidence chips for the per-track Strategy view.
// Read-mostly: count (rolling window), top winCategory, producing-vs-planning.
// Slate-blue only, NO coral — these are calm signals, never alarms.
const PVP_META: Record<"producing" | "balanced" | "planning" | "idle", { label: string; cls: string }> = {
  producing: { label: "Producing", cls: "bg-primary/10 text-primary" },
  balanced: { label: "Balanced", cls: "bg-slate-100 text-slate-600" },
  planning: { label: "Planning, not producing", cls: "bg-slate-200 text-slate-700" },
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground" },
};
function EvidenceChips({ ev }: { ev: NonNullable<TrackDiagnostic["evidence"]> }) {
  const pvp = PVP_META[ev.producingVsPlanning];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="evidence-chips">
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-medium px-1.5 py-0.5" data-testid="evidence-count">
        <Trophy className="w-3 h-3" /> {ev.count} {ev.count === 1 ? "win" : "wins"} · 28d
      </span>
      {ev.topCategory && (
        <span className="inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid="evidence-top-category">
          {WIN_CATEGORY_LABEL[ev.topCategory]}
        </span>
      )}
      <span className={`inline-flex shrink-0 text-[10px] rounded-full px-1.5 py-0.5 ${pvp.cls}`} data-testid="evidence-pvp">{pvp.label}</span>
    </div>
  );
}
// P5 — compact, calm capability-gap chips for the per-track Strategy view.
// Evidenced = slate-green (a quiet "covered"), gap = muted/neutral (NOT alarming).
// Slate-blue/green palette only, NO coral — gaps are a structural read, not a nag.
function CapabilityChips({ lg }: { lg: NonNullable<TrackDiagnostic["learningGap"]> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="capability-chips">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium px-1.5 py-0.5" data-testid="capability-evidenced">
        {lg.evidencedCount}/{lg.requiredCount} capabilities
      </span>
      {lg.gapCount > 0 && (
        <span className="inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid="capability-gap">
          {lg.gapCount} gap{lg.gapCount === 1 ? "" : "s"}{lg.topGapLabel ? ` · ${lg.topGapLabel}` : ""}
        </span>
      )}
      {lg.gapCount > 0 && lg.topGapLabel && (
        <span className={`inline-flex shrink-0 text-[10px] rounded-full px-1.5 py-0.5 ${lg.topGapHasResource ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-700"}`} data-testid="capability-resource">
          {lg.topGapHasResource ? "resource ready" : "no resource yet"}
        </span>
      )}
    </div>
  );
}
function StrategyView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const { data, isLoading } = useQuery<FrontDoor>({ queryKey: ["/api/strategy/front-door"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: careerTracks = [] } = useCareerTracks();
  if (isLoading) return <Loading />;
  const activeGoal = goalState?.goals?.[0] || null;
  const tracks = data?.tracks || [];
  const insights = (data?.insights || []).map((i) => i.text);
  const unlinkedItems = data?.unlinked?.items || [];
  const active = tracks.filter((t) => t.status === "active");
  const watching = tracks.filter((t) => t.status !== "active");

  const TrackCard = ({ t }: { t: TrackDiagnostic }) => {
    const stalled = t.bottleneck !== "none";
    return (
      <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`track-${t.slug}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug">{t.name}</h3>
            {t.whyItFits && <p className="text-xs text-muted-foreground mt-0.5">{t.whyItFits}</p>}
          </div>
          <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{t.counts.jobs} role{t.counts.jobs !== 1 ? "s" : ""}</span>
        </div>
        {stalled ? (
          <div className="rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 px-3 py-2 mt-2.5" data-testid={`track-health-${t.slug}`}>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-snug">{t.bottleneckLabel}</p>
            <p className="text-xs text-primary mt-1.5 flex items-start gap-1"><ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-px" />{t.recommendedMove}</p>
          </div>
        ) : (
          <p className="text-xs text-primary mt-2.5 flex items-start gap-1" data-testid={`track-health-${t.slug}`}><ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-px" />{t.recommendedMove}</p>
        )}
      </div>
    );
  };

  const ENTITY_TAB: Record<UnlinkedItem["entity"], Tab> = { jobs: "jobs", learn: "learn", contacts: "network", hustles: "strategy" };
  const ENTITY_LABEL: Record<UnlinkedItem["entity"], string> = { jobs: "Job", learn: "Learn", contacts: "Contact", hustles: "Proof" };
  async function linkUnlinked(it: UnlinkedItem, trackId: number) {
    await mutateAndInvalidate("PATCH", `/api/${it.entity}/${it.id}/link-track`, { trackId }, [`/api/${it.entity}`, "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked", "/api/strategy/front-door", ...GOAL_SPINE_QUERY_KEYS]);
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Strategy</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-5">Active role types and what each needs.</p>
      {activeGoal && (
        <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" showOpenStrategy={false} />
      )}

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

      {active.length > 0 ? (
        <>
          <GroupLabel>Active role types</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {active.map((t) => <TrackCard key={t.id} t={t} />)}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mb-6">No active role types yet — add roles in the Jobs tab to get started.</p>
      )}

      {watching.length > 0 && (
        <>
          <GroupLabel>Watching</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {watching.map((t) => <TrackCard key={t.id} t={t} />)}
          </div>
        </>
      )}

      {unlinkedItems.length > 0 && (
        <div className="mb-6">
          <GroupLabel count={unlinkedItems.length}><AlertTriangle className="w-4 h-4 text-destructive" /> Not linked to a role type</GroupLabel>
          <p className="text-xs text-muted-foreground mb-2">These items aren't tied to any role type yet — link them so they count toward the right target.</p>
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
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a role type</p>
                    <div className="space-y-0.5">
                      {careerTracks.map((t) => (
                        <button key={t.id} onClick={() => linkUnlinked(it, t.id)} className="w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate">{t.name}</button>
                      ))}
                      {careerTracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No role types yet.</p>}
                    </div>
                  </PopoverContent>
                </Popover>
                <button onClick={() => onOpenTab(ENTITY_TAB[it.entity])} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-card-border">
        <ProofAssetsView />
      </div>

      <div className="flex flex-wrap gap-2 mt-8">
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
  // Completion goes through the real endpoint: marks done, logs a win, updates the
  // SOURCE object (e.g. a job → applied), the plan item, and checks the MVD.
  async function finishTask() {
    await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/complete`, { day: todayKey() }, ["/api/tasks", "/api/wins", "/api/stats", "/api/jobs"]);
    toast({ title: "Done — and logged as a win 🎉", description: "That's momentum. Pick your next thing when ready." });
  }
  async function unstick() {
    if (!current) return;
    setUnsticking(true);
    try {
      const payload: Record<string, string> = { step: current.text };
      if (workflowCtx?.currentStage) payload.currentStage = workflowCtx.currentStage;
      if (workflowCtx?.stageOutput) payload.stageOutput = workflowCtx.stageOutput;
      const res = await mutateAndInvalidate("POST", "/api/unstick", payload, []);
      setHint(res.hint || null);
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
      {workflowCtx?.currentStage && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-primary/80">{workflowCtx.currentStage}</span>
          {workflowCtx.stageOutput && workflowCtx.stageOutput !== pinned.doneWhen && (
            <><span aria-hidden>·</span><span>{workflowCtx.stageOutput}</span></>
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
                      <span className="shrink-0 mt-0.5 text-primary/40" aria-hidden>›</span>
                      {sub}
                    </li>
                  ))}
                </ul>
              )}
              {steps.length > 1 && (
                <p className="text-[11px] text-muted-foreground mt-1.5">Tap to mark done — next step will appear</p>
              )}
            </div>
          </div>
          {hint ? (
            <p className="mt-2 text-sm rounded-lg bg-accent text-accent-foreground px-3 py-2" data-testid="text-unstick-hint">{hint}</p>
          ) : (
            <button onClick={unstick} disabled={unsticking} data-testid="button-unstick"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary disabled:opacity-60">
              {unsticking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {unsticking ? "Thinking…" : "Stuck? Get a nudge"}
            </button>
          )}
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
// A capture is not always a standalone task — it may be a subtask of something
// she already has, a note/idea, a new project, or clutter. Triage classifies
// each by KIND and offers ONE coherent next move per item (she confirms with a
// tap — we never silently reshape her day).
type CaptureSug = { id: number; route: string; label: string; reason: string; confidence: string; question?: string };
const ROUTE_ACTION_LABEL: Record<string, string> = {
  today: "Do today", task: "Keep as task", job: "File under Jobs", learn: "File under Learn",
  network: "File under Network", proof: "File as Work sample", decision: "Needs a decision", keep: "Keep here",
};
function BrainDumpView() {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [text, setText] = useState("");
  const [sorting, setSorting] = useState(false);
  const [triage, setTriage] = useState<Record<number, CaptureSug>>({});
  const { toast } = useToast();
  const inbox = tasks.filter((t) => t.list === "inbox");

  async function add() {
    if (!text.trim()) return;
    const created = await mutateAndInvalidate("POST", "/api/tasks", { title: text.trim(), list: "inbox", done: false }, ["/api/tasks"]);
    setText("");
    if (created?.id) mutateAndInvalidate("POST", `/api/tasks/${created.id}/enrich`, {}, ["/api/tasks"]).catch(() => {});
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/tasks/${id}`, undefined, ["/api/tasks"]); }

  // Classify all open captures in one pass via the canonical capture engine.
  async function sortAll() {
    setSorting(true);
    try {
      const r = await apiRequest("POST", "/api/capture/sort");
      const data = await r.json();
      const map: Record<number, CaptureSug> = {};
      (data?.suggestions || []).forEach((sg: CaptureSug) => { map[sg.id] = sg; });
      setTriage(map);
    } catch { toast({ title: "Couldn't sort right now", description: "Give it another go in a moment." }); }
    finally { setSorting(false); }
  }

  // File a capture along a chosen route (the enriched engine fills in real details).
  async function applyRoute(t: Task, route: string, label = "Done") {
    await mutateAndInvalidate("POST", `/api/capture/${t.id}/route`, { route }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles", "/api/contacts", "/api/plan/current"]);
    setTriage((st) => { const n = { ...st }; delete n[t.id]; return n; });
    toast({ title: label });
  }

    return (
    <div>
      <SectionHeading title="Brain dump" sub="Empty your head now. Sort it later." />
      <div className="flex gap-2 mb-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Type anything and hit Enter…" className="h-11" data-testid="input-braindump" />
        <Button className="h-11 px-4" onClick={add} data-testid="button-add-braindump"><Plus className="w-4 h-4 mr-1" /> Add</Button>
      </div>
      {inbox.length > 0 && (
        <div className="mb-5">
          <Button variant="outline" onClick={sortAll} disabled={sorting} data-testid="button-sort-braindump"
            className="inline-flex items-center gap-1.5">
            {sorting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{sorting ? "Sorting…" : "Sort these for me"}
          </Button>
          <p className="text-xs text-muted-foreground mt-1.5">I'll work out what each one is — a task for today, part of something you're already on, an idea, or just a note.</p>
        </div>
      )}
      {isLoading ? <Loading /> : inbox.length === 0 ? (
        <Empty icon={Sparkles} text="Empty head, clear mind. Add a thought above when one shows up." />
      ) : (
        <div className="space-y-2">
          {inbox.map((t) => {
            const tr = triage[t.id];
            return (
              <div key={t.id} className="group rounded-lg border border-card-border bg-card px-3 py-2.5" data-testid={`braindump-${t.id}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{t.title}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {!tr && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => applyRoute(t, "today", "Added to today")} data-testid={`button-addday-${t.id}`}>Add to day</Button>}
                    <button onClick={() => remove(t.id)} aria-label="Delete" data-testid={`button-delete-braindump-${t.id}`} className="text-muted-foreground hover:text-destructive ml-0.5"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                {tr && (
                  <div className="mt-2 pt-2 border-t border-card-border flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{tr.reason || tr.label}</span>
                    {tr.route !== "keep" && (
                      <button onClick={() => applyRoute(t, tr.route, `${ROUTE_ACTION_LABEL[tr.route] || "Filed"}`)} data-testid={`button-triage-accept-${t.id}`}
                        className="text-xs font-medium text-primary inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 hover-elevate">
                        <ArrowRight className="w-3 h-3" /> {ROUTE_ACTION_LABEL[tr.route] || "File it"}
                      </button>
                    )}
                    {tr.route !== "today" && (
                      <button onClick={() => applyRoute(t, "today", "Added to today")} data-testid={`button-triage-today-${t.id}`} className="text-xs text-muted-foreground hover:text-foreground">or just do today</button>
                    )}
                    <button onClick={() => setTriage((s) => { const n = { ...s }; delete n[t.id]; return n; })} data-testid={`button-triage-dismiss-${t.id}`} className="text-xs text-muted-foreground hover:text-foreground">keep here</button>
                  </div>
                )}
              </div>
            );
          })}
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
  const { data: learns = [] } = useQuery<Learn[]>({ queryKey: ["/api/learn"] });
  const { data: truthStrips = [] } = useQuery<JobTruthStripT[]>({ queryKey: ["/api/jobs/truth-strips"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const truthById = new Map(truthStrips.map((truth) => [truth.jobId, truth]));
  const activeGoal = goalState?.goals?.[0] || null;
  const [showForm, setShowForm] = useState(false);
  const [showMoreJobFields, setShowMoreJobFields] = useState(false);
  const [form, setForm] = useState<JobFormT>(EMPTY_JOB_FORM);
  const [selectedLane, setSelectedLane] = useState<string>("");
  const selectedLaneGuide = selectedLane ? laneGuideForCombination(selectedLane) : null;
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/jobs", { ...form, status: "wishlist", flag: "" }, ["/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
    setForm(EMPTY_JOB_FORM); setSelectedLane(""); setShowForm(false); setShowMoreJobFields(false);
  }
  function startBlankRole() {
    setSelectedLane("");
    setForm(EMPTY_JOB_FORM);
    setShowForm(true);
  }
  function startLaneRole(item: GoalPortfolioItemT) {
    const preset = lanePresetForJob(item, tracks);
    setForm(() => ({
      ...EMPTY_JOB_FORM,
      ...preset,
    }));
    setSelectedLane(item.combination);
    setShowForm(true);
  }
  async function move(j: Job, dir: 1 | -1) {
    const idx = JOB_COLS.findIndex((c) => c.id === j.status);
    const next = JOB_COLS[idx + dir];
    if (next) await mutateAndInvalidate("PATCH", `/api/jobs/${j.id}`, { status: next.id }, ["/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/jobs/${id}`, undefined, ["/api/jobs", ...GOAL_SPINE_QUERY_KEYS]); }

  // MECE lanes: fellowships are OPPORTUNITIES YOU APPLY TO, grouped in their own
  // lane (not paid roles). Everything else flows through the paid-role kanban.
  const fellowships = jobs.filter(isFellowship).sort(sortJobs);
  const roles = jobs.filter((j) => !isFellowship(j));

  // Only show columns that have items (plus always 'wishlist'); shrink empties to a thin line.
  const grouped = JOB_COLS.map((col) => ({ col, items: roles.filter((j) => j.status === col.id).sort(sortJobs) }));
  const active = grouped.filter((g) => g.items.length > 0 || g.col.id === "wishlist");
  const empty = grouped.filter((g) => g.items.length === 0 && g.col.id !== "wishlist");

  // Within the Fellowships lane, separate the ones she can act on now (open window)
  // from the watch/closed ones she's monitoring for the next cycle.
  const openFellowships = fellowships.filter((f) => f.applicationWindowStatus !== "closed" && f.status !== "closed");
  const watchFellowships = fellowships.filter((f) => f.applicationWindowStatus === "closed" || f.status === "closed");
  const showRoleBoard = roles.length > 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Jobs" sub="Roles and applications, soonest deadlines first." />
        <Button onClick={() => showForm ? setShowForm(false) : startBlankRole()} className="shrink-0" data-testid="button-toggle-job-form"><Plus className="w-4 h-4 mr-1" /> Add role</Button>
      </div>
      {activeGoal && !(roles.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="jobs" goal={activeGoal} />}
      {activeGoal && roles.length === 0 && <BroadPursuitJobsKickoff goal={activeGoal} onStartLane={startLaneRole} />}
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 space-y-3">
          {selectedLane && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2" data-testid="job-form-lane-banner">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Role type</p>
                <p className="text-sm font-medium">{selectedLane}</p>
                {selectedLaneGuide && <p className="text-xs text-muted-foreground mt-0.5">{selectedLaneGuide.fitHint}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedLane(""); setForm((c) => ({ ...c, roleArchetype: "", narrativeAngle: "", note: "", nextStep: "", relatedTrackId: null })); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0" data-testid="button-clear-job-lane">Clear</button>
            </div>
          )}
          {/* Minimum fields — just enough to save it fast */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder={selectedLaneGuide?.titlePlaceholder || "Role title *"}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              data-testid="input-job-title"
              autoFocus
            />
            <Input placeholder="Company / org" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} data-testid="input-job-company" />
            <Input placeholder="Link to posting" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="sm:col-span-2" data-testid="input-job-url" />
          </div>
          {tracks.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Link to a role type (optional)</p>
              <div className="flex flex-wrap gap-1.5">
                {tracks.map((track) => (
                  <button key={track.id} type="button" onClick={() => setForm({ ...form, relatedTrackId: form.relatedTrackId === track.id ? null : track.id })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-job-track-${track.id}`}>{track.name}</button>
                ))}
              </div>
            </div>
          )}
          {/* Progressive disclosure — extra fields only when needed */}
          <button type="button" onClick={() => setShowMoreJobFields((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreJobFields ? "rotate-180" : ""}`} />
            {showMoreJobFields ? "Fewer options" : "More options (deadline, role type, notes)"}
          </button>
          {showMoreJobFields && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Deadline (YYYY-MM-DD)" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} data-testid="input-job-deadline" />
              <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-job-location" />
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Role type (shapes the readiness checklist)</p>
                <div className="flex flex-wrap gap-1.5">
                  {JOB_ARCHETYPE_OPTIONS.map((option) => (
                    <button key={option.value} type="button" onClick={() => setForm({ ...form, roleArchetype: option.value })}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.roleArchetype === option.value ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                      data-testid={`button-job-archetype-${option.value}`}>{option.label}</button>
                  ))}
                </div>
              </div>
              <Input placeholder="Why you fit this role" value={form.narrativeAngle} onChange={(e) => setForm({ ...form, narrativeAngle: e.target.value })} className="sm:col-span-2" data-testid="input-job-narrative-angle" />
              <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sm:col-span-2" data-testid="input-job-note" />
              <Input placeholder="First next step" value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} className="sm:col-span-2" data-testid="input-job-nextstep" />
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Job description</p>
                <textarea
                  placeholder="Paste the job posting here — used to suggest specific CV edits when you work on this application"
                  value={form.jdText}
                  onChange={(e) => setForm({ ...form, jdText: e.target.value })}
                  data-testid="input-job-jd"
                  className="w-full min-h-[120px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setSelectedLane(""); setForm(EMPTY_JOB_FORM); setShowMoreJobFields(false); }}>Cancel</Button>
            <Button onClick={add} data-testid="button-save-job">Save role</Button>
          </div>
        </div>
      )}
      {isLoading ? <Loading /> : (
        <>
          {showRoleBoard && (
            <div className="space-y-6">
              {active.map(({ col, items }) => (
                items.length > 0 || col.id === "wishlist" ? (
                  <div key={col.id}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.label}</span>
                      {items.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">({items.length})</span>}
                    </div>
                    <div className="space-y-2">
                      {items.map((j) => <JobCard key={j.id} j={j} truth={truthById.get(j.id) || null} tracks={tracks} tasks={tasks} contacts={contacts} learns={learns} onMove={move} onRemove={() => remove(j.id)} />)}
                      {items.length === 0 && col.id === "wishlist" && (
                        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                          <p className="text-sm text-muted-foreground">No roles yet — add one above or use a lane shortcut.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          )}
          {/* FELLOWSHIPS LANE — opportunities you apply to (eligibility + deadline +
              application steps), NOT resources you consume. Open ones render with
              the fellowship readiness rail; watch/closed ones read as monitored. */}
          {fellowships.length > 0 && (
            <div className="mt-8" data-testid="fellowships-lane">
              <SectionHeading title="Fellowships" sub="Opportunities you apply to. Closed ones are kept to watch for next cycle." />
              {openFellowships.length > 0 && (
                <div className="mb-4">
                  <GroupLabel count={openFellowships.length}><Compass className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Open / apply now</GroupLabel>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {openFellowships.map((j) => <JobCard key={j.id} j={j} truth={truthById.get(j.id) || null} tracks={tracks} tasks={tasks} contacts={contacts} learns={learns} onMove={move} onRemove={() => remove(j.id)} />)}
                  </div>
                </div>
              )}
              {watchFellowships.length > 0 && (
                <div>
                  <GroupLabel count={watchFellowships.length}><CalendarDays className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Watch / closed for 2026</GroupLabel>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {watchFellowships.map((j) => <JobCard key={j.id} j={j} truth={truthById.get(j.id) || null} tracks={tracks} tasks={tasks} contacts={contacts} learns={learns} onMove={move} onRemove={() => remove(j.id)} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
/* P4.1: Job pipeline step rail — a task-generative readiness view over a job.
   Each step does ONE of: materialize-as-task / mark-done / mark-blocked. Editing
   changes sequence/label only. Eligibility = locked amber chip above the rail
   (nothing hidden). Deadline lives in the card clarity strip, never orders steps. */
const ELIGIBILITY_LABEL: Record<string, string> = {
  visa: "Visa sponsorship needed", citizenship: "Citizenship required",
  phd: "PhD required", likely_ineligible: "Likely ineligible",
};
const STEP_STATUS_TONE: Record<string, string> = {
  done: "bg-primary/10 text-primary",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  skipped: "bg-muted text-muted-foreground line-through",
  todo: "bg-muted text-muted-foreground",
};
function JobStepRail({ j }: { j: Job }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const stepsKey = ["/api/jobs", j.id, "steps"];
  const { data: steps = [], isLoading } = useQuery<JobPipelineStep[]>({
    queryKey: stepsKey,
    queryFn: async () => { const r = await apiRequest("GET", `/api/jobs/${j.id}/steps`); const d = await r.json(); return Array.isArray(d) ? d : []; },
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  async function reloadInto() { await qc.invalidateQueries({ queryKey: stepsKey }); }

  async function seed() {
    setBusy(true);
    try {
      await mutateAndInvalidate("POST", `/api/jobs/${j.id}/steps/seed`, {}, ["/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      await reloadInto();
      toast({ title: "Steps generated.", description: "From the role's template — edit them to fit." });
    } catch { toast({ title: "Couldn't generate steps", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }

  async function materialize(s: JobPipelineStep) {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/steps/${s.id}/materialize`, {}, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      await reloadInto();
      toast({ title: r?.reused ? "Already on your list." : "Task created from this step.", description: r?.reused ? "There's already an open task for this role." : "Find it in Brain dump, or in Today if it gets planned." });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function setStatus(s: JobPipelineStep, status: string) {
    await mutateAndInvalidate("PATCH", `/api/steps/${s.id}`, { status }, ["/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    await reloadInto();
  }
  async function block(s: JobPipelineStep) {
    await mutateAndInvalidate("POST", `/api/steps/${s.id}/block`, { reason: "Blocked from the rail" }, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    await reloadInto();
    toast({ title: "Marked blocked.", description: "Noted on the step — unblock it when ready." });
  }
  async function rename(s: JobPipelineStep, stepLabel: string) {
    if (!stepLabel.trim() || stepLabel === s.stepLabel) return;
    await mutateAndInvalidate("PATCH", `/api/steps/${s.id}`, { stepLabel: stepLabel.trim() }, []);
    await reloadInto();
  }
  async function del(s: JobPipelineStep) {
    await mutateAndInvalidate("DELETE", `/api/steps/${s.id}`, undefined, ["/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    await reloadInto();
  }
  async function addStep() {
    if (!newLabel.trim()) return;
    await mutateAndInvalidate("POST", `/api/jobs/${j.id}/steps`, { stepLabel: newLabel.trim() }, ["/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    setNewLabel("");
    await reloadInto();
  }
  async function reorder(s: JobPipelineStep, dir: -1 | 1) {
    const ids = steps.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const ni = i + dir;
    if (ni < 0 || ni >= ids.length) return;
    [ids[i], ids[ni]] = [ids[ni], ids[i]];
    await mutateAndInvalidate("PATCH", `/api/jobs/${j.id}/steps/reorder`, { orderedStepIds: ids }, ["/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    await reloadInto();
  }

  const doneCount = steps.filter((s) => s.status === "done").length;
  const eligLabel = j.eligibilityRisk ? (ELIGIBILITY_LABEL[j.eligibilityRisk] || j.eligibilityRisk) : "";

  // A closed-window opportunity (e.g. a watch/closed 2026 fellowship) is MONITORED,
  // not actionable: show the eligibility + window context, but offer no task-
  // generating rail so the app never suggests applying to a closed cycle.
  if (j.applicationWindowStatus === "closed") {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-card-border" data-testid={`steprail-${j.id}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 px-2 py-1 text-[11px] font-medium" data-testid={`window-closed-${j.id}`}>
            <CalendarDays className="w-3 h-3" /> Watching for the next cycle
          </span>
          {eligLabel && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-1 text-[11px] font-medium" data-testid={`eligibility-${j.id}`}>
              <Lock className="w-3 h-3" /> {eligLabel}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-card-border" data-testid={`steprail-${j.id}`}>
      {/* Eligibility = LOCKED AMBER chip above the rail. Hides nothing — flag only. */}
      {eligLabel && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-1 text-[11px] font-medium" data-testid={`eligibility-${j.id}`}>
          <Lock className="w-3 h-3" /> {eligLabel}
        </div>
      )}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ListChecks className="w-3.5 h-3.5" /> Readiness rail
          {steps.length > 0 && <span className="tabular-nums opacity-70">{doneCount}/{steps.length}</span>}
        </div>
        {steps.length > 0 && (
          <button onClick={() => setEditing((e) => !e)} data-testid={`button-edit-steps-${j.id}`} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <Pencil className="w-3 h-3" /> {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground/60 py-1">Loading steps…</p>
      ) : steps.length === 0 ? (
        <button onClick={seed} disabled={busy} data-testid={`button-seed-steps-${j.id}`}
          className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Generate steps
        </button>
      ) : (
        <div className="space-y-1">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-start gap-2" data-testid={`step-${s.id}`}>
              <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STEP_STATUS_TONE[s.status] || STEP_STATUS_TONE.todo}`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                {editing ? (
                  <input defaultValue={s.stepLabel} onBlur={(e) => rename(s, e.target.value)} data-testid={`input-step-label-${s.id}`}
                    className="w-full text-xs bg-transparent border-b border-input pb-0.5 focus:outline-none focus:border-primary" />
                ) : (
                  <p className={`text-xs leading-snug ${s.status === "done" ? "line-through text-muted-foreground" : ""}`}>{s.stepLabel}</p>
                )}
                {s.status === "blocked" && <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 inline-flex items-center gap-1"><Ban className="w-2.5 h-2.5" /> blocked{s.note ? `: ${s.note}` : ""}</p>}
                {s.status === "skipped" && <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><X className="w-2.5 h-2.5" /> skipped{s.note ? `: ${s.note}` : ""}</p>}
                {s.taskId && !editing && <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><ListChecks className="w-2.5 h-2.5" /> task created</p>}
              </div>
              {editing ? (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => reorder(s, -1)} disabled={i === 0} data-testid={`button-step-up-${s.id}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => reorder(s, 1)} disabled={i === steps.length - 1} data-testid={`button-step-down-${s.id}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(s)} data-testid={`button-step-delete-${s.id}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ) : (s.status === "done" || s.status === "skipped") ? (
                <button onClick={() => setStatus(s, "todo")} title="Reopen" data-testid={`button-step-reopen-${s.id}`} className="shrink-0 text-muted-foreground hover:text-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => materialize(s)} disabled={busy} title="Create a task from this step" data-testid={`button-step-materialize-${s.id}`} className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-0.5 disabled:opacity-60"><Plus className="w-3 h-3" /> Task</button>
                  <button onClick={() => setStatus(s, "done")} title="Mark done" data-testid={`button-step-done-${s.id}`} className="text-muted-foreground hover:text-primary"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                  {s.status === "blocked"
                    ? <button onClick={() => setStatus(s, "todo")} title="Unblock" data-testid={`button-step-unblock-${s.id}`} className="text-muted-foreground hover:text-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
                    : <button onClick={() => block(s)} title="Mark blocked" data-testid={`button-step-block-${s.id}`} className="text-muted-foreground hover:text-amber-600"><Ban className="w-3.5 h-3.5" /></button>}
                </div>
              )}
            </div>
          ))}
          {editing && (
            <div className="flex items-center gap-1.5 pt-1">
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStep(); }}
                placeholder="Add a step…" className="h-7 text-xs" data-testid={`input-add-step-${j.id}`} />
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={addStep} data-testid={`button-add-step-${j.id}`}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function learnSupportScore(l: Learn) {
  let total = 0;
  if (l.active) total += 4;
  const outputState = getLearnOutputState(l);
  if (outputState === "producing") total += 3;
  if (outputState === "evidenced") total += 2;
  if (getLearnStatus(l) === "active" || getLearnStatus(l) === "enrolled") total += 2;
  return total;
}

function getJobCapabilitySupportItems(trackId: number | null, learns: Learn[]) {
  if (trackId == null) return [];
  return learns
    .filter((l) => !l.done && getTrackId("learn", l) === trackId)
    .sort((a, b) => learnSupportScore(b) - learnSupportScore(a) || b.id - a.id)
    .slice(0, 3);
}

function getJobWarmSupport(trackId: number | null, contacts: Contact[]) {
  const trackContacts = trackId != null ? contacts.filter((c) => getTrackId("contacts", c) === trackId) : [];
  const warmTrackContacts = trackContacts.filter((c) => c.status === "messaged" || c.status === "replied" || getRelationshipStrength(c) !== "cold");
  const weak = trackId == null ? (contacts.length === 0) : ((warmTrackContacts.length === 0));
  const pool = trackContacts.length > 0 ? trackContacts : contacts;
  const candidates = pool.filter((c) => c.status !== "replied").slice(0, 3);
  return { trackContacts, warmTrackContacts, weak, candidates };
}

const READINESS_STAGES = [
  { key: "cv", label: "CV tailored" },
  { key: "cover", label: "Cover letter" },
  { key: "questions", label: "Application questions" },
  { key: "sample", label: "Work sample" },
  { key: "referral", label: "Referral secured" },
  { key: "submitted", label: "Submitted" },
  { key: "follow_up", label: "Followed up" },
] as const;
const READINESS_ORDER = ["none", "cv", "cover", "questions", "sample", "referral", "submitted", "follow_up"];

function ApplicationReadinessBar({ j, expanded }: { j: Job; expanded: boolean }) {
  const { toast } = useToast();
  const currentIdx = READINESS_ORDER.indexOf(j.applicationReadiness || "none");

  async function setReadiness(stageKey: string) {
    const clickedIdx = READINESS_ORDER.indexOf(stageKey);
    const newKey = clickedIdx === currentIdx ? (READINESS_ORDER[clickedIdx - 1] ?? "none") : stageKey;
    await mutateAndInvalidate("PATCH", `/api/jobs/${j.id}`, { applicationReadiness: newKey }, ["/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
    const label = READINESS_STAGES.find((s) => s.key === newKey)?.label;
    toast({ title: newKey === "none" ? "Checklist cleared." : `Marked: ${label}` });
  }

  if (!expanded) {
    if (currentIdx === 0) return null;
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          {READINESS_STAGES.map((s, i) => (
            <div key={s.key} className={`w-1.5 h-1.5 rounded-full ${i + 1 <= currentIdx ? "bg-primary" : "bg-muted-foreground/25"}`} />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">{READINESS_STAGES[currentIdx - 1]?.label}</span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Application checklist</p>
      <div className="space-y-0.5">
        {READINESS_STAGES.map((s, i) => {
          const done = i + 1 <= currentIdx;
          const nextUp = i === currentIdx;
          return (
            <button
              key={s.key}
              onClick={() => setReadiness(s.key)}
              className={`w-full flex items-center gap-2 text-left px-1.5 py-1 rounded text-xs transition-colors hover:bg-muted/50 ${done ? "text-foreground" : nextUp ? "text-foreground font-medium" : "text-muted-foreground"}`}
              data-testid={`readiness-${j.id}-${s.key}`}
            >
              <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${done ? "border-primary bg-primary/15" : nextUp ? "border-foreground/40" : "border-muted-foreground/25"}`}>
                {done && <Check className="w-2 h-2 text-primary" />}
              </span>
              <span>{s.label}</span>
              {nextUp && <span className="ml-auto text-[10px] text-muted-foreground/60">up next</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JobCard({ j, truth, tracks, tasks, contacts, learns, onMove, onRemove }: { j: Job; truth: JobTruthStripT | null; tracks: CareerTrack[]; tasks: Task[]; contacts: Contact[]; learns: Learn[]; onMove: (j: Job, d: 1 | -1) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const idx = JOB_COLS.findIndex((c) => c.id === j.status);
  const trackId = getTrackId("jobs", j);
  const track = tracks.find((t) => t.id === trackId) || null;
  const linked = useLinkedTaskCount(tasks, "job", j.id);
  const [open, setOpen] = useState(false);
  const [primaryBusy, setPrimaryBusy] = useState(false);

  // An eligibility-gated role is a dead end — don't dangle the whole work surface
  // (rail + outreach) under it. It collapses to a quiet "probably skip" state.
  const gated = j.eligibilityRisk === "likely_ineligible";
  const windowClosed = j.applicationWindowStatus === "closed" || j.status === "closed";
  const warmSupport = getJobWarmSupport(trackId, contacts);
  const supportItems = getJobCapabilitySupportItems(trackId, learns);
  const requiredDomains = track ? requiredDomainsForTrack(track) : [];

  async function createJobNextTask() {
    const r = await mutateAndInvalidate("POST", `/api/jobs/${j.id}/create-next-task`, {}, ["/api/tasks", "/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: r?.reused ? "Already on your list." : "Job task created.",
      description: r?.reused ? "There's already an open task for this role." : "Find it in Brain dump, or in Today if it gets planned.",
    });
  }

  async function createOutreachTask(c: Contact) {
    const r = await mutateAndInvalidate("POST", `/api/contacts/${c.id}/create-next-task`, {}, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: r?.reused ? "Already on your list." : "Outreach task created.",
      description: r?.reused ? "There's already an open task for this contact." : "Find it in Brain dump, or in Today if it gets planned.",
    });
  }

  async function createSupportTask(l: Learn) {
    const endpoint = getLearnOutputState(l) === "reference" ? `/api/learn/${l.id}/create-next-task` : `/api/learn/${l.id}/create-output-task`;
    const r = await mutateAndInvalidate("POST", endpoint, {}, ["/api/tasks", "/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: r?.reused ? "Already on your list." : "Support task created.",
      description: r?.reused ? "There's already an open task for this learning item." : "Find it in Brain dump, or in Today if it gets planned.",
    });
  }

  function openNetworkIntake() {
    const draft = {
      sector: j.company || "",
      targetOrg: j.company || "",
      targetRole: j.title || "",
      why: `Could help warm a path into ${j.title}${j.company ? ` at ${j.company}` : ""}.`,
      relatedTrackId: trackId,
      askType: truth?.action === "warm" ? "referral" : "advice",
      relationshipStrength: "cold",
      status: "to_contact",
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
  }

  function openLearnIntake() {
    const primaryDomain = requiredDomains.length > 0 ? domainLabel(requiredDomains[0]) : "";
    const draft = {
      title: primaryDomain ? `${primaryDomain} capability support` : `${track?.name || j.title} capability support`,
      category: primaryDomain,
      capabilityBuilt: primaryDomain,
      requiredOutput: track ? `One reusable output that strengthens ${track.name}.` : "",
      note: `Support ${track?.name || "this lane"} while pursuing ${j.title}${j.company ? ` @ ${j.company}` : ""}.`,
      relatedTrackId: trackId,
      proofIntent: true,
      learnStatus: "open",
    };
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
  }

  function openRoleSource() {
    if (j.url) window.open(j.url, "_blank", "noopener,noreferrer");
  }

  // The ONE primary action for this card, by state. Calm surface = one clear move.
  const primary = (() => {
    if (gated || windowClosed) return null;
    if (j.status === "wishlist") return {
      label: "Mark applied", icon: CheckCircle2,
      run: async () => { await mutateAndInvalidate("POST", `/api/jobs/${j.id}/mark-submitted`, {}, ["/api/jobs", "/api/strategy/diagnostics", "/api/strategy/front-door", ...GOAL_SPINE_QUERY_KEYS]); toast({ title: "Marked as applied.", description: "Moved to Applied — nice." }); },
    };
    return {
      label: "Log progress", icon: Trophy,
      run: async () => { await mutateAndInvalidate("POST", "/api/wins", { text: `Applied: ${j.title}${j.company ? " @ " + j.company : ""}`, kind: "source", winCategory: "job_progress" }, ["/api/wins", "/api/stats"]); toast({ title: "Logged as a win 🎉", description: "Application progress counts." }); },
    };
  })();
  const truthPrimary = (() => {
    if (gated || windowClosed || !truth) return null;
    if (truth.action === "warm") {
      return warmSupport.candidates[0]
        ? { label: "Warm this role", icon: Flame, run: async () => createOutreachTask(warmSupport.candidates[0]) }
        : { label: "Add warm contact", icon: Users, run: async () => openNetworkIntake() };
    }
    if (truth.action === "prove") {
      return supportItems[0]
        ? { label: "Strengthen fit", icon: Hammer, run: async () => createSupportTask(supportItems[0]) }
        : { label: "Add capability support", icon: GraduationCap, run: async () => openLearnIntake() };
    }
    if (truth.action === "clarify") {
      return j.url
        ? { label: "Clarify role", icon: ExternalLink, run: async () => openRoleSource() }
        : { label: "Clarify role", icon: Compass, run: createJobNextTask };
    }
    if (truth.action === "prepare") return { label: "Create prep task", icon: FileText, run: createJobNextTask };
    if (truth.action === "follow_up") return { label: "Create follow-up task", icon: MessageSquare, run: createJobNextTask };
    if (truth.action === "apply") return { label: "Create application task", icon: CheckCircle2, run: createJobNextTask };
    return null;
  })();
  const effectivePrimary = truthPrimary || (truth ? null : primary);

  return (
    <div className={`group rounded-lg border bg-card p-3 ${gated || windowClosed ? "border-card-border opacity-70" : "border-card-border"}`} data-testid={`job-${j.id}`}>
      {/* ── HEADER: what it is (title · org · deadline · track) ── */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm leading-snug">{j.title}</h3>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-job-${j.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {(j.company || j.location) && <p className="text-xs text-muted-foreground mt-0.5">{[j.company, j.location].filter(Boolean).join(" · ")}</p>}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {j.deadline && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${deadlineTone(j.deadline)}`}><CalendarDays className="w-2.5 h-2.5" />{formatDeadline(j.deadline)}</span>}
        {gated && <ConstraintBadge text={`eligibility: ${j.eligibilityRisk}`} tone="warn" />}
        {windowClosed && !gated && <ConstraintBadge text="window closed" />}
      </div>

      {/* ── GATED / CLOSED: quiet dead-end, no work surface ── */}
      {gated ? (
        <p className="text-xs text-muted-foreground mt-2">Probably skip — {j.note || "a stretch versus your background"}. Kept for reference.</p>
      ) : windowClosed ? (
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">Watching for the next cycle.</p>
          {j.url && <a href={j.url} target="_blank" rel="noopener noreferrer" data-testid={`link-job-${j.id}`} className="text-muted-foreground hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      ) : (
        <>
          {/* ── ONE primary action + open link + expand toggle ── */}
          <div className="flex items-center justify-between mt-2.5 gap-2">
            <div className="flex items-center gap-2">
              {effectivePrimary && (
                <button
                  data-testid={`button-primary-job-${j.id}`}
                  onClick={async () => {
                    if (primaryBusy) return;
                    setPrimaryBusy(true);
                    try { await effectivePrimary.run(); } finally { setPrimaryBusy(false); }
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary-foreground bg-primary rounded-md px-2 py-1 hover-elevate"
                >
                  {primaryBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <effectivePrimary.icon className="w-3.5 h-3.5" />} {effectivePrimary.label}
                </button>
              )}
              {j.url && <a href={j.url} target="_blank" rel="noopener noreferrer" data-testid={`link-job-${j.id}`} className="text-muted-foreground hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>}
            </div>
            <button onClick={() => setOpen((o) => !o)} data-testid={`button-expand-job-${j.id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {open ? "Less" : "Open"} <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
          </div>

          {truth && !open && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap" data-testid={`job-truth-${j.id}`}>
              <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                {truth.actionLabel}
              </span>
              <p className="text-xs text-muted-foreground leading-snug line-clamp-1">{truth.headline}</p>
            </div>
          )}
          {!open && <ApplicationReadinessBar j={j} expanded={false} />}
          {truth && open && (
            <div className="mt-2 rounded-md border border-card-border bg-muted/35 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="inline-flex rounded-full bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {truth.actionLabel}
                </span>
                {truth.reasons.slice(0, 2).map((reason) => (
                  <span key={reason} className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {reason}
                  </span>
                ))}
              </div>
              <p className="text-xs text-foreground leading-snug">{truth.headline}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{truth.nextMove}</p>
            </div>
          )}

          {/* ── EXPANDED: the work surface (steps, warm path, stage move, tasks) ── */}
          {open && (
            <div className="mt-3 pt-3 border-t border-card-border space-y-3">
              <ApplicationReadinessBar j={j} expanded={true} />
              {j.note && <p className="text-xs text-muted-foreground leading-snug">{j.note}</p>}
              <div className="flex items-center gap-1">
                {idx > 0 && <button onClick={() => onMove(j, -1)} data-testid={`button-job-back-${j.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">← back</button>}
                {idx < JOB_COLS.length - 1 && <button onClick={() => onMove(j, 1)} data-testid={`button-job-fwd-${j.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">Move to {JOB_COLS[idx + 1].label} →</button>}
              </div>
              <JobStepRail j={j} />
              <JobWarmPath j={j} trackId={trackId} contacts={contacts} />
              <JobCapabilitySupport j={j} trackId={trackId} tracks={tracks} learns={learns} />
              <CardActions entity="jobs" id={j.id} trackId={trackId} tracks={tracks}
                onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : "Use 'Create next task' to make one." })} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// P4.2 — the key cross-module tie. When a live job has a WEAK warm path
// (warmPathScore low/empty OR no contact linked to its track), surface a
// lightweight inline prompt with candidate contacts in the matching warm
// lane(s) for that track, each with one-click "Create outreach task" (the
// shared createNextTask, sourceType "contact"). Warmth shown where a job
// needs it — not an isolated CRM.
const LOW_WARM_PATH = 40;
function JobWarmPath({ j, trackId, contacts }: { j: Job; trackId: number | null; contacts: Contact[] }) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  // Only meaningful for a live role.
  if (j.status === "closed") return null;

  const trackContacts = trackId != null ? contacts.filter((c) => getTrackId("contacts", c) === trackId) : [];
  const warmTrackContacts = trackContacts.filter((c) => c.status === "messaged" || c.status === "replied" || getRelationshipStrength(c) !== "cold");
  const weak = ((j.warmPathScore ?? 0) < LOW_WARM_PATH) || warmTrackContacts.length === 0;
  if (!weak) return null;

  // Candidate contacts: those already on this track, else any non-cold contact
  // (sorted by warmest lane relevance is overkill — keep it lightweight).
  const pool = trackContacts.length > 0 ? trackContacts : contacts;
  const candidates = pool
    .filter((c) => c.status !== "replied")
    .slice(0, 3);

  async function outreach(c: Contact) {
    setBusyId(c.id);
    try {
      const r = await mutateAndInvalidate("POST", `/api/contacts/${c.id}/create-next-task`, {}, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : "Outreach task created.", description: r?.reused ? "There's already an open task for this contact." : "Find it in Brain dump, or in Today if it gets planned." });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusyId(null); }
  }

  function openNetworkIntake() {
    const draft = {
      sector: j.company || "",
      targetOrg: j.company || "",
      targetRole: j.title || "",
      why: `Could help warm a path into ${j.title}${j.company ? ` at ${j.company}` : ""}.`,
      relatedTrackId: trackId,
      askType: "advice",
      relationshipStrength: "cold",
      status: "to_contact",
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-card-border rounded-md bg-amber-50/40 dark:bg-amber-950/10 -mx-1 px-2 pb-2" data-testid={`warmpath-${j.id}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5">
        <Flame className="w-3.5 h-3.5" /> No contacts linked
      </div>
      {candidates.length === 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">No contacts linked to this role yet — add someone in Network.</p>
          <button
            type="button"
            onClick={openNetworkIntake}
            className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1"
            data-testid={`button-open-network-from-job-${j.id}`}
          >
            <Users className="w-3.5 h-3.5" /> Add contact for this role
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{trackContacts.length > 0 ? "Someone who could help here:" : "Someone who could open a path:"}</p>
          {candidates.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2" data-testid={`warmpath-candidate-${j.id}-${c.id}`}>
              <span className="text-xs min-w-0 truncate">{c.who || c.name || "contact"}</span>
              <button onClick={() => outreach(c)} disabled={busyId === c.id} data-testid={`button-warmpath-outreach-${j.id}-${c.id}`} className="shrink-0 text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-0.5 disabled:opacity-60">
                {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Outreach task
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobCapabilitySupport({
  j,
  trackId,
  tracks,
  learns,
}: {
  j: Job;
  trackId: number | null;
  tracks: CareerTrack[];
  learns: Learn[];
}) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  if (j.status === "closed" || trackId == null) return null;

  const track = tracks.find((t) => t.id === trackId) || null;
  const requiredDomains = track ? requiredDomainsForTrack(track) : [];
  const supportItems = learns
    .filter((l) => !l.done && getTrackId("learn", l) === trackId)
    .sort((a, b) => {
      const score = (l: Learn) => {
        let total = 0;
        if (l.active) total += 4;
        const outputState = getLearnOutputState(l);
        if (outputState === "producing") total += 3;
        if (outputState === "evidenced") total += 2;
        if (getLearnStatus(l) === "active" || getLearnStatus(l) === "enrolled") total += 2;
        return total;
      };
      return score(b) - score(a) || b.id - a.id;
    })
    .slice(0, 3);

  async function createSupportTask(l: Learn) {
    setBusyId(l.id);
    try {
      const endpoint = getLearnOutputState(l) === "reference" ? `/api/learn/${l.id}/create-next-task` : `/api/learn/${l.id}/create-output-task`;
      const r = await mutateAndInvalidate("POST", endpoint, {}, ["/api/tasks", "/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      toast({
        title: r?.reused ? "Already on your list." : "Support task created.",
        description: r?.reused ? "There's already an open task for this learning item." : "Find it in Brain dump, or in Today if it gets planned.",
      });
    } catch {
      toast({ title: "Couldn't create the support task", description: "Try again in a moment." });
    } finally {
      setBusyId(null);
    }
  }

  function openLearnIntake() {
    const primaryDomain = requiredDomains.length > 0 ? domainLabel(requiredDomains[0]) : "";
    const draft = {
      title: primaryDomain ? `${primaryDomain} capability support` : `${track?.name || j.title} capability support`,
      category: primaryDomain,
      capabilityBuilt: primaryDomain,
      requiredOutput: track ? `One reusable output that strengthens ${track.name}.` : "",
      note: `Support ${track?.name || "this lane"} while pursuing ${j.title}${j.company ? ` @ ${j.company}` : ""}.`,
      relatedTrackId: trackId,
      proofIntent: true,
      learnStatus: "open",
    };
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-card-border rounded-md bg-slate-50/70 dark:bg-slate-900/20 -mx-1 px-2 pb-2" data-testid={`capability-support-${j.id}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-1.5">
        <Hammer className="w-3.5 h-3.5" /> Capability support
      </div>
      {supportItems.length === 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            No learning support is linked to this track yet. Add one in Learn so this role has a capability ramp, not just an application task list.
          </p>
          {requiredDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {requiredDomains.map((key) => (
                <span key={key} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {domainLabel(key)}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={openLearnIntake}
            className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1"
            data-testid={`button-open-learn-from-job-${j.id}`}
          >
            <GraduationCap className="w-3.5 h-3.5" /> Add capability support
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {supportItems.map((l) => {
            const outputState = getLearnOutputState(l);
            const meta = LEARN_OUTPUT_META[outputState];
            const status = getLearnStatus(l);
            return (
              <div key={l.id} className="rounded-lg border border-card-border bg-card px-3 py-2" data-testid={`job-support-learn-${j.id}-${l.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-snug">{l.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {l.capabilityBuilt && <span className="text-[10px] rounded-md bg-accent text-accent-foreground px-1.5 py-0.5">{l.capabilityBuilt}</span>}
                      <span className="text-[10px] rounded-md bg-muted text-muted-foreground px-1.5 py-0.5">{LEARN_STATUS_LABEL[status]}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                        <meta.icon className="w-2.5 h-2.5" /> {meta.label}
                      </span>
                    </div>
                    {l.requiredOutput && <p className="text-[11px] text-muted-foreground mt-1">Output: {l.requiredOutput}</p>}
                  </div>
                  {outputState !== "evidenced" && (
                    <button
                      type="button"
                      onClick={() => createSupportTask(l)}
                      disabled={busyId === l.id}
                      className="shrink-0 text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60"
                      data-testid={`button-job-support-task-${j.id}-${l.id}`}
                    >
                      {busyId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      {outputState === "reference" ? "Create next task" : "Create output task"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- NETWORK (P4.2: a WARMTH view over warm lanes) ----------------
   Not a contact archive. Contacts are grouped into warm lanes (a presentation
   layer over the free-text sourceNetwork) and each card leads with the ASK and
   the person's TYPE; the name is user-filled and visually secondary. The warmth
   signals — overdue follow-up (amber pulse) and replied (slate-green tint) —
   stay prominent. Every card's primary verb is "Create next task" (outreach via
   the shared createNextTask machinery, sourceType "contact"). */
const OUTREACH_COLS = [
  { id: "to_contact", label: "To reach" },
  { id: "messaged", label: "Messaged" },
  { id: "replied", label: "Replied" },
] as const;
const ASK_LABEL: Record<string, string> = {
  soft: "soft intro", referral: "referral", advice: "advice",
  reconnect: "reconnect", follow_up: "follow-up",
};
const ASK_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "soft", label: "Soft intro" },
  { value: "advice", label: "Advice" },
  { value: "referral", label: "Referral" },
  { value: "reconnect", label: "Reconnect" },
  { value: "follow_up", label: "Follow-up" },
];
const RELATIONSHIP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "strong", label: "Strong" },
];
const STRENGTH_TONE: Record<string, string> = {
  strong: "bg-primary/15 text-primary",
  warm: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  cold: "bg-muted text-muted-foreground",
};
type ContactFormT = {
  name: string;
  who: string;
  sector: string;
  why: string;
  sourceNetwork: string;
  targetOrg: string;
  targetRole: string;
  askType: string;
  relationshipStrength: string;
  nextFollowUpDate: string;
  relatedTrackId: number | null;
  status: string;
  messageDraft: string;
};
const EMPTY_CONTACT_FORM: ContactFormT = {
  name: "",
  who: "",
  sector: "",
  why: "",
  sourceNetwork: "",
  targetOrg: "",
  targetRole: "",
  askType: "soft",
  relationshipStrength: "cold",
  nextFollowUpDate: "",
  relatedTrackId: null,
  status: "to_contact",
  messageDraft: "",
};
// Overdue when a follow-up date is set and in the past.
function isFollowUpOverdue(c: Contact): boolean {
  const d = daysUntil(c.nextFollowUpDate || "");
  return d !== null && d < 0;
}

function NetworkView() {
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { toast } = useToast();
  const activeGoal = goalState?.goals?.[0] || null;
  const [sug, setSug] = useState<{ who: string; sector: string; why: string } | null>(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContactFormT>(EMPTY_CONTACT_FORM);
  const [selectedLane, setSelectedLane] = useState("");
  const selectedLaneGuide = selectedLane ? laneGuideForCombination(selectedLane) : null;

  useEffect(() => {
    const pending = takeHashDraft<ContactFormT>("contactDraft") || takeIntakeDraft<ContactFormT>(PENDING_CONTACT_DRAFT_KEY);
    if (pending) {
      setForm({ ...EMPTY_CONTACT_FORM, ...pending });
      setShowForm(true);
    }
  }, []);

  async function fetchSug(exclude: string[]) {
    setSugLoading(true);
    try { const r = await mutateAndInvalidate("POST", "/api/networking/suggest", { exclude }, []); setSug(r?.suggestion || null); }
    catch { setSug(null); }
    finally { setSugLoading(false); }
  }
  useEffect(() => { fetchSug([]); /* eslint-disable-next-line */ }, []);
  const [showMoreContactFields, setShowMoreContactFields] = useState(false);
  function resetForm() {
    setForm(EMPTY_CONTACT_FORM);
    setSelectedLane("");
    setShowForm(false);
    setShowMoreContactFields(false);
  }
  function startBlankContact() {
    setForm(EMPTY_CONTACT_FORM);
    setSelectedLane("");
    setShowForm(true);
  }
  function startLaneContact(item: GoalPortfolioItemT) {
    const preset = contactPresetForLane(item, tracks);
    setForm({ ...EMPTY_CONTACT_FORM, ...preset });
    setSelectedLane(item.combination);
    setShowForm(true);
  }
  function startSuggestedContact() {
    if (!sug) return;
    setForm({
      ...EMPTY_CONTACT_FORM,
      who: sug.who,
      sector: sug.sector,
      why: sug.why,
      askType: "advice",
      relationshipStrength: "cold",
      status: "to_contact",
    });
    setShowForm(true);
  }
  function another() { if (!sug) return; const next = [...seen, sug.who]; setSeen(next); fetchSug(next); }
  async function addContact() {
    if (!form.who.trim()) return;
    await mutateAndInvalidate("POST", "/api/contacts", form, ["/api/contacts", ...GOAL_SPINE_QUERY_KEYS]);
    toast({ title: "Added to your network.", description: "This contact now carries a real ask and lane context." });
    if (sug && form.who === sug.who) {
      const next = [...seen, sug.who];
      setSeen(next);
      fetchSug(next);
    }
    resetForm();
  }
  async function patch(c: Contact, body: Record<string, unknown>) {
    await mutateAndInvalidate("PATCH", `/api/contacts/${c.id}`, body, ["/api/contacts", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/contacts/${id}`, undefined, ["/api/contacts", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]); }

  // Group contacts into warm lanes via the tolerant normalizer.
  const byLane = new Map<string, Contact[]>(ALL_LANE_KEYS.map((k) => [k, []]));
  for (const c of contacts) byLane.get(laneForSourceNetwork(c.sourceNetwork))!.push(c);
  const populatedLaneKeys = ALL_LANE_KEYS.filter((k) => byLane.get(k)!.length > 0);
  const quietLaneKeys = NETWORK_LANES
    .map((lane) => lane.key)
    .filter((key) => byLane.get(key)!.length === 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Network" sub="People who could help. Each card leads with the ask." />
        <Button onClick={() => showForm ? setShowForm(false) : startBlankContact()} className="shrink-0" data-testid="button-toggle-contact-form"><Plus className="w-4 h-4 mr-1" /> Add contact</Button>
      </div>
      {activeGoal && !(contacts.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="network" goal={activeGoal} />}
      {activeGoal && contacts.length === 0 && <BroadPursuitParallelSupportKickoff goal={activeGoal} mode="network" onStartLane={startLaneContact} />}

      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 space-y-3" data-testid="contact-intake-form">
          {selectedLane && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2" data-testid="contact-form-lane-banner">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Role type</p>
                <p className="text-sm font-medium">{selectedLane}</p>
                {selectedLaneGuide && <p className="text-xs text-muted-foreground mt-0.5">{selectedLaneGuide.fitHint}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedLane(""); setForm((c) => ({ ...c, sector: "", why: "", targetRole: "", relatedTrackId: null })); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0" data-testid="button-clear-contact-lane">Clear</button>
            </div>
          )}
          {/* Minimal fields — capture quickly */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Who they are (role / title) *" value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} data-testid="input-contact-who" autoFocus className="sm:col-span-2" />
            <Input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-contact-name-new" />
            <Input placeholder="Org / company" value={form.targetOrg} onChange={(e) => setForm({ ...form, targetOrg: e.target.value })} data-testid="input-contact-target-org" />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Ask</p>
              <div className="flex flex-wrap gap-1.5">
                {ASK_TYPE_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setForm({ ...form, askType: option.value })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.askType === option.value ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                    data-testid={`button-contact-ask-${option.value}`}>{option.label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Warmth</p>
              <div className="flex flex-wrap gap-1.5">
                {RELATIONSHIP_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setForm({ ...form, relationshipStrength: option.value })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relationshipStrength === option.value ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                    data-testid={`button-contact-strength-${option.value}`}>{option.label}</button>
                ))}
              </div>
            </div>
          </div>
          {/* Progressive disclosure */}
          <button type="button" onClick={() => setShowMoreContactFields((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreContactFields ? "rotate-180" : ""}`} />
            {showMoreContactFields ? "Fewer options" : "More options (track, follow-up, notes)"}
          </button>
          {showMoreContactFields && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Target role" value={form.targetRole} onChange={(e) => setForm({ ...form, targetRole: e.target.value })} data-testid="input-contact-target-role" />
              <Input placeholder="Follow up date (YYYY-MM-DD)" value={form.nextFollowUpDate} onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })} data-testid="input-contact-follow-up" />
              <Input placeholder="Why this person matters" value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} className="sm:col-span-2" data-testid="input-contact-why" />
              <Input placeholder="Network source / sector" value={form.sourceNetwork} onChange={(e) => setForm({ ...form, sourceNetwork: e.target.value })} className="sm:col-span-2" data-testid="input-contact-source-network" />
              {tracks.length > 0 && (
                <div className="sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Link to path</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tracks.map((track) => (
                      <button key={track.id} type="button" onClick={() => setForm({ ...form, relatedTrackId: form.relatedTrackId === track.id ? null : track.id })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}
                        data-testid={`button-contact-track-${track.id}`}>{track.name}</button>
                    ))}
                  </div>
                </div>
              )}
              <Input placeholder="Message draft" value={form.messageDraft} onChange={(e) => setForm({ ...form, messageDraft: e.target.value })} className="sm:col-span-2" data-testid="input-contact-message-draft" />
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            <Button onClick={addContact} data-testid="button-save-contact">Save contact</Button>
          </div>
        </div>
      )}

      {/* One networking suggestion: who to reach next */}
      {(sugLoading || sug) && (
        <div className="mb-6 rounded-xl border border-slate-300/60 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/40 p-4" data-testid="network-suggestion">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-2">
            <Lightbulb className="w-4 h-4" /> Who to reach next
          </div>
          {sugLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Finding who could help…</div>
          ) : sug ? (
            <div>
              <p className="text-sm font-medium leading-snug">{sug.who}{sug.sector && <span className="ml-2 inline-flex items-center rounded-full bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{sug.sector}</span>}</p>
              {sug.why && <p className="text-xs text-muted-foreground mt-0.5">{sug.why}</p>}
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={startSuggestedContact} data-testid="button-network-add"><Plus className="w-4 h-4 mr-1" /> Shape contact</Button>
                <button onClick={another} data-testid="button-network-another" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> someone else</button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {isLoading ? <Loading /> : contacts.length === 0 ? (
        <Empty icon={Users} text="No contacts yet. Add one real contact path now." />
      ) : (
        <div className="space-y-6">
          {/* Overdue follow-ups — surface these first so nothing slips */}
          {(() => {
            const overdueContacts = contacts.filter(isFollowUpOverdue);
            if (overdueContacts.length === 0) return null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Overdue follow-ups</span>
                  <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-medium px-1.5 py-0.5">{overdueContacts.length}</span>
                </div>
                <div className="space-y-2">
                  {overdueContacts.map((c) => <ContactCard key={c.id} c={c} tracks={tracks} tasks={tasks} onPatch={patch} onRemove={() => remove(c.id)} />)}
                </div>
              </div>
            );
          })()}
          {populatedLaneKeys.map((key) => {
            const items = byLane.get(key)!;
            const nonOverdue = items.filter((c) => !isFollowUpOverdue(c));
            if (nonOverdue.length === 0) return null;
            return (
              <div key={key} data-testid={`lane-${key}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{laneLabel(key)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">({nonOverdue.length})</span>
                </div>
                <div className="space-y-2">
                  {nonOverdue.map((c) => <ContactCard key={c.id} c={c} tracks={tracks} tasks={tasks} onPatch={patch} onRemove={() => remove(c.id)} />)}
                </div>
              </div>
            );
          })}
          {quietLaneKeys.length > 0 && (
            <div className="rounded-xl border border-dashed border-border p-4" data-testid="quiet-network-lanes">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Routes to warm later</p>
              <div className="flex flex-wrap gap-2">
                {quietLaneKeys.map((key) => (
                  <span key={key} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
                    {laneLabel(key)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactCard({ c, tracks, tasks, onPatch, onRemove }: { c: Contact; tracks: CareerTrack[]; tasks: Task[]; onPatch: (c: Contact, body: Record<string, unknown>) => Promise<void>; onRemove: () => void }) {
  const { toast } = useToast();
  const [name, setNameLocal] = useState(c.name || "");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState(c.messageDraft || "");
  const [savingDraft, setSavingDraft] = useState(false);
  const idx = OUTREACH_COLS.findIndex((s) => s.id === c.status);
  const trackId = getTrackId("contacts", c);
  const linked = useLinkedTaskCount(tasks, "contact", c.id);
  const overdue = isFollowUpOverdue(c);
  const replied = c.status === "replied";
  const strength = getRelationshipStrength(c);

  async function saveDraft() {
    setSavingDraft(true);
    try { await onPatch(c, { messageDraft: draft }); toast({ title: "Draft saved.", description: "It's on this contact, ready to send." }); setDraftOpen(false); }
    finally { setSavingDraft(false); }
  }

  const tone = replied
    ? "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/30"
    : overdue
      ? "border-amber-400/70 bg-amber-50/50 dark:border-amber-700/60 dark:bg-amber-950/20 animate-pulse"
      : "border-card-border bg-card";

  return (
    <div className={`group rounded-lg border p-3 ${tone}`} data-testid={`contact-${c.id}`}>
      <div className="flex items-start justify-between gap-2">
        {/* ASK-FIRST: the ask leads, then the type descriptor (primary). */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {c.askType
              ? <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 text-slate-100 px-1.5 py-0.5 text-[10px] font-medium" data-testid={`ask-${c.id}`}><Send className="w-2.5 h-2.5" /> {ASK_LABEL[c.askType] || c.askType}</span>
              : <ConstraintBadge text="set an ask" tone="warn" />}
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STRENGTH_TONE[strength]}`}>{strength}</span>
            {overdue && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-semibold" data-testid={`overdue-${c.id}`}><Clock className="w-2.5 h-2.5" /> overdue</span>}
          </div>
          <p className="text-sm font-medium leading-snug mt-1.5" data-testid={`contact-who-${c.id}`}>{c.who || "Someone worth reaching"}</p>
        </div>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-contact-${c.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>

      {/* Clarity strip: track + targets + timing */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {(c.targetOrg || c.targetRole) && <span className="inline-flex items-center text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{[c.targetRole, c.targetOrg].filter(Boolean).join(" · ")}</span>}
        {c.nextFollowUpDate && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${overdue ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}><CalendarDays className="w-2.5 h-2.5" /> {formatDeadline(c.nextFollowUpDate)}</span>}
      </div>

      {c.why && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{c.why}</p>}

      {/* Name — user-filled, visually SECONDARY (muted, below the type). Never auto-invented. */}
      <input
        value={name}
        onChange={(e) => setNameLocal(e.target.value)}
        onBlur={() => name !== c.name && onPatch(c, { name })}
        placeholder="Name (optional)"
        data-testid={`input-contact-name-${c.id}`}
        className="mt-1 w-full text-[11px] text-muted-foreground bg-transparent border-b border-input/60 pb-1 focus:outline-none focus:border-primary"
      />

      {/* Draft message inline editor — persists to messageDraft. */}
      {draftOpen && (
        <div className="mt-2" data-testid={`draft-editor-${c.id}`}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
            placeholder="Draft your outreach message…" data-testid={`textarea-draft-${c.id}`}
            className="w-full text-xs bg-background border border-input rounded-md p-2 focus:outline-none focus:border-primary" />
          <div className="flex items-center gap-2 mt-1.5">
            <Button size="sm" className="h-7 px-2 text-xs" onClick={saveDraft} disabled={savingDraft} data-testid={`button-save-draft-${c.id}`}>
              {savingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save draft"}
            </Button>
            <button onClick={() => { setDraft(c.messageDraft || ""); setDraftOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground">cancel</button>
          </div>
        </div>
      )}

      {/* Status progression */}
      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onPatch(c, { status: OUTREACH_COLS[idx - 1].id })} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate" data-testid={`button-contact-back-${c.id}`}>←</button>}
        {idx < OUTREACH_COLS.length - 1 && <button onClick={() => onPatch(c, { status: OUTREACH_COLS[idx + 1].id })} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate" data-testid={`button-contact-fwd-${c.id}`}>{OUTREACH_COLS[idx + 1].label} →</button>}
      </div>

      {/* Actions row: Create next task / Draft message / Link track / View linked tasks */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 pt-2 border-t border-card-border">
        <CreateNextContactTask c={c} />
        <button onClick={() => setDraftOpen((o) => !o)} data-testid={`button-draft-message-${c.id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <MessageSquare className="w-3.5 h-3.5" /> Message
        </button>
        <LinkTrackControl entity="contacts" id={c.id} trackId={trackId} tracks={tracks} />
        <button data-testid={`button-view-tasks-contacts-${c.id}`} onClick={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : "Use 'Create next task' to make one." })} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ListChecks className="w-3.5 h-3.5" /> Tasks
        </button>
      </div>
    </div>
  );
}

// "Create next task" for a contact — outreach task via the shared createNextTask
// machinery (sourceType "contact"), carrying provenance + dedupe. Standalone so
// the contact card's ask-first action row stays readable.
function CreateNextContactTask({ c }: { c: Contact }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/contacts/${c.id}/create-next-task`, {}, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : "Outreach task created.", description: r?.reused ? "There's already an open task for this contact." : "Find it in Brain dump, or in Today if it gets planned." });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  return (
    <button onClick={go} disabled={busy} data-testid={`button-create-next-contacts-${c.id}`} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create next task
    </button>
  );
}

/* ---------------- LEARN ---------------- */
// Group parked items by status prefix in the category ("· OPEN", "· WATCH") or "Resource".
// P4.4 — Learn is the PROOF-BUILDING view over the loop. Output state is DERIVED
// and CALM: "reference" is the silent, valid default; an item only joins the
// proof-building lane when the user opts in. Chips are slate (never amber) for
// reference/producing; evidenced is slate-green. No nag on consumption.
const LEARN_OUTPUT_META: Record<LearnOutputState, { label: string; cls: string; icon: typeof BookOpen }> = {
  reference: { label: "reference", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400", icon: BookOpen },
  producing: { label: "building proof", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200", icon: Hammer },
  evidenced: { label: "evidenced", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: BadgeCheck },
};
function parseIdList(raw: string): number[] {
  try { const a = JSON.parse(raw || "[]"); return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []; } catch { return []; }
}
const LEARN_STATUS_LABEL: Record<LearnStatus, string> = {
  open: "open", watch: "watch", active: "active", applied: "applied", enrolled: "enrolled", done: "done", closed: "closed",
};
type LearnFormT = {
  title: string;
  category: string;
  capabilityBuilt: string;
  requiredOutput: string;
  url: string;
  note: string;
  relatedTrackId: number | null;
  proofIntent: boolean;
  learnStatus: LearnStatus;
};
const EMPTY_LEARN_FORM: LearnFormT = {
  title: "",
  category: "",
  capabilityBuilt: "",
  requiredOutput: "",
  url: "",
  note: "",
  relatedTrackId: null,
  proofIntent: false,
  learnStatus: "open",
};

function LearnView() {
  const { data: items = [], isLoading } = useQuery<Learn[]>({ queryKey: ["/api/learn"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const activeGoal = goalState?.goals?.[0] || null;
  const [showForm, setShowForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showMoreLearnFields, setShowMoreLearnFields] = useState(false);
  const [form, setForm] = useState<LearnFormT>(EMPTY_LEARN_FORM);
  const [selectedLane, setSelectedLane] = useState("");
  const selectedLaneGuide = selectedLane ? laneGuideForCombination(selectedLane) : null;
  useEffect(() => {
    const pending = takeHashDraft<LearnFormT>("learnDraft") || takeIntakeDraft<LearnFormT>(PENDING_LEARN_DRAFT_KEY);
    if (pending) {
      setForm({ ...EMPTY_LEARN_FORM, ...pending });
      setShowForm(true);
    }
  }, []);
  const suggestedDomainKeys = Array.from(
    new Set(tracks.flatMap((track) => requiredDomainsForTrack(track)).filter((key) => !!key)),
  ) as string[];
  function startLaneLearn(item: GoalPortfolioItemT) {
    const preset = learnPresetForLane(item, tracks);
    setForm({ ...EMPTY_LEARN_FORM, ...preset });
    setSelectedLane(item.combination);
    setShowForm(true);
  }
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/learn", { ...form, done: false, active: false }, ["/api/learn", ...GOAL_SPINE_QUERY_KEYS]);
    setForm(EMPTY_LEARN_FORM); setSelectedLane(""); setShowForm(false); setShowMoreLearnFields(false);
  }
  async function toggle(l: Learn) { await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { done: !l.done }, ["/api/learn", ...GOAL_SPINE_QUERY_KEYS]); }
  async function toggleActive(l: Learn) { await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { active: !l.active }, ["/api/learn", ...GOAL_SPINE_QUERY_KEYS]); }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/learn/${id}`, undefined, ["/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]); }

  // MECE guard: a fellowship is an OPPORTUNITY YOU APPLY TO (it lives in the
  // Fellowships lane of Jobs, not here). The startup migration moves these out of
  // learn, but guard the view too so a not-yet-migrated row never shows the
  // consume/proof workflow. Conservative: never hides a real course/book/podcast.
  const consumeItems = items.filter((l) => !isFellowshipLearnRow(l));
  const live = consumeItems.filter((l) => !l.done);
  const done = consumeItems.filter((l) => l.done);

  // OPTIONAL capability grouping: matched items group under fixed system domains
  // (display order from CAPABILITY_DOMAIN_KEYS); everything that doesn't match a
  // domain lands in a FLAT list — never a forced "Other" bucket. No pressure.
  const byDomain = new Map<string, Learn[]>(CAPABILITY_DOMAIN_KEYS.map((k) => [k, []]));
  const flat: Learn[] = [];
  for (const l of live) {
    const key = domainForLearn(l.category, l.capabilityBuilt);
    if (key && byDomain.has(key)) byDomain.get(key)!.push(l);
    else flat.push(l);
  }
  const activeDomainKeys = CAPABILITY_DOMAIN_KEYS.filter((k) => byDomain.get(k)!.length > 0);

  function CardList({ list }: { list: Learn[] }) {
    return <div className="space-y-2">{list.map((l) => <LearnCard key={l.id} l={l} tracks={tracks} tasks={tasks} onToggle={() => toggle(l)} onToggleActive={() => toggleActive(l)} onRemove={() => remove(l.id)} />)}</div>;
  }

  const activeNow = live.filter((l) => l.active);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Learn" sub="What you're building so future roles and interviews feel easier." />
        <Button onClick={() => showForm ? setShowForm(false) : setShowForm(true)} className="shrink-0" data-testid="button-toggle-learn-form"><Plus className="w-4 h-4 mr-1" /> Add</Button>
      </div>
      {activeGoal && !(live.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="learn" goal={activeGoal} />}
      {activeGoal && live.length === 0 && <BroadPursuitParallelSupportKickoff goal={activeGoal} mode="learn" onStartLane={startLaneLearn} />}
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 space-y-3">
          {selectedLane && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2" data-testid="learn-form-lane-banner">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Lane</p>
                <p className="text-sm font-medium">{selectedLane}</p>
                {selectedLaneGuide && <p className="text-xs text-muted-foreground mt-0.5">{selectedLaneGuide.fitHint}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedLane(""); setForm((c) => ({ ...c, title: "", category: "", capabilityBuilt: "", requiredOutput: "", note: "", relatedTrackId: null, proofIntent: false })); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0" data-testid="button-clear-learn-lane">Clear</button>
            </div>
          )}
          {/* Minimal: title + URL + optional domain tag */}
          <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-learn-title" autoFocus />
          <Input placeholder="Link (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} data-testid="input-learn-url" />
          {suggestedDomainKeys.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Capability domain (optional)</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedDomainKeys.map((key) => (
                  <button key={key} type="button" onClick={() => setForm({ ...form, category: domainLabel(key), capabilityBuilt: domainLabel(key) })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.category === domainLabel(key) ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-learn-domain-${key}`}>{domainLabel(key)}</button>
                ))}
              </div>
            </div>
          )}
          {/* Progressive disclosure */}
          <button type="button" onClick={() => setShowMoreLearnFields((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreLearnFields ? "rotate-180" : ""}`} />
            {showMoreLearnFields ? "Fewer options" : "More options (output, mode, track)"}
          </button>
          {showMoreLearnFields && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Capability this builds" value={form.capabilityBuilt} onChange={(e) => setForm({ ...form, capabilityBuilt: e.target.value })} data-testid="input-learn-capability-built" />
                <Input placeholder="Intended output" value={form.requiredOutput} onChange={(e) => setForm({ ...form, requiredOutput: e.target.value })} data-testid="input-learn-required-output" />
                <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sm:col-span-2" data-testid="input-learn-note" />
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Mode</p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setForm({ ...form, proofIntent: false })} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${!form.proofIntent ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`} data-testid="button-learn-mode-reference">Reference only</button>
                    <button type="button" onClick={() => setForm({ ...form, proofIntent: true })} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.proofIntent ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`} data-testid="button-learn-mode-output">Build output</button>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Status</p>
                  <div className="flex gap-1.5">
                    {(["open", "watch", "active"] as LearnStatus[]).map((status) => (
                      <button key={status} type="button" onClick={() => setForm({ ...form, learnStatus: status })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.learnStatus === status ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                        data-testid={`button-learn-status-${status}`}>{LEARN_STATUS_LABEL[status]}</button>
                    ))}
                  </div>
                </div>
              </div>
              {tracks.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Link to path</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tracks.map((track) => (
                      <button key={track.id} type="button" onClick={() => setForm({ ...form, relatedTrackId: form.relatedTrackId === track.id ? null : track.id })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}
                        data-testid={`button-learn-track-${track.id}`}>{track.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setSelectedLane(""); setForm(EMPTY_LEARN_FORM); setShowMoreLearnFields(false); }}>Cancel</Button>
            <Button onClick={add} data-testid="button-save-learn">Save</Button>
          </div>
        </div>
      )}
      {isLoading ? <Loading /> : items.length === 0 ? (
        <Empty icon={GraduationCap} text="No support items yet. Add one reusable capability move now." />
      ) : (
        <div className="space-y-6">
          {/* Active items always first */}
          {activeNow.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">Active now</span>
                <span className="text-xs text-muted-foreground tabular-nums">({activeNow.length})</span>
              </div>
              <CardList list={activeNow} />
            </div>
          )}
          {activeDomainKeys.map((key) => {
            const domainItems = byDomain.get(key)!.filter((l) => !l.active);
            if (domainItems.length === 0) return null;
            return (
              <div key={key} data-testid={`domain-${key}`}>
                <GroupLabel count={domainItems.length}><Layers className="w-4 h-4 text-slate-600 dark:text-slate-400" /> {domainLabel(key)}</GroupLabel>
                <CardList list={domainItems} />
              </div>
            );
          })}

          {flat.filter((l) => !l.active).length > 0 && (
            <div data-testid="domain-flat">
              <GroupLabel count={flat.filter((l) => !l.active).length}><GraduationCap className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Everything else</GroupLabel>
              <CardList list={flat.filter((l) => !l.active)} />
            </div>
          )}

          {done.length > 0 && (
            <div>
              <button onClick={() => setShowDone((s) => !s)} data-testid="button-toggle-learn-done" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5 hover:text-foreground">
                {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Done ({done.length})
              </button>
              {showDone && <CardList list={done} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LearnCard({ l, tracks, tasks, onToggle, onToggleActive, onRemove }: { l: Learn; tracks: CareerTrack[]; tasks: Task[]; onToggle: () => void; onToggleActive: () => void; onRemove: () => void }) {
  const { toast } = useToast();
  const trackId = getTrackId("learn", l);
  const linked = useLinkedTaskCount(tasks, "learn", l.id);
  const outputState = getLearnOutputState(l);
  const needsNudge = learnNeedsOutputNudge(l);
  const meta = LEARN_OUTPUT_META[outputState];
  const OutputIcon = meta.icon;
  const learnStatus = getLearnStatus(l);

  const [busy, setBusy] = useState(false);
  const [editingOutput, setEditingOutput] = useState(false);
  const [outputDraft, setOutputDraft] = useState(l.requiredOutput || "");
  const [evidencing, setEvidencing] = useState(false);
  const [evidenceDraft, setEvidenceDraft] = useState("");

  const prereqIds = parseIdList(l.prerequisites);
  const unlockIds = parseIdList(l.unlocks);

  async function saveOutput() {
    const v = outputDraft.trim();
    await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { requiredOutput: v }, ["/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    setEditingOutput(false);
    if (v) toast({ title: "Output set.", description: "This is now building toward proof. Produce it when you're ready — no rush." });
  }
  async function createOutputTask() {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/learn/${l.id}/create-output-task`, {}, ["/api/tasks", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : "Output task created.", description: r?.reused ? "There's already an open task for this." : "Find it in Brain dump, or in Today if it gets planned." });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function toggleProofIntent() {
    const next = !l.proofIntent;
    await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { proofIntent: next }, ["/api/learn", "/api/strategy/diagnostics", "/api/strategy/front-door", "/api/strategy/learning-gaps", ...GOAL_SPINE_QUERY_KEYS]);
    if (next) toast({ title: "Flagged as proof-building.", description: "This now sits in the building lane. Give it an output when you're ready — no rush." });
  }
  async function markEvidenced() {
    const v = evidenceDraft.trim();
    if (!v) return;
    setBusy(true);
    try {
      await mutateAndInvalidate("POST", `/api/learn/${l.id}/mark-evidenced`, { outputEvidenceUrl: v }, ["/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      setEvidencing(false); setEvidenceDraft("");
      toast({ title: "Marked as evidenced.", description: "The artifact is linked — this now counts as proof." });
    } catch { toast({ title: "Couldn't save the link", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }

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

          {/* Clarity strip: track chip + capability + learn status + DERIVED output state chip (slate, never amber for reference) */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <TrackChip trackId={trackId} tracks={tracks} />
            {l.capabilityBuilt && <span className="text-[10px] rounded-md bg-accent text-accent-foreground px-1.5 py-0.5">{l.capabilityBuilt}</span>}
            <span className="text-[10px] rounded-md bg-muted text-muted-foreground px-1.5 py-0.5">{LEARN_STATUS_LABEL[learnStatus]}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`} data-testid={`output-state-${l.id}`}>
              <OutputIcon className="w-2.5 h-2.5" /> {meta.label}
            </span>
          </div>

          {l.requiredOutput && <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-snug"><span className="font-medium">Output:</span> {l.requiredOutput}</p>}
          {l.note && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{l.note}</p>}

          {/* prerequisites / unlocks as lightweight chips (no graph viz) */}
          {(prereqIds.length > 0 || unlockIds.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {prereqIds.length > 0 && <span className="text-[10px] rounded-md bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> needs {prereqIds.length}</span>}
              {unlockIds.length > 0 && <span className="text-[10px] rounded-md bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 inline-flex items-center gap-1"><ArrowUpRight className="w-2.5 h-2.5" /> unlocks {unlockIds.length}</span>}
            </div>
          )}

          {/* SOFT, NON-AMBER reminder — ONLY for opted-in (track-linked) items with no output. Never on reference/consumption. */}
          {needsNudge && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-2 inline-flex items-center gap-1" data-testid={`learn-nudge-${l.id}`}>
              <Hammer className="w-3 h-3" /> Add an output to make this count as proof.
            </p>
          )}

          {/* CALM opt-in affordance for reference items: a quiet optional link only — NO warning. */}
          {outputState === "reference" && !l.done && (
            editingOutput ? (
              <div className="flex items-center gap-2 mt-2">
                <Input value={outputDraft} onChange={(e) => setOutputDraft(e.target.value)} placeholder="e.g. a published memo, a forecast, a sample" className="h-7 text-xs" data-testid={`input-output-${l.id}`} />
                <button onClick={saveOutput} data-testid={`button-save-output-${l.id}`} className="text-xs text-primary font-medium hover:underline">Save</button>
                <button onClick={() => { setEditingOutput(false); setOutputDraft(l.requiredOutput || ""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                <button onClick={() => setEditingOutput(true)} data-testid={`button-set-output-${l.id}`} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Set a required output
                </button>
                <button onClick={toggleProofIntent} data-testid={`button-proof-intent-${l.id}`} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <Hammer className="w-3 h-3" /> Mark as proof-building
                </button>
              </div>
            )
          )}

          {/* Evidenced: show the produced artifact link. */}
          {outputState === "evidenced" && l.outputEvidenceUrl && (
            <a href={l.outputEvidenceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-evidence-${l.id}`} className="text-xs text-emerald-700 dark:text-emerald-300 mt-2 inline-flex items-center gap-1 hover:underline">
              <BadgeCheck className="w-3 h-3" /> View the proof artifact <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <div className="flex items-center gap-3 mt-2">
            {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer" data-testid={`link-learn-${l.id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">Open <ExternalLink className="w-3 h-3" /></a>}
            <button onClick={onRemove} data-testid={`button-delete-learn-${l.id}`} className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Remove</button>
          </div>

          {/* Producing lane (opted in, not yet evidenced): invite to create the output task + mark evidenced inline. */}
          {outputState === "producing" && !l.done && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5">
              <button onClick={createOutputTask} disabled={busy} data-testid={`button-create-output-task-${l.id}`} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create output task
              </button>
              {evidencing ? (
                <span className="inline-flex items-center gap-2">
                  <Input value={evidenceDraft} onChange={(e) => setEvidenceDraft(e.target.value)} placeholder="link to the artifact" className="h-7 text-xs w-48" data-testid={`input-evidence-${l.id}`} />
                  <button onClick={markEvidenced} disabled={busy || !evidenceDraft.trim()} data-testid={`button-confirm-evidence-${l.id}`} className="text-xs text-primary font-medium hover:underline disabled:opacity-60">Save</button>
                  <button onClick={() => { setEvidencing(false); setEvidenceDraft(""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setEvidencing(true)} data-testid={`button-mark-evidenced-${l.id}`} className="text-xs text-slate-600 dark:text-slate-300 hover:text-foreground inline-flex items-center gap-1">
                  <BadgeCheck className="w-3.5 h-3.5" /> Mark evidenced
                </button>
              )}
              {/* Un-mark is offered ONLY when the producing lane was entered via proofIntent
                  (no requiredOutput) — un-marking then returns the item to the silent reference state. */}
              {l.proofIntent && !(l.requiredOutput && l.requiredOutput.trim()) && (
                <button onClick={toggleProofIntent} data-testid={`button-unmark-proof-intent-${l.id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  Back to reference
                </button>
              )}
            </div>
          )}

          <CardActions entity="learn" id={l.id} trackId={trackId} tracks={tracks}
            onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : "Use 'Create output task' to make one." })} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- PROOF ASSETS (P4.3) ---------------- */
// Proof Assets is a PROOF-PRODUCTION view: each asset's primary verb is "produce
// the next output" via a step that materializes a task. Career-proof systems,
// NOT side-income ventures — the DB table stays `hustles` internally. Stages
// (idea|testing|earning) still group the assets by how real each one is.
const HUSTLE_STAGES = [
  { id: "idea", label: "Idea", hint: "Not yet producing" },
  { id: "testing", label: "Producing", hint: "Output going out" },
  { id: "earning", label: "Established", hint: "Recognised proof" },
] as const;

const PROOF_KIND_ICON: Record<ProofAssetKind, typeof Sun> = {
  substack: Newspaper, afterline: Package, memo: FileText,
};

// Kind badge from the derived classifier — never a stored column.
function ProofKindBadge({ kind }: { kind: ProofAssetKind }) {
  const Icon = PROOF_KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-100" data-testid={`badge-kind-${kind}`}>
      <Icon className="w-2.5 h-2.5" /> {PROOF_ASSET_KIND_LABEL[kind]}
    </span>
  );
}

// The proof-production rail — mirrors JobStepRail (4.1) exactly: seed-when-empty,
// per-step materialize / mark-done / mark-blocked, edit (add/rename/delete/reorder).
// Hits the proof-step API (/api/hustles/:id/steps... and /api/proof-steps/:stepId...).
function ProofStepRail({ h }: { h: Hustle }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const stepsKey = ["/api/hustles", h.id, "steps"];
  const { data: steps = [], isLoading } = useQuery<ProofAssetStep[]>({
    queryKey: stepsKey,
    queryFn: async () => { const r = await apiRequest("GET", `/api/hustles/${h.id}/steps`); const d = await r.json(); return Array.isArray(d) ? d : []; },
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  async function reloadInto() { await qc.invalidateQueries({ queryKey: stepsKey }); }

  async function seed() {
    setBusy(true);
    try {
      await mutateAndInvalidate("POST", `/api/hustles/${h.id}/steps/seed`, {}, ["/api/strategy/diagnostics"]);
      await reloadInto();
      toast({ title: "Steps generated.", description: "From this asset's workflow — edit them to fit." });
    } catch { toast({ title: "Couldn't generate steps", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function materialize(s: ProofAssetStep) {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/proof-steps/${s.id}/materialize`, {}, ["/api/tasks", "/api/strategy/diagnostics"]);
      await reloadInto();
      toast({ title: r?.reused ? "Already on your list." : "Task created from this step.", description: r?.reused ? "There's already an open task for this asset." : "Find it in Brain dump, or in Today if it gets planned." });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function setStatus(s: ProofAssetStep, status: string) {
    await mutateAndInvalidate("PATCH", `/api/proof-steps/${s.id}`, { status }, ["/api/strategy/diagnostics"]);
    await reloadInto();
  }
  async function block(s: ProofAssetStep) {
    await mutateAndInvalidate("POST", `/api/proof-steps/${s.id}/block`, { reason: "Blocked from the rail" }, ["/api/tasks", "/api/strategy/diagnostics"]);
    await reloadInto();
    toast({ title: "Marked blocked.", description: "Noted on the step — unblock it when ready." });
  }
  async function rename(s: ProofAssetStep, stepLabel: string) {
    if (!stepLabel.trim() || stepLabel === s.stepLabel) return;
    await mutateAndInvalidate("PATCH", `/api/proof-steps/${s.id}`, { stepLabel: stepLabel.trim() }, []);
    await reloadInto();
  }
  async function del(s: ProofAssetStep) {
    await mutateAndInvalidate("DELETE", `/api/proof-steps/${s.id}`, undefined, ["/api/strategy/diagnostics"]);
    await reloadInto();
  }
  async function addStep() {
    if (!newLabel.trim()) return;
    await mutateAndInvalidate("POST", `/api/hustles/${h.id}/steps`, { stepLabel: newLabel.trim() }, ["/api/strategy/diagnostics"]);
    setNewLabel("");
    await reloadInto();
  }
  async function reorder(s: ProofAssetStep, dir: -1 | 1) {
    const ids = steps.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const ni = i + dir;
    if (ni < 0 || ni >= ids.length) return;
    [ids[i], ids[ni]] = [ids[ni], ids[i]];
    await mutateAndInvalidate("PATCH", `/api/hustles/${h.id}/steps/reorder`, { orderedStepIds: ids }, ["/api/strategy/diagnostics"]);
    await reloadInto();
  }

  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className="mt-2.5 pt-2.5 border-t border-card-border" data-testid={`proofrail-${h.id}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ListChecks className="w-3.5 h-3.5" /> Production rail
          {steps.length > 0 && <span className="tabular-nums opacity-70">{doneCount}/{steps.length}</span>}
        </div>
        {steps.length > 0 && (
          <button onClick={() => setEditing((e) => !e)} data-testid={`button-edit-proof-steps-${h.id}`} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <Pencil className="w-3 h-3" /> {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground/60 py-1">Loading steps…</p>
      ) : steps.length === 0 ? (
        <button onClick={seed} disabled={busy} data-testid={`button-seed-proof-steps-${h.id}`}
          className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Generate steps
        </button>
      ) : (
        <div className="space-y-1">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-start gap-2" data-testid={`proof-step-${s.id}`}>
              <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STEP_STATUS_TONE[s.status] || STEP_STATUS_TONE.todo}`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                {editing ? (
                  <input defaultValue={s.stepLabel} onBlur={(e) => rename(s, e.target.value)} data-testid={`input-proof-step-label-${s.id}`}
                    className="w-full text-xs bg-transparent border-b border-input pb-0.5 focus:outline-none focus:border-primary" />
                ) : (
                  <p className={`text-xs leading-snug ${s.status === "done" ? "line-through text-muted-foreground" : ""}`}>{s.stepLabel}</p>
                )}
                {s.status === "blocked" && <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 inline-flex items-center gap-1"><Ban className="w-2.5 h-2.5" /> blocked{s.note ? `: ${s.note}` : ""}</p>}
                {s.status === "skipped" && <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><X className="w-2.5 h-2.5" /> skipped{s.note ? `: ${s.note}` : ""}</p>}
                {s.taskId && !editing && <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><ListChecks className="w-2.5 h-2.5" /> task created</p>}
              </div>
              {editing ? (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => reorder(s, -1)} disabled={i === 0} data-testid={`button-proof-step-up-${s.id}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => reorder(s, 1)} disabled={i === steps.length - 1} data-testid={`button-proof-step-down-${s.id}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(s)} data-testid={`button-proof-step-delete-${s.id}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ) : (s.status === "done" || s.status === "skipped") ? (
                <button onClick={() => setStatus(s, "todo")} title="Reopen" data-testid={`button-proof-step-reopen-${s.id}`} className="shrink-0 text-muted-foreground hover:text-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => materialize(s)} disabled={busy} title="Create a task from this step" data-testid={`button-proof-step-materialize-${s.id}`} className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-0.5 disabled:opacity-60"><Plus className="w-3 h-3" /> Task</button>
                  <button onClick={() => setStatus(s, "done")} title="Mark done" data-testid={`button-proof-step-done-${s.id}`} className="text-muted-foreground hover:text-primary"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                  {s.status === "blocked"
                    ? <button onClick={() => setStatus(s, "todo")} title="Unblock" data-testid={`button-proof-step-unblock-${s.id}`} className="text-muted-foreground hover:text-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
                    : <button onClick={() => block(s)} title="Mark blocked" data-testid={`button-proof-step-block-${s.id}`} className="text-muted-foreground hover:text-amber-600"><Ban className="w-3.5 h-3.5" /></button>}
                </div>
              )}
            </div>
          ))}
          {editing && (
            <div className="flex items-center gap-1.5 pt-1">
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStep(); }}
                placeholder="Add a step…" className="h-7 text-xs" data-testid={`input-add-proof-step-${h.id}`} />
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={addStep} data-testid={`button-add-proof-step-${h.id}`}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A labelled field row used by the workflow-specific card bodies.
function ProofField({ label, value }: { label: string; value: string }) {
  if (!value || !value.trim()) return null;
  return (
    <p className="text-xs mt-1.5 leading-snug"><span className="text-muted-foreground">{label}:</span> {value}</p>
  );
}

function ProofAssetsView() {
  const { data: hustles = [], isLoading } = useQuery<Hustle[]>({ queryKey: ["/api/hustles"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", note: "", coreClaim: "", contentPillar: "" });
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/hustles", { ...form, stage: "idea" }, ["/api/hustles"]);
    setForm({ title: "", note: "", coreClaim: "", contentPillar: "" }); setShowForm(false);
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
        <SectionHeading title="Work samples" sub="What you're building — work that shows your thinking and capabilities." />
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0" data-testid="button-toggle-hustle-form"><Plus className="w-4 h-4 mr-1" /> Add work sample</Button>
      </div>
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2">
          <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-hustle-title" />
          <Input placeholder="Core claim / what it proves" value={form.coreClaim} onChange={(e) => setForm({ ...form, coreClaim: e.target.value })} data-testid="input-hustle-claim" />
          <Input placeholder="Content pillar (e.g. geopolitics)" value={form.contentPillar} onChange={(e) => setForm({ ...form, contentPillar: e.target.value })} data-testid="input-hustle-pillar" />
          <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="input-hustle-note" />
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={add} data-testid="button-save-hustle">Save</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : hustles.length === 0 ? (
        <Empty icon={Rocket} text="No work samples yet. Add a memo, article, or anything that shows your thinking." />
      ) : (
        <>
          <div className={`grid gap-4 ${active.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {active.map(({ stage, items }) => (
              <div key={stage.id} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="mb-2.5 px-1"><div className="flex items-center justify-between"><h2 className="font-semibold text-sm">{stage.label}</h2><span className="text-xs text-muted-foreground tabular-nums">{items.length}</span></div><p className="text-xs text-muted-foreground">{stage.hint}</p></div>
                <div className="space-y-2">{items.map((h) => <ProofAssetCard key={h.id} h={h} tracks={tracks} tasks={tasks} onMove={move} onRemove={() => remove(h.id)} />)}</div>
              </div>
            ))}
          </div>
          {empty.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Other stages: {empty.map((g) => g.stage.label).join(" · ")} — assets move here as they become real.</p>}
        </>
      )}
    </div>
  );
}

// Workflow-specific card body — each kind shows its own bespoke fields.
function ProofAssetBody({ h, kind }: { h: Hustle; kind: ProofAssetKind }) {
  if (kind === "substack") {
    return (
      <>
        <ProofField label="Pillar" value={h.contentPillar} />
        <ProofField label="Cadence" value={h.publishingCadence} />
        <ProofField label="First post" value={h.firstPostIdea} />
      </>
    );
  }
  if (kind === "afterline") {
    return (
      <>
        <ProofField label="Claim" value={h.coreClaim} />
        <ProofField label="Audience" value={h.audience} />
      </>
    );
  }
  return (
    <>
      <ProofField label="Claim" value={h.coreClaim} />
      {h.note && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{h.note}</p>}
    </>
  );
}

function ProofAssetCard({ h, tracks, tasks, onMove, onRemove }: { h: Hustle; tracks: CareerTrack[]; tasks: Task[]; onMove: (h: Hustle, d: 1 | -1) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const idx = HUSTLE_STAGES.findIndex((s) => s.id === h.stage);
  const trackId = getTrackId("hustles", h);
  const linked = useLinkedTaskCount(tasks, "hustle", h.id);
  const kind = classifyProofAsset(h);
  return (
    <div className="group rounded-lg border border-card-border bg-card p-3" data-testid={`hustle-${h.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm leading-snug">{h.title}</h3>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-hustle-${h.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {/* Clarity strip: kind badge (derived) + track chip + idea constraint */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <ProofKindBadge kind={kind} />
        <TrackChip trackId={trackId} tracks={tracks} />
        {h.stage === "idea" && <ConstraintBadge text="not yet producing" />}
      </div>
      <ProofAssetBody h={h} kind={kind} />
      {h.nextStep && <p className="text-xs mt-2 inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground px-1.5 py-0.5"><ArrowRight className="w-3 h-3" /> {h.nextStep}</p>}
      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onMove(h, -1)} data-testid={`button-hustle-back-${h.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">←</button>}
        {idx < HUSTLE_STAGES.length - 1 && <button onClick={() => onMove(h, 1)} data-testid={`button-hustle-fwd-${h.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">{HUSTLE_STAGES[idx + 1].label} →</button>}
      </div>
      <ProofStepRail h={h} />
      <CardActions entity="hustles" id={h.id} trackId={trackId} tracks={tracks}
        onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : "Use 'Create next task' to make one." })} />
    </div>
  );
}

/* ---------------- WINS ---------------- */
const WIN_CATEGORY_LABEL: Record<WinCategory, string> = {
  job_progress: "Job progress", learning: "Learning", network: "Network",
  proof_asset: "Work sample", mindset: "Mindset", admin: "Admin",
};
// P4.5 — in-palette (slate-blue) category swatch classes for the compact
// evidence summary. NO coral; each stays a calm tint of the slate/primary range.
const WIN_CATEGORY_SWATCH: Record<WinCategory, string> = {
  job_progress: "bg-primary/15 text-primary",
  learning: "bg-slate-200 text-slate-700",
  network: "bg-slate-100 text-slate-600",
  proof_asset: "bg-primary/10 text-primary",
  mindset: "bg-slate-100 text-slate-500",
  admin: "bg-muted text-muted-foreground",
};
type WinsSummary = {
  total: number; thisWeek: number; thisMonth: number;
  byCategory: Record<WinCategory, number>; byCategoryWeek: Record<WinCategory, number>;
  streakDays: number; trackByWinId: Record<number, number | "untracked">;
};
function WinsView() {
  const { data: wins = [], isLoading } = useQuery<Win[]>({ queryKey: ["/api/wins"] });
  const { data: stats } = useQuery<{ doneThisWeek: number }>({ queryKey: ["/api/stats"] });
  const { data: summary } = useQuery<WinsSummary>({ queryKey: ["/api/wins/summary"] });
  const { data: careerTracks = [] } = useCareerTracks();
  const trackNameById = new Map(careerTracks.map((t) => [t.id, t.name] as const));
  const [text, setText] = useState("");
  const [category, setCategory] = useState<WinCategory>("mindset");
  async function add() {
    if (!text.trim()) return;
    await mutateAndInvalidate("POST", "/api/wins", { text: text.trim(), winCategory: category }, ["/api/wins", "/api/stats", "/api/wins/summary"]);
    setText("");
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/wins/${id}`, undefined, ["/api/wins", "/api/stats", "/api/wins/summary"]); }
  function dayLabel(ts: number) { return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = wins.filter((w) => w.createdAt >= weekAgo);
  const earlier = wins.filter((w) => w.createdAt < weekAgo);

  function Row({ w }: { w: Win }) {
    const tid = summary?.trackByWinId[w.id];
    const trackName = tid && tid !== "untracked" ? trackNameById.get(tid) : undefined;
    return (
      <div className="group flex items-center gap-3 rounded-lg border border-card-border bg-card px-3.5 py-3" data-testid={`win-${w.id}`}>
        <Trophy className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 text-sm">{w.text}</span>
        {trackName && <span className="hidden md:inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid={`win-track-${w.id}`} title="Derived track">{trackName}</span>}
        {w.winCategory && <span className="hidden sm:inline-flex shrink-0 text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{WIN_CATEGORY_LABEL[w.winCategory as WinCategory] || w.winCategory}</span>}
        <span className="text-xs text-muted-foreground shrink-0">{dayLabel(w.createdAt)}</span>
        <button onClick={() => remove(w.id)} aria-label="Delete" data-testid={`button-delete-win-${w.id}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Wins" sub="Small wins count — log them so you don't forget the progress you made." />
        {stats && stats.doneThisWeek > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 rounded-full bg-accent text-accent-foreground px-3 py-1.5 text-sm font-medium" data-testid="text-wins-momentum">
            <Trophy className="w-4 h-4" /> {stats.doneThisWeek} this week
          </div>
        )}
      </div>

      {/* P4.5 — compact evidence summary: window counts + streak + by-category.
          Calm and in-palette (slate-blue), NOT a hero dashboard. */}
      {summary && summary.total > 0 && (
        <div className="mb-4 rounded-xl border border-card-border bg-card px-4 py-3" data-testid="wins-summary">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span data-testid="wins-week"><span className="font-semibold tabular-nums">{summary.thisWeek}</span> <span className="text-muted-foreground">this week</span></span>
            <span data-testid="wins-month"><span className="font-semibold tabular-nums">{summary.thisMonth}</span> <span className="text-muted-foreground">this month</span></span>
            {summary.streakDays > 0 && (
              <span className="inline-flex items-center gap-1 text-primary" data-testid="wins-streak">
                <Flame className="w-3.5 h-3.5" /> <span className="font-semibold tabular-nums">{summary.streakDays}</span>
                <span className="text-muted-foreground">day{summary.streakDays > 1 ? "s" : ""} in a row</span>
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="wins-by-category">
            {WIN_CATEGORIES.filter((c) => summary.byCategory[c] > 0).map((c) => (
              <span key={c} className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 font-medium ${WIN_CATEGORY_SWATCH[c]}`} data-testid={`wins-cat-${c}`}>
                {WIN_CATEGORY_LABEL[c]} <span className="tabular-nums opacity-80">{summary.byCategory[c]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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

function ProfileView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cvText, setCvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data: profile } = useQuery<{ cvText: string }>({
    queryKey: ["/api/profile"],
    queryFn: () => apiRequest("GET", "/api/profile").then((r) => r.json()),
  });

  useEffect(() => {
    if (profile?.cvText !== undefined && !dirty) setCvText(profile.cvText);
  }, [profile, dirty]);

  async function save() {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/profile", { cvText });
      await queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setDirty(false);
      toast({ title: "CV saved." });
    } catch {
      toast({ title: "Couldn't save", description: "Try again in a moment." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-0.5">Profile</h2>
        <p className="text-sm text-muted-foreground">Your CV is used to suggest specific bullet rewrites when you work on job applications.</p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">Your CV</p>
          <p className="text-xs text-muted-foreground mb-2">Paste plain text. The app uses this alongside the job description to suggest exact bullet rewrites — not generic advice.</p>
          <textarea
            value={cvText}
            onChange={(e) => { setCvText(e.target.value); setDirty(true); }}
            placeholder="Paste your CV here…"
            className="w-full min-h-[360px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y font-mono text-xs leading-relaxed"
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{cvText.length > 0 ? `${cvText.length} characters` : "Nothing saved yet"}</p>
          <Button onClick={save} disabled={saving || !dirty} size="sm">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save CV
          </Button>
        </div>
      </div>
    </div>
  );
}

