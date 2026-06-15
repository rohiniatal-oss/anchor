import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Compass,
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OnboardingRole = {
  archetype: string;
  priority: string;
  fitLogic: string;
  nextExperiment: string;
};

type DiscoveryRoute = {
  key: string;
  label: string;
  why: string;
};

type DiscoveryAction = {
  title: string;
  doneWhen: string;
  firstStep: string;
};

type DiscoveryRoutePreview = {
  tinyNextAction: DiscoveryAction;
  supportAction: DiscoveryAction | null;
};

type DiscoveryTrackDraft = {
  name: string;
  slug: string;
  whyItFits: string;
  targetRoleArchetype: string;
};

type DiscoveryResponse = {
  discoveryId: number;
  workingGoalDraft: {
    title: string;
    whyNow: string;
    desiredOutcome: string;
    timeHorizon: string;
    successCondition: string;
  };
  knowns: string[];
  unknowns: string[];
  routes: DiscoveryRoute[];
  recommendedRoute: {
    key: string;
    reason: string;
  };
  routePreviews: Record<string, DiscoveryRoutePreview | undefined>;
  tinyNextAction: DiscoveryAction;
  supportAction: DiscoveryAction | null;
  trackDrafts: DiscoveryTrackDraft[];
  needsUserAnswer: Array<{ key: string; question: string }>;
};

function priorityTone(priority: string) {
  if (priority === "convert") return "bg-emerald-50 text-emerald-700";
  if (priority === "watch") return "bg-amber-50 text-amber-700";
  if (priority === "pause") return "bg-slate-200 text-slate-700";
  return "bg-muted text-muted-foreground";
}

const ROUTE_DECISION_COPY: Record<string, string> = {
  "broad-role-pursuit": "Choose this if you need real market signal fast.",
  "fit-clarification": "Choose this if the role families still feel too muddy to apply usefully.",
  "warm-path-build": "Choose this if access, referrals, or insider context are the real bottleneck.",
  "capability-ramp": "Choose this if one clear readiness gap is holding you back.",
  "clarify-outcome": "Choose this if the goal is still too fuzzy to plan well.",
  "reduce-friction": "Choose this if one blocker is making everything harder than it should be.",
  "start-small-routine": "Choose this if consistency matters more than one big push.",
};

