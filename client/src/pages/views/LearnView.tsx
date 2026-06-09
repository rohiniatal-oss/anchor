import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GraduationCap,
  Hammer,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Newspaper,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { CardActions } from "@/components/home/CardActions";
import { ConstraintBadge } from "@/components/home/ConstraintBadge";
import { Empty } from "@/components/home/Empty";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import { SectionHeading } from "@/components/home/SectionHeading";
import { TrackChip } from "@/components/home/TrackChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { GoalPortfolioItemT, GoalsStateResponseT } from "@/lib/goalSpine";
import { useLinkedTaskCount } from "@/lib/homeHelpers";
import { GOAL_SPINE_QUERY_KEYS, PENDING_LEARN_DRAFT_KEY, takeHashDraft, takeIntakeDraft } from "@/lib/homeTypes";
import { LEARN_OUTPUT_META, LEARN_STATUS_LABEL, parseIdList } from "@/lib/learnShared";
import { BroadPursuitParallelSupportKickoff, LearnFormT, laneGuideForCombination, learnPresetForLane, ViewSpineCallout } from "@/lib/parallelPursuit";
import { apiRequest } from "@/lib/queryClient";
import { STEP_STATUS_TONE } from "@/lib/stepRailShared";
import { CAPABILITY_DOMAIN_KEYS, domainForLearn, domainLabel } from "@shared/capabilityDomains";
import { requiredDomainsForTrack } from "@shared/capabilityTargets";
import { getLearnOutputState, getLearnStatus, getTrackId, learnNeedsOutputNudge, type LearnStatus } from "@shared/domainState";
import { isFellowshipLearnRow } from "@shared/fellowshipLane";
import { classifyProofAsset, PROOF_ASSET_KIND_LABEL, type ProofAssetKind } from "@shared/proofAssetTemplates";
import type { CareerTrack, Hustle, Learn, ProofAssetStep, Task } from "@shared/schema";
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

export default function LearnView() {
  const { data: items = [], isLoading } = useQuery<Learn[]>({ queryKey: ["/api/learn"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const activeGoal = goalState?.goals?.[0] || null;
  const [showForm, setShowForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
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
    setForm(EMPTY_LEARN_FORM); setSelectedLane(""); setShowForm(false);
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
  // domain lands in a FLAT list Ã¢â‚¬â€ never a forced "Other" bucket. No pressure.
  const byDomain = new Map<string, Learn[]>(CAPABILITY_DOMAIN_KEYS.map((k) => [k, []]));
  const flat: Learn[] = [];
  for (const l of live) {
    const key = domainForLearn(l.category, l.capabilityBuilt);
    if (key && byDomain.has(key)) byDomain.get(key)!.push(l);
    else flat.push(l);
  }
  const activeDomainKeys = CAPABILITY_DOMAIN_KEYS.filter((k) => byDomain.get(k)!.length > 0);

  function CardList({ list }: { list: Learn[] }) {
    return <div className="grid gap-2.5 sm:grid-cols-2">{list.map((l) => <LearnCard key={l.id} l={l} tracks={tracks} tasks={tasks} onToggle={() => toggle(l)} onToggleActive={() => toggleActive(l)} onRemove={() => remove(l.id)} />)}</div>;
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Learn" sub="What you're building so future roles and interviews feel easier." />
        <Button onClick={() => showForm ? setShowForm(false) : setShowForm(true)} className="shrink-0" data-testid="button-toggle-learn-form"><Plus className="w-4 h-4 mr-1" /> Add</Button>
      </div>
      {activeGoal && !(live.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="learn" goal={activeGoal} />}
      {activeGoal && live.length === 0 && <BroadPursuitParallelSupportKickoff goal={activeGoal} mode="learn" onStartLane={startLaneLearn} />}
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2 sm:grid-cols-2">
          {selectedLane && (
            <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" data-testid="learn-form-lane-banner">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Supporting lane</p>
                  <p className="text-sm font-medium">{selectedLane}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLane("");
                    setForm((current) => ({ ...current, title: "", category: "", capabilityBuilt: "", requiredOutput: "", note: "", relatedTrackId: null, proofIntent: false }));
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-learn-lane"
                >
                  Clear lane
                </button>
              </div>
              {selectedLaneGuide && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-card-border bg-card/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why this capability helps</p>
                    <p className="mt-1 text-xs text-foreground">{selectedLaneGuide.fitHint}</p>
                  </div>
                  <div className="rounded-md border border-card-border bg-card/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Use this output for</p>
                    <p className="mt-1 text-xs text-foreground">A reusable memo, note, artifact, or evidence signal that strengthens this lane across multiple roles.</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {suggestedDomainKeys.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Suggested capability domains</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedDomainKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm({ ...form, category: domainLabel(key), capabilityBuilt: domainLabel(key) })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.category === domainLabel(key) || form.capabilityBuilt === domainLabel(key) ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                    data-testid={`button-learn-domain-${key}`}
                  >
                    {domainLabel(key)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-learn-title" />
          <Input placeholder="Capability / category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="input-learn-category" />
          <Input placeholder="Capability this builds" value={form.capabilityBuilt} onChange={(e) => setForm({ ...form, capabilityBuilt: e.target.value })} data-testid="input-learn-capability-built" />
          <Input placeholder="Intended output (optional)" value={form.requiredOutput} onChange={(e) => setForm({ ...form, requiredOutput: e.target.value })} data-testid="input-learn-required-output" />
          <Input placeholder="Link" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="sm:col-span-2" data-testid="input-learn-url" />
          <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sm:col-span-2" data-testid="input-learn-note" />

          <div className="sm:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Mode</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setForm({ ...form, proofIntent: false })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${!form.proofIntent ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                data-testid="button-learn-mode-reference"
              >
                Reference only
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, proofIntent: true })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.proofIntent ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                data-testid="button-learn-mode-output"
              >
                Build toward output
              </button>
            </div>
          </div>

          <div className="sm:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Learn status</p>
            <div className="flex flex-wrap gap-1.5">
              {(["open", "watch", "active"] as LearnStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setForm({ ...form, learnStatus: status })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.learnStatus === status ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                  data-testid={`button-learn-status-${status}`}
                >
                  {LEARN_STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </div>

          {tracks.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Track link</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, relatedTrackId: null })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.relatedTrackId == null ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                  data-testid="button-learn-track-none"
                >
                  Leave unlinked
                </button>
                {tracks.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setForm({ ...form, relatedTrackId: track.id })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                    data-testid={`button-learn-track-${track.id}`}
                  >
                    {track.name}
                  </button>
                ))}
              </div>
              {selectedLaneGuide && form.relatedTrackId != null && (
                <p className="mt-1 text-[11px] text-muted-foreground">Anchor linked the nearest matching track, but you can change it.</p>
              )}
            </div>
          )}
          <div className="sm:col-span-2 flex gap-2 justify-end"><Button variant="ghost" onClick={() => { setShowForm(false); setSelectedLane(""); setForm(EMPTY_LEARN_FORM); }}>Cancel</Button><Button onClick={add} data-testid="button-save-learn">Save</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : items.length === 0 ? (
        <Empty icon={GraduationCap} text="No support items yet. Add one reusable capability move now." />
      ) : (
        <div className="space-y-6">
          {activeDomainKeys.map((key) => (
            <div key={key} data-testid={`domain-${key}`}>
              <GroupLabel count={byDomain.get(key)!.length}><Layers className="w-4 h-4 text-slate-600 dark:text-slate-400" /> {domainLabel(key)}</GroupLabel>
              <CardList list={byDomain.get(key)!} />
            </div>
          ))}

          {flat.length > 0 && (
            <div data-testid="domain-flat">
              <GroupLabel count={flat.length}><GraduationCap className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Everything else</GroupLabel>
              <CardList list={flat} />
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
    if (v) toast({ title: "Output set.", description: "This is now building toward proof. Produce it when you're ready Ã¢â‚¬â€ no rush." });
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
    if (next) toast({ title: "Flagged as proof-building.", description: "This now sits in the building lane. Give it an output when you're ready Ã¢â‚¬â€ no rush." });
  }
  async function markEvidenced() {
    const v = evidenceDraft.trim();
    if (!v) return;
    setBusy(true);
    try {
      await mutateAndInvalidate("POST", `/api/learn/${l.id}/mark-evidenced`, { outputEvidenceUrl: v }, ["/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      setEvidencing(false); setEvidenceDraft("");
      toast({ title: "Marked as evidenced.", description: "The artifact is linked Ã¢â‚¬â€ this now counts as proof." });
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

          {/* SOFT, NON-AMBER reminder Ã¢â‚¬â€ ONLY for opted-in (track-linked) items with no output. Never on reference/consumption. */}
          {needsNudge && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-2 inline-flex items-center gap-1" data-testid={`learn-nudge-${l.id}`}>
              <Hammer className="w-3 h-3" /> Add an output to make this count as proof.
            </p>
          )}

          {/* CALM opt-in affordance for reference items: a quiet optional link only Ã¢â‚¬â€ NO warning. */}
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
                  (no requiredOutput) Ã¢â‚¬â€ un-marking then returns the item to the silent reference state. */}
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
// NOT side-income ventures Ã¢â‚¬â€ the DB table stays `hustles` internally. Stages
// (idea|testing|earning) still group the assets by how real each one is.
const HUSTLE_STAGES = [
  { id: "idea", label: "Idea", hint: "Not yet producing" },
  { id: "testing", label: "Producing", hint: "Output going out" },
  { id: "earning", label: "Established", hint: "Recognised proof" },
] as const;

const PROOF_KIND_ICON: Record<ProofAssetKind, typeof Sun> = {
  substack: Newspaper, afterline: Package, memo: FileText,
};

// Kind badge from the derived classifier Ã¢â‚¬â€ never a stored column.
function ProofKindBadge({ kind }: { kind: ProofAssetKind }) {
  const Icon = PROOF_KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-100" data-testid={`badge-kind-${kind}`}>
      <Icon className="w-2.5 h-2.5" /> {PROOF_ASSET_KIND_LABEL[kind]}
    </span>
  );
}

// The proof-production rail Ã¢â‚¬â€ mirrors JobStepRail (4.1) exactly: seed-when-empty,
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
      toast({ title: "Steps generated.", description: "From this asset's workflow Ã¢â‚¬â€ edit them to fit." });
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
    toast({ title: "Marked blocked.", description: "Noted on the step Ã¢â‚¬â€ unblock it when ready." });
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
        <p className="text-xs text-muted-foreground/60 py-1">Loading stepsÃ¢â‚¬Â¦</p>
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
                placeholder="Add a stepÃ¢â‚¬Â¦" className="h-7 text-xs" data-testid={`input-add-proof-step-${h.id}`} />
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

export function ProofAssetsView() {
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
        <SectionHeading title="Proof assets" sub="Proof you're producing Ã¢â‚¬â€ what makes you credible for these paths." />
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0" data-testid="button-toggle-hustle-form"><Plus className="w-4 h-4 mr-1" /> Add asset</Button>
      </div>
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2">
          <Input placeholder="Asset name? *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-hustle-title" />
          <Input placeholder="Core claim / what it proves" value={form.coreClaim} onChange={(e) => setForm({ ...form, coreClaim: e.target.value })} data-testid="input-hustle-claim" />
          <Input placeholder="Content pillar (e.g. geopolitics)" value={form.contentPillar} onChange={(e) => setForm({ ...form, contentPillar: e.target.value })} data-testid="input-hustle-pillar" />
          <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="input-hustle-note" />
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={add} data-testid="button-save-hustle">Save</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : hustles.length === 0 ? (
        <Empty icon={Rocket} text="No proof assets yet. Add your Substack, Afterline, or a memo above." />
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
          {empty.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Other stages: {empty.map((g) => g.stage.label).join(" Ã‚Â· ")} Ã¢â‚¬â€ assets move here as they become real.</p>}
        </>
      )}
    </div>
  );
}

// Workflow-specific card body Ã¢â‚¬â€ each kind shows its own bespoke fields.
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
        {idx > 0 && <button onClick={() => onMove(h, -1)} data-testid={`button-hustle-back-${h.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">Ã¢â€ Â</button>}
        {idx < HUSTLE_STAGES.length - 1 && <button onClick={() => onMove(h, 1)} data-testid={`button-hustle-fwd-${h.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">{HUSTLE_STAGES[idx + 1].label} Ã¢â€ â€™</button>}
      </div>
      <ProofStepRail h={h} />
      <CardActions entity="hustles" id={h.id} trackId={trackId} tracks={tracks}
        onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : "Use 'Create next task' to make one." })} />
    </div>
  );
}