export default function OnboardingView() {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<OnboardingRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);
  const [concern, setConcern] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [discoveryCommitted, setDiscoveryCommitted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    apiRequest("GET", "/api/strategy-builder")
      .then((r) => r.json())
      .then((d) => setRoles((d.roleArchetypes || []).slice(0, 4)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function invalidateCoreQueries() {
    queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/goals/state"] });
    queryClient.invalidateQueries({ queryKey: ["/api/strategy/front-door"] });
    queryClient.invalidateQueries({ queryKey: ["/api/strategy/diagnostics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/plan/current"] });
  }

  async function acceptRole(role: OnboardingRole) {
    setAccepting(role.archetype);
    try {
      await apiRequest("POST", "/api/strategy-builder/accept-role", role);
      setAccepted((prev) => new Set([...prev, role.archetype]));
      invalidateCoreQueries();
    } catch {
      toast({ title: "Couldn't add that role type", description: "Try again in a moment." });
    } finally {
      setAccepting(null);
    }
  }

  async function runDiscovery() {
    if (!concern.trim()) return;
    setDiscovering(true);
    setDiscoveryCommitted(false);
    try {
      const res = await apiRequest("POST", "/api/discovery/start", {
        concern: concern.trim(),
        domain: "career",
      });
      const next = (await res.json()) as DiscoveryResponse;
      setDiscovery(next);
      setSelectedRouteKey(next.recommendedRoute.key);
      setDetailsOpen(false);
      setAnswers({});
    } catch {
      toast({
        title: "Couldn't shape a direction right now",
        description: "Try again in a moment.",
      });
    } finally {
      setDiscovering(false);
    }
  }

  async function commitDiscovery() {
    if (!discovery?.discoveryId || !selectedRouteKey) return;
    setCommitting(true);
    try {
      await apiRequest("POST", `/api/discovery/${discovery.discoveryId}/commit`, {
        routeKey: selectedRouteKey,
        answers,
      });
      setDiscoveryCommitted(true);
      invalidateCoreQueries();
    } catch {
      toast({
        title: "Couldn't turn that into a starting plan",
        description: "Try again in a moment.",
      });
    } finally {
      setCommitting(false);
    }
  }

  const selectedRoute =
    discovery?.routes.find((route) => route.key === selectedRouteKey) || null;
  const selectedRoutePreview =
    (selectedRouteKey && discovery?.routePreviews?.[selectedRouteKey]) || null;
  const selectedRouteReason = selectedRouteKey === discovery?.recommendedRoute.key
    ? discovery?.recommendedRoute.reason
    : selectedRoute?.why;

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Let's set up your strategy</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Anchor should help even when you do not know the exact role types yet. Start
        with a vague career concern, or pick role types directly if you already know
        what you want to test.
      </p>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Not sure which role types to choose?</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Describe the career problem in plain English. Anchor will turn it into a
              working direction, suggested role types, and the first tasks.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Textarea
            value={concern}
            onChange={(e) => setConcern(e.target.value)}
            placeholder="Example: I need a credible next role soon, but I am torn between AI strategy, geopolitics, and chief of staff paths."
            className="min-h-[104px] bg-background"
            data-testid="input-discovery-concern"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={runDiscovery}
              disabled={discovering || !concern.trim()}
              data-testid="button-run-discovery"
            >
              {discovering ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" />
              )}
              {discovering ? "Thinking..." : "Help me figure it out"}
            </Button>
            {discovery && (
              <button
                onClick={() => {
                  setDiscovery(null);
                  setSelectedRouteKey("");
                  setDetailsOpen(false);
                  setAnswers({});
                  setDiscoveryCommitted(false);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-reset-discovery"
              >
                clear
              </button>
            )}
          </div>
        </div>

        {discovery && (
          <div className="mt-5 space-y-4" data-testid="discovery-results">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Start with the route choice. Open more context only if you want it.
              </p>
              <button
                onClick={() => setDetailsOpen((open) => !open)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-toggle-discovery-details"
              >
                {detailsOpen ? "Hide detail" : "Show more detail"}
              </button>
            </div>

            <div className="rounded-xl border border-card-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Lightbulb className="w-3 h-3" /> Working direction
                </span>
                <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {discovery.workingGoalDraft.timeHorizon}
                </span>
              </div>
              <p className="text-sm font-semibold">{discovery.workingGoalDraft.title}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {discovery.workingGoalDraft.desiredOutcome}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">Why now:</span>{" "}
                {discovery.workingGoalDraft.whyNow}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">Good enough for now:</span>{" "}
                {discovery.workingGoalDraft.successCondition}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Pick a starting route
              </p>
              <div className="space-y-2">
                {discovery.routes.map((route) => {
                  const selected = route.key === selectedRouteKey;
                  const recommended = route.key === discovery.recommendedRoute.key;
                  const preview = discovery.routePreviews?.[route.key] || null;
                  return (
                    <button
                      key={route.key}
                      onClick={() => setSelectedRouteKey(route.key)}
                      data-testid={`button-route-${route.key}`}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-card-border bg-card hover:border-primary/30"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{route.label}</span>
                        {recommended && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground/85 mt-1">
                        {ROUTE_DECISION_COPY[route.key] || route.why}
                      </p>
                      {detailsOpen && (
                        <p className="text-xs text-muted-foreground mt-1">{route.why}</p>
                      )}
                      {selected && preview && (
                        <div className="mt-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-primary font-semibold">
                            First move if you choose this
                          </p>
                          <p className="text-xs text-foreground mt-1">
                            {preview.tinyNextAction.title}
                          </p>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  First move
                </p>
                <p className="text-sm font-medium mt-1">{selectedRoutePreview?.tinyNextAction.title || discovery.tinyNextAction.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Done when: {selectedRoutePreview?.tinyNextAction.doneWhen || discovery.tinyNextAction.doneWhen}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  First step: {selectedRoutePreview?.tinyNextAction.firstStep || discovery.tinyNextAction.firstStep}
                </p>
              </div>

              <div className="rounded-xl border border-card-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Suggested role types
                </p>
                {discovery.trackDrafts.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {discovery.trackDrafts.map((track) => (
                      <div key={track.slug} className="rounded-lg bg-muted/50 px-3 py-2">
                        <p className="text-sm font-medium">{track.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Search focus: {track.targetRoleArchetype}
                        </p>
                        {detailsOpen && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {track.whyItFits}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">
                    Anchor will create the right role types after you commit the route.
                  </p>
                )}
              </div>
            </div>

            {detailsOpen && discovery.unknowns.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  This will help you answer
                </p>
                <div className="mt-2 space-y-1.5">
                  {discovery.unknowns.slice(0, 2).map((unknown) => (
                    <p key={unknown} className="text-xs text-muted-foreground">
                      {unknown}
                    </p>
                  ))}
                </div>
                {discovery.knowns[0] && (
                  <p className="text-xs text-muted-foreground mt-3">
                    <span className="font-medium text-foreground">Starting point:</span>{" "}
                    {discovery.knowns[0]}
                  </p>
                )}
              </div>
            )}

            {discovery.needsUserAnswer.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  One or two details to shape the first tasks
                </p>
                <div className="space-y-3">
                  {discovery.needsUserAnswer.map((item) => (
                    <label key={item.key} className="block">
                      <span className="text-sm font-medium">{item.question}</span>
                      <Textarea
                        value={answers[item.key] || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [item.key]: e.target.value }))
                        }
                        className="mt-2 min-h-[72px] bg-background"
                        data-testid={`input-discovery-answer-${item.key}`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-medium">{selectedRoute?.label || "Selected route"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedRouteReason || discovery.recommendedRoute.reason}
              </p>
              {detailsOpen && (selectedRoutePreview?.supportAction || discovery.supportAction) && (
                <p className="text-xs text-muted-foreground mt-2">
                  Support move: {(selectedRoutePreview?.supportAction || discovery.supportAction)?.title}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  onClick={commitDiscovery}
                  disabled={committing || !selectedRouteKey}
                  data-testid="button-commit-discovery"
                >
                  {committing ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 mr-1" />
                  )}
                  {committing ? "Building your starting plan..." : "Use this starting direction"}
                </Button>
                {discoveryCommitted && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <Check className="w-3.5 h-3.5" />
                    Role types and starter tasks created
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {!discovery && (
        <>
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Or pick role types directly</h2>
            <p className="text-xs text-muted-foreground mt-1">
              If you already know what you want to test, add a few role types and Anchor
              will keep them running in parallel.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Thinking about your options...
            </div>
          ) : (
            <div className="space-y-3">
              {roles.map((role) => {
                const isAccepted = accepted.has(role.archetype);
                const isBusy = accepting === role.archetype;
                return (
                  <div
                    key={role.archetype}
                    className={`rounded-xl border p-4 transition-colors ${
                      isAccepted
                        ? "border-primary/40 bg-primary/5"
                        : "border-card-border bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{role.archetype}</p>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${priorityTone(
                              role.priority,
                            )}`}
                          >
                            {role.priority}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{role.fitLogic}</p>
                        {role.nextExperiment && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">First step:</span>{" "}
                            {role.nextExperiment}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => !isAccepted && acceptRole(role)}
                        disabled={isAccepted || isBusy}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                          isAccepted
                            ? "bg-primary/10 text-primary"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        }`}
                        data-testid={`button-accept-role-${role.archetype}`}
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isAccepted ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        {isAccepted ? "Added" : "Add role type"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {accepted.size > 0 && (
        <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">
              {accepted.size === 1 ? "1 role type added" : `${accepted.size} role types added`}{" "}
              - building your plan...
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anchor is shaping today around {accepted.size === 1 ? "it" : "them"} while
              keeping the wider search coherent. Your first moves will appear in a
              moment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
