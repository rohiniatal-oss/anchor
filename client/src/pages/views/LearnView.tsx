// @ts-nocheck
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, ExternalLink, Loader2, Check,
  ListChecks, Pencil, ArrowUp, ArrowDown, Ban, RefreshCw, CheckCircle2,
  Star, ChevronDown, ChevronRight, Lock, ArrowUpRight,
  GraduationCap, BookOpen, Hammer, BadgeCheck, Layers,
  Link2, Package, Newspaper, FileText, Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS, PENDING_LEARN_DRAFT_KEY, takeHashDraft, takeIntakeDraft } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useRecommendations } from "@/hooks/useRecommendations";
import { type LearnStarterPrefillT } from "@/lib/learnStarter";
import { SectionHeading } from "@/components/home/SectionHeading";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import { Empty } from "@/components/home/Empty";
import { TrackChip } from "@/components/home/TrackChip";
import { ConstraintBadge } from "@/components/home/ConstraintBadge";
import { CardActions } from "@/components/home/CardActions";
import { ViewSpineCallout, BroadPursuitParallelSupportKickoff, learnPresetForLane, laneGuideForCombination } from "@/lib/parallelPursuit";
import { findOpenLinkedTask, useLinkedTaskCount } from "@/lib/homeHelpers";
import { LEARN_OUTPUT_META, LEARN_STATUS_LABEL, learnTaskActionLabel, learnTaskCreatedLabel, parseIdList } from "@/lib/learnShared";
import { noLinkedTasksHelp, taskActionLabelForEntity, taskPreviewHint, taskToastDescription } from "@/lib/taskActionCopy";
import type { LearnFormT } from "@/lib/learnShared";
import { EMPTY_LEARN_FORM } from "@/lib/learnShared";
import { STEP_STATUS_TONE } from "@/lib/stepRailShared";
import type { Learn, Hustle, Task, CareerTrack, ProofAssetStep } from "@shared/schema";
import { nextHustleTaskTitle, nextLearnTaskTitle } from "@shared/taskPreview";
import type { GoalPortfolioItemT, GoalsStateResponseT } from "@/lib/goalSpine";
import { displayCombinationLabel } from "@/lib/goalSpine";
import { getTrackId, getLearnOutputState, learnNeedsOutputNudge, getLearnStatus, type LearnStatus } from "@shared/domainState";
import { CAPABILITY_DOMAIN_KEYS, domainForLearn, domainLabel } from "@shared/capabilityDomains";
import { requiredDomainsForTrack } from "@shared/capabilityTargets";
import { classifyProofAsset, PROOF_ASSET_KIND_LABEL, type ProofAssetKind } from "@shared/proofAssetTemplates";
import { isFellowshipLearnRow } from "@shared/fellowshipLane";

const HUSTLE_STAGES = [
  { id: "idea", label: "Idea", hint: "Not yet producing" },
  { id: "testing", label: "Producing", hint: "Output going out" },
  { id: "earning", label: "Established", hint: "Recognised body of work" },
] as const;

const PROOF_KIND_ICON: Record<ProofAssetKind, typeof BookOpen> = {
  substack: Newspaper, afterline: Package, memo: FileText,
};

function ProofKindBadge({ kind }: { kind: ProofAssetKind }) {
  const Icon = PROOF_KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-100" data-testid={`badge-kind-${kind}`}>
      <Icon className="w-2.5 h-2.5" /> {PROOF_ASSET_KIND_LABEL[kind]}
    </span>
  );
}

function ProofField({ label, value }: { label: string; value: string }) {
  if (!value || !value.trim()) return null;
  return (
    <p className="text-xs mt-1.5 leading-snug"><span className="text-muted-foreground">{label}:</span> {value}</p>
  );
}

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

type RecommendationDetail = {
  id: number;
  title: string;
  kind: string;
  executionShape: string;
  subdivisions: Array<{
    id: number;
    label: string;
    whyItMatters: string;
    suggestedMaterials: string;
    sequence: number;
  }>;
  milestones: Array<{
    id: number;
    label: string;
    doneWhen: string;
    status: string;
    suggestedTaskTitle: string;
    sequence: number;
    subdivisionKey: string;
    milestoneType?: string;
    scaffolding?: string;
    completionNote?: string;
  }>;
};

type LearnRecommendation = {
  id: number;
  collection: string;
  kind: string;
  status: string;
  title: string;
  whySuggested: string;
  linkedTrackId?: number | null;
  linkedGapKey?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  executionShape?: string | null;
  acceptanceEntityType?: string | null;
};

const LEARN_RECOMMENDATION_STATUS_LABEL: Record<string, string> = {
  new: "New",
  ranked: "Ready now",
  saved: "Saved for later",
};

function isLearnRecommendation(rec: LearnRecommendation) {
  if (rec.acceptanceEntityType === "learn") return true;
  return rec.collection === "learning-corpus" || rec.kind === "learning-resource" || rec.kind === "learning-theme";
}

function learnRecommendationShapeLabel(shape?: string | null) {
  if (shape === "ongoing-program") return "Multi-session";
  if (shape === "sequenced-item") return "Multi-step";
  if (shape === "milestone-arc") return "Step-by-step";
  return "Single starter";
}

function parseSuggestedMaterials(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

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
      toast({ title: "Steps generated.", description: "Based on this workflow. Edit them to fit." });
    } catch { toast({ title: "Couldn't generate steps", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function materialize(s: ProofAssetStep) {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/proof-steps/${s.id}/materialize`, {}, ["/api/tasks", "/api/strategy/diagnostics"]);
      await reloadInto();
      toast({ title: r?.reused ? "Already on your list." : "Task created from this step.", description: taskToastDescription(r, "There's already an open task for this asset.") });
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
    toast({ title: "Marked blocked.", description: "Noted on the step. Unblock it when ready." });
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
          <ListChecks className="w-3.5 h-3.5" /> Steps
          {steps.length > 0 && <span className="tabular-nums opacity-70">{doneCount}/{steps.length}</span>}
        </div>
        {steps.length > 0 && (
          <button onClick={() => setEditing((e) => !e)} data-testid={`button-edit-proof-steps-${h.id}`} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <Pencil className="w-3 h-3" /> {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground/60 py-1">Loading steps...</p>
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
                {s.status === "skipped" && <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> skipped{s.note ? `: ${s.note}` : ""}</p>}
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
                placeholder="Add a step..." className="h-7 text-xs" data-testid={`input-add-proof-step-${h.id}`} />
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={addStep} data-testid={`button-add-proof-step-${h.id}`}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProofAssetCard({ h, tracks, tasks, onMove, onRemove }: { h: Hustle; tracks: CareerTrack[]; tasks: Task[]; onMove: (h: Hustle, d: 1 | -1) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const idx = HUSTLE_STAGES.findIndex((s) => s.id === h.stage);
  const trackId = getTrackId("hustles", h);
  const linked = useLinkedTaskCount(tasks, "hustle", h.id);
  const kind = classifyProofAsset(h);
  const openHustleTask = findOpenLinkedTask(tasks, "hustle", h.id);
  return (
    <div className="group rounded-lg border border-card-border bg-card p-3" data-testid={`hustle-${h.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm leading-snug">{h.title}</h3>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-hustle-${h.id}`} className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <ProofKindBadge kind={kind} />
        <TrackChip trackId={trackId} tracks={tracks} />
        {h.stage === "idea" && <ConstraintBadge text="not yet producing" />}
      </div>
      <ProofAssetBody h={h} kind={kind} />
      {h.nextStep && <p className="text-xs mt-2 inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground px-1.5 py-0.5"><ArrowUpRight className="w-3 h-3" /> {h.nextStep}</p>}
      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onMove(h, -1)} data-testid={`button-hustle-back-${h.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate"><span aria-hidden="true">&larr;</span></button>}
        {idx < HUSTLE_STAGES.length - 1 && <button onClick={() => onMove(h, 1)} data-testid={`button-hustle-fwd-${h.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">{HUSTLE_STAGES[idx + 1].label} <span aria-hidden="true">&rarr;</span></button>}
      </div>
      <ProofStepRail h={h} />
      <CardActions entity="hustles" id={h.id} trackId={trackId} tracks={tracks}
        nextTaskHint={taskPreviewHint(nextHustleTaskTitle(h), openHustleTask?.title)}
        onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : noLinkedTasksHelp(taskActionLabelForEntity("hustles")) })} />
    </div>
  );
}

export function ProofAssetsView() {
  const { toast } = useToast();
  const { data: hustles = [], isLoading } = useQuery<Hustle[]>({ queryKey: ["/api/hustles"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", note: "", coreClaim: "", contentPillar: "" });
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/hustles", { ...form, stage: "idea" }, ["/api/hustles"]);
    toast({
      title: "Saved.",
      description: "I also started a step-by-step arc for this so it is easier to move from idea to output.",
    });
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
        <SectionHeading title="Writing, Projects, and Brand" sub="Optional posts, memos, and projects that help you think in public, build your brand, or make progress on something you care about." />
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0" data-testid="button-toggle-hustle-form"><Plus className="w-4 h-4 mr-1" /> Add writing or project</Button>
      </div>
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2">
          <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-hustle-title" />
          <Input placeholder="Core idea / what it's about" value={form.coreClaim} onChange={(e) => setForm({ ...form, coreClaim: e.target.value })} data-testid="input-hustle-claim" />
          <Input placeholder="Content pillar (e.g. geopolitics)" value={form.contentPillar} onChange={(e) => setForm({ ...form, contentPillar: e.target.value })} data-testid="input-hustle-pillar" />
          <Input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="input-hustle-note" />
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={add} data-testid="button-save-hustle">Save</Button></div>
        </div>
      )}
      {isLoading ? <Loading /> : hustles.length === 0 ? (
        <Empty icon={Rocket} text="No writing or projects yet. Add a memo, article, post, or side project if you want a place to track brand-building or public thinking." action={{ label: "Add writing or project", onClick: () => setShowForm(true) }} />
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
          {empty.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Other stages: {empty.map((g) => g.stage.label).join(" | ")} - items move here as they become real.</p>}
        </>
      )}
    </div>
  );
}

function LearnCard({ l, tracks, tasks, onToggle, onToggleActive, onRemove }: { l: Learn; tracks: CareerTrack[]; tasks: Task[]; onToggle: () => void; onToggleActive: () => void; onRemove: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const trackId = getTrackId("learn", l);
  const linked = useLinkedTaskCount(tasks, "learn", l.id);
  const openLearnTask = findOpenLinkedTask(tasks, "learn", l.id);
  const outputState = getLearnOutputState(l);
  const needsNudge = learnNeedsOutputNudge(l);
  const meta = LEARN_OUTPUT_META[outputState];
  const OutputIcon = meta.icon;
  const learnStatus = getLearnStatus(l);

  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(l.outputTitle || "");
  const [evidencing, setEvidencing] = useState(false);
  const [evidenceDraft, setEvidenceDraft] = useState("");
  const [showCurriculum, setShowCurriculum] = useState(false);

  const prereqIds = parseIdList(l.prerequisites);
  const unlockIds = parseIdList(l.unlocks);
  const recommendationSourceId = l.sourceType === "recommendation" && l.sourceId ? l.sourceId : null;
  const { data: recommendationDetail, isLoading: isLoadingCurriculum } = useQuery<RecommendationDetail>({
    queryKey: [`/api/recommendations/${recommendationSourceId}`],
    enabled: !!recommendationSourceId,
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/recommendations/${recommendationSourceId}`);
      return await r.json();
    },
  });
  const nextCurriculumMilestone = recommendationDetail?.milestones?.find((milestone) => milestone.status === "active")
    || recommendationDetail?.milestones?.find((milestone) => milestone.status === "blocked")
    || recommendationDetail?.milestones?.find((milestone) => milestone.status === "todo")
    || null;
  const nextCurriculumTaskTitle = nextCurriculumMilestone?.suggestedTaskTitle?.trim() || "";
  const nextTaskPreviewTitle = nextCurriculumTaskTitle || nextLearnTaskTitle(l);

  async function saveOutputTitle() {
    const v = titleDraft.trim();
    await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { outputTitle: v }, ["/api/learn"]);
    setEditingTitle(false);
  }
  async function setOutputStatus(status: string) {
    await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { outputStatus: status }, ["/api/learn"]);
  }
  async function createOutputTask() {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/learn/${l.id}/create-output-task`, {}, ["/api/tasks", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : learnTaskCreatedLabel("producing"), description: taskToastDescription(r, "There's already an open task for this.") });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function toggleProofIntent() {
    const next = !l.proofIntent;
    await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { proofIntent: next }, ["/api/learn", "/api/strategy/diagnostics", "/api/strategy/front-door", "/api/strategy/learning-gaps", ...GOAL_SPINE_QUERY_KEYS]);
    if (next) toast({ title: "Marked as learning with optional saved notes.", description: "This stays a learning item. If it leaves you with notes worth keeping, you can save them here." });
  }
  async function markEvidenced() {
    const v = evidenceDraft.trim();
    if (!v) return;
    setBusy(true);
    try {
      await mutateAndInvalidate("POST", `/api/learn/${l.id}/mark-evidenced`, { outputEvidenceUrl: v }, ["/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      setEvidencing(false); setEvidenceDraft("");
      toast({ title: "Linked to your notes.", description: "Anchor can refer back to them later." });
    } catch { toast({ title: "Couldn't save the link", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  async function refreshCurriculum() {
    if (!recommendationSourceId) return;
    await qc.invalidateQueries({ queryKey: [`/api/recommendations/${recommendationSourceId}`] });
  }
  async function setMilestoneStatus(milestoneId: number, status: string, successTitle: string) {
    if (!recommendationSourceId) return;
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/recommendation-milestones/${milestoneId}`, { status });
      await refreshCurriculum();
      toast({ title: successTitle, description: "The theme plan has been updated." });
    } catch {
      toast({ title: "Couldn't update the checkpoint", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  }
  async function makeMilestoneNext(milestoneId: number) {
    if (!recommendationSourceId) return;
    setBusy(true);
    try {
      const current = recommendationDetail?.milestones || [];
      for (const milestone of current) {
        if (milestone.id === milestoneId) continue;
        if (milestone.status === "active") {
          await apiRequest("PATCH", `/api/recommendation-milestones/${milestone.id}`, { status: "todo" });
        }
      }
      const target = current.find((milestone) => milestone.id === milestoneId);
      if (target && target.status !== "active") {
        await apiRequest("PATCH", `/api/recommendation-milestones/${milestoneId}`, { status: "active" });
      }
      await refreshCurriculum();
      toast({ title: "Set as the next prep step.", description: openLearnTask ? "Finish the current open prep task first; after that, this checkpoint will be next." : "The next prep task will use this checkpoint." });
    } catch {
      toast({ title: "Couldn't set the next checkpoint", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
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
              className={`shrink-0 ${l.active ? "text-primary" : "text-muted-foreground hover:text-primary [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"}`}><Star className="w-4 h-4" fill={l.active ? "currentColor" : "none"} /></button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <TrackChip trackId={trackId} tracks={tracks} />
            {l.capabilityBuilt && <span className="text-[10px] rounded-md bg-accent text-accent-foreground px-1.5 py-0.5">{l.capabilityBuilt}</span>}
            <span className="text-[10px] rounded-md bg-muted text-muted-foreground px-1.5 py-0.5">{LEARN_STATUS_LABEL[learnStatus]}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`} data-testid={`output-state-${l.id}`}>
              <OutputIcon className="w-2.5 h-2.5" /> {meta.label}
            </span>
          </div>

          {l.requiredOutput && <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-snug"><span className="font-medium">Optional notes to keep:</span> {l.requiredOutput}</p>}
          {l.note && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{l.note}</p>}

          {recommendationSourceId && (
            <div className="mt-2.5 rounded-lg border border-card-border bg-muted/25 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setShowCurriculum((value) => !value)}
                className="flex w-full items-center justify-between gap-2 text-left"
                data-testid={`button-toggle-learn-curriculum-${l.id}`}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Theme plan</p>
                  <p className="mt-0.5 text-xs leading-snug text-foreground">Keep the subtopics, starter materials, and checkpoints attached to this learning theme.</p>
                </div>
                {showCurriculum ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
              </button>

              {showCurriculum && (
                <div className="mt-3 space-y-3">
                  {isLoadingCurriculum ? (
                    <p className="text-xs text-muted-foreground">Loading the subtopics and checkpoints for this theme...</p>
                  ) : (
                    <>
                      {recommendationDetail?.subdivisions?.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What's inside</p>
                          <div className="mt-2 space-y-2">
                            {recommendationDetail.subdivisions.map((subdivision) => {
                              const materials = parseSuggestedMaterials(subdivision.suggestedMaterials);
                              return (
                                <div key={subdivision.id} className="rounded-lg border border-card-border bg-card px-3 py-2.5">
                                  <p className="text-xs font-medium leading-snug text-foreground">{subdivision.label}</p>
                                  {subdivision.whyItMatters && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{subdivision.whyItMatters}</p>}
                                  {materials.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {materials.map((material) => (
                                        <span key={material} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                                          <BookOpen className="w-2.5 h-2.5" /> {material}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {recommendationDetail?.milestones?.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Checkpoints</p>
                            {(() => {
                              const total = recommendationDetail.milestones.length;
                              const done = recommendationDetail.milestones.filter((m: any) => m.status === "done").length;
                              return total > 0 ? (
                                <span className="text-[10px] text-muted-foreground">{done}/{total} done</span>
                              ) : null;
                            })()}
                          </div>
                          <div className="mt-2 space-y-2">
                            {recommendationDetail.milestones.map((milestone: any) => {
                              const isDone = milestone.status === "done";
                              const isSkipped = milestone.status === "skipped";
                              const isActive = milestone.status === "active";
                              const isBlocked = milestone.status === "blocked";
                              const isClosed = isDone || isSkipped;
                              const scaffoldingItems = milestone.scaffolding ? milestone.scaffolding.split(" | ").filter(Boolean) : [];
                              const milestoneTypeBadge = milestone.milestoneType === "synthesis" ? "reflect" : milestone.milestoneType === "artifact" ? "produce" : null;
                              return (
                                <div key={milestone.id} className={`rounded-lg border px-3 py-2.5 ${isDone ? "border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-800/30 dark:bg-emerald-900/10" : "border-card-border bg-card"}`}>
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <p className="text-xs font-medium leading-snug text-foreground">{milestone.label}</p>
                                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                          isDone ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                            : isSkipped ? "bg-slate-200 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
                                              : isBlocked ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                              : isActive ? "bg-primary/10 text-primary"
                                                : "bg-muted text-muted-foreground"
                                        }`}>
                                          {isDone ? "done" : isSkipped ? "skipped" : isBlocked ? "blocked" : isActive ? "next up" : "todo"}
                                        </span>
                                        {milestoneTypeBadge && (
                                          <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">
                                            {milestoneTypeBadge}
                                          </span>
                                        )}
                                      </div>
                                      {milestone.suggestedTaskTitle && <p className="mt-1 text-[11px] leading-snug text-primary">{milestone.suggestedTaskTitle}</p>}
                                      {milestone.doneWhen && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Done when: {milestone.doneWhen}</p>}
                                      {scaffoldingItems.length > 0 && isActive && (
                                        <ul className="mt-1.5 space-y-0.5">
                                          {scaffoldingItems.map((q: string, qi: number) => (
                                            <li key={qi} className="text-[11px] text-muted-foreground/80 flex gap-1">
                                              <span className="shrink-0">›</span><span>{q}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {isDone && milestone.completionNote && (
                                        <p className="mt-1.5 text-[11px] italic text-emerald-700 dark:text-emerald-300 border-l-2 border-emerald-300 pl-2">"{milestone.completionNote}"</p>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {!isActive && !isBlocked && !isClosed && (
                                        <button
                                          type="button"
                                          onClick={() => makeMilestoneNext(milestone.id)}
                                          disabled={busy}
                                          className="text-[11px] text-primary hover:underline disabled:opacity-60"
                                          data-testid={`button-milestone-next-${milestone.id}`}
                                        >
                                          Make next
                                        </button>
                                      )}
                                      {isClosed ? (
                                        <button
                                          type="button"
                                          onClick={() => setMilestoneStatus(milestone.id, "todo", "Checkpoint reopened.")}
                                          disabled={busy}
                                          className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                                          data-testid={`button-milestone-reopen-${milestone.id}`}
                                        >
                                          Reopen
                                        </button>
                                      ) : isBlocked ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => setMilestoneStatus(milestone.id, "active", "Checkpoint reopened.")}
                                            disabled={busy}
                                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                                            data-testid={`button-milestone-reopen-${milestone.id}`}
                                          >
                                            Reopen
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setMilestoneStatus(milestone.id, "done", "Checkpoint marked done.")}
                                            disabled={busy}
                                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                                            data-testid={`button-milestone-done-${milestone.id}`}
                                          >
                                            Mark done
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setMilestoneStatus(milestone.id, "skipped", "Checkpoint skipped.")}
                                            disabled={busy}
                                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                                            data-testid={`button-milestone-skip-${milestone.id}`}
                                          >
                                            Skip
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => setMilestoneStatus(milestone.id, "done", "Checkpoint marked done.")}
                                            disabled={busy}
                                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                                            data-testid={`button-milestone-done-${milestone.id}`}
                                          >
                                            Mark done
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setMilestoneStatus(milestone.id, "skipped", "Checkpoint skipped.")}
                                            disabled={busy}
                                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                                            data-testid={`button-milestone-skip-${milestone.id}`}
                                          >
                                            Skip
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {(prereqIds.length > 0 || unlockIds.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {prereqIds.length > 0 && <span className="text-[10px] rounded-md bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> needs {prereqIds.length}</span>}
              {unlockIds.length > 0 && <span className="text-[10px] rounded-md bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 inline-flex items-center gap-1"><ArrowUpRight className="w-2.5 h-2.5" /> unlocks {unlockIds.length}</span>}
            </div>
          )}

          {needsNudge && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-2 inline-flex items-center gap-1" data-testid={`learn-nudge-${l.id}`}>
              <Hammer className="w-3 h-3" /> If this leaves you with notes worth keeping, track them below.
            </p>
          )}

          {outputState === "reference" && !l.done && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <button onClick={toggleProofIntent} data-testid={`button-proof-intent-${l.id}`} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Hammer className="w-3 h-3" /> Keep notes from this
              </button>
            </div>
          )}

          {outputState === "evidenced" && l.outputEvidenceUrl && (
            <a href={l.outputEvidenceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-evidence-${l.id}`} className="text-xs text-emerald-700 dark:text-emerald-300 mt-2 inline-flex items-center gap-1 hover:underline">
              <BadgeCheck className="w-3 h-3" /> {l.outputTitle || "View linked notes"} <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <div className="flex items-center gap-3 mt-2">
            {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer" data-testid={`link-learn-${l.id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">Open <ExternalLink className="w-3 h-3" /></a>}
            <button onClick={onRemove} data-testid={`button-delete-learn-${l.id}`} className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Remove</button>
          </div>

          {outputState === "producing" && !l.done && (
            <div className="mt-2.5 rounded-lg bg-muted/40 px-3 py-2.5 space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes to keep</p>
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} placeholder="e.g. notes summary, checklist, policy memo, interview brief" className="h-7 text-xs" data-testid={`input-output-title-${l.id}`} />
                  <button onClick={saveOutputTitle} className="text-xs text-primary font-medium hover:underline shrink-0">Save</button>
                  <button onClick={() => { setEditingTitle(false); setTitleDraft(l.outputTitle || ""); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setEditingTitle(true)} data-testid={`button-edit-output-title-${l.id}`} className="text-xs text-left w-full hover:text-primary transition-colors">
                  {l.outputTitle ? <span className="font-medium">{l.outputTitle}</span> : <span className="text-muted-foreground">Add a title...</span>}
                </button>
              )}
              <div className="flex items-center gap-1.5">
                {(["idea", "drafting", "published"] as const).map((s) => (
                  <button key={s} onClick={() => setOutputStatus(s === l.outputStatus ? "" : s)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors capitalize ${l.outputStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"}`}
                    data-testid={`button-output-status-${l.id}-${s}`}>
                    {s}
                  </button>
                ))}
              </div>
              {l.outputStatus === "published" && (
                <div>
                  {l.outputEvidenceUrl ? (
                    <a href={l.outputEvidenceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-evidence-${l.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> View {l.outputTitle || "notes"}
                    </a>
                  ) : evidencing ? (
                    <span className="inline-flex items-center gap-2">
                      <Input value={evidenceDraft} onChange={(e) => setEvidenceDraft(e.target.value)} placeholder="Link to the notes, checklist, doc, or project" className="h-7 text-xs w-48" data-testid={`input-evidence-${l.id}`} />
                      <button onClick={markEvidenced} disabled={busy || !evidenceDraft.trim()} data-testid={`button-confirm-evidence-${l.id}`} className="text-xs text-primary font-medium hover:underline disabled:opacity-60">Save</button>
                      <button onClick={() => { setEvidencing(false); setEvidenceDraft(""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setEvidencing(true)} data-testid={`button-mark-evidenced-${l.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Add link
                    </button>
                  )}
                </div>
              )}
              <button onClick={createOutputTask} disabled={busy} data-testid={`button-create-output-task-${l.id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {learnTaskActionLabel("producing")}
              </button>
            </div>
          )}

          <CardActions entity="learn" id={l.id} trackId={trackId} tracks={tracks}
            nextTaskHint={taskPreviewHint(nextTaskPreviewTitle, openLearnTask?.title)}
            onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : `Use '${learnTaskActionLabel(outputState)}' to make one.` })} />
        </div>
      </div>
    </div>
  );
}

export function LearnView() {
  const { data: items = [], isLoading } = useQuery<Learn[]>({ queryKey: ["/api/learn"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: recommendations = [] } = useRecommendations<LearnRecommendation[]>();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { toast } = useToast();
  const activeGoal = goalState?.goals?.[0] || null;
  const [showForm, setShowForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showMoreLearnFields, setShowMoreLearnFields] = useState(false);
  const [form, setForm] = useState<LearnFormT>(EMPTY_LEARN_FORM);
  const [selectedLane, setSelectedLane] = useState("");
  const [starterHint, setStarterHint] = useState<{ label: string; why: string } | null>(null);
  const selectedLaneGuide = selectedLane ? laneGuideForCombination(selectedLane) : null;
  useEffect(() => {
    const pending = takeHashDraft<LearnStarterPrefillT>("learnDraft") || takeIntakeDraft<LearnStarterPrefillT>(PENDING_LEARN_DRAFT_KEY);
    if (pending) {
      const { starterLabel, starterWhy, ...draft } = pending;
      setForm({ ...EMPTY_LEARN_FORM, ...draft });
      setStarterHint(starterLabel || starterWhy ? { label: starterLabel || draft.title || "Prep starter", why: starterWhy || "" } : null);
      setShowForm(true);
    }
  }, []);
  const suggestedDomainKeys = Array.from(
    new Set(tracks.flatMap((track) => requiredDomainsForTrack(track)).filter((key) => !!key)),
  ) as string[];
  function updateLearnForm(patch: Partial<LearnFormT>, clearStarter = false) {
    if (clearStarter) setStarterHint(null);
    setForm((current) => ({ ...current, ...patch }));
  }
  function startLaneLearn(item: GoalPortfolioItemT) {
    const preset = learnPresetForLane(item, tracks);
    const { starterLabel, starterWhy, ...draft } = preset as LearnStarterPrefillT;
    setForm({ ...EMPTY_LEARN_FORM, ...draft });
    setStarterHint(starterLabel || starterWhy ? { label: starterLabel || draft.title || "Prep starter", why: starterWhy || "" } : null);
    setSelectedLane(item.combination);
    setShowForm(true);
  }
  async function add() {
    if (!form.title.trim()) return;
    await mutateAndInvalidate("POST", "/api/learn", { ...form, done: false, active: false }, ["/api/learn", ...GOAL_SPINE_QUERY_KEYS]);
    setForm(EMPTY_LEARN_FORM); setSelectedLane(""); setStarterHint(null); setShowForm(false); setShowMoreLearnFields(false);
  }
  async function toggle(l: Learn) { await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { done: !l.done }, ["/api/learn", ...GOAL_SPINE_QUERY_KEYS]); }
  async function toggleActive(l: Learn) { await mutateAndInvalidate("PATCH", `/api/learn/${l.id}`, { active: !l.active }, ["/api/learn", ...GOAL_SPINE_QUERY_KEYS]); }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/learn/${id}`, undefined, ["/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]); }
  async function acceptRecommendation(rec: LearnRecommendation) {
    await mutateAndInvalidate("POST", `/api/recommendations/${rec.id}/accept`, { entityType: "learn" }, [
      "/api/recommendations",
      "/api/learn",
      "/api/strategy",
      "/api/strategy/front-door",
      "/api/strategy/diagnostics",
      "/api/tasks",
      ...GOAL_SPINE_QUERY_KEYS,
    ]);
    toast({ title: "Added to your learning list.", description: "You can keep it as-is, or tune it after it lands." });
  }
  async function updateRecommendationStatus(id: number, status: string) {
    await mutateAndInvalidate("PATCH", `/api/recommendations/${id}`, { status }, ["/api/recommendations"]);
  }

  const consumeItems = items.filter((l) => !isFellowshipLearnRow(l));
  const live = consumeItems.filter((l) => !l.done);
  const done = consumeItems.filter((l) => l.done);
  const visibleSuggestions = recommendations.filter((rec) => isLearnRecommendation(rec) && !["accepted", "rejected", "archived", "duplicate", "stale"].includes(rec.status));
  const readySuggestions = visibleSuggestions.filter((rec) => rec.status !== "saved");
  const savedSuggestions = visibleSuggestions.filter((rec) => rec.status === "saved");
  const trackNameById = new Map(tracks.map((track) => [track.id, track.name]));

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

  function SuggestedStarterList({ list, title }: { list: LearnRecommendation[]; title: string }) {
    if (list.length === 0) return null;
    return (
      <div>
        <GroupLabel count={list.length}>
          <BookOpen className="w-4 h-4 text-slate-600 dark:text-slate-400" /> {title}
        </GroupLabel>
        <div className="space-y-2">
          {list.map((rec) => {
            const linkedTrackName = rec.linkedTrackId ? trackNameById.get(rec.linkedTrackId) : "";
            return (
              <div key={rec.id} className="rounded-xl border border-card-border bg-card p-4" data-testid={`learn-recommendation-${rec.id}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {LEARN_RECOMMENDATION_STATUS_LABEL[rec.status] && (
                    <span className="inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                      {LEARN_RECOMMENDATION_STATUS_LABEL[rec.status]}
                    </span>
                  )}
                  <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {learnRecommendationShapeLabel(rec.executionShape)}
                  </span>
                  {linkedTrackName && (
                    <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      {linkedTrackName}
                    </span>
                  )}
                  {rec.sourceLabel && (
                    <span className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
                      {rec.sourceLabel}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-snug text-foreground">{rec.title}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{rec.whySuggested}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => acceptRecommendation(rec)} data-testid={`button-accept-learn-recommendation-${rec.id}`}>
                    <GraduationCap className="mr-1 h-4 w-4" /> Use suggestion
                  </Button>
                  {rec.status !== "saved" && (
                    <Button size="sm" variant="outline" onClick={() => updateRecommendationStatus(rec.id, "saved")} data-testid={`button-save-learn-recommendation-${rec.id}`}>
                      Save for later
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => updateRecommendationStatus(rec.id, "archived")} data-testid={`button-archive-learn-recommendation-${rec.id}`}>
                    Not now
                  </Button>
                  {rec.sourceUrl && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={rec.sourceUrl} target="_blank" rel="noreferrer">
                        <ArrowUpRight className="mr-1 h-4 w-4" /> Source
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const activeNow = live.filter((l) => l.active);

  return (
      <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Learn" sub="Courses, reading, and prep that make future roles and interviews feel easier. Brand work like Substack belongs below under Writing, Projects, and Brand, not under Learn." />
        <Button onClick={() => {
          if (showForm) {
            setShowForm(false);
            setStarterHint(null);
            return;
          }
          setStarterHint(null);
          setShowForm(true);
        }} className="shrink-0" data-testid="button-toggle-learn-form"><Plus className="w-4 h-4 mr-1" /> Add learning item</Button>
      </div>
      {activeGoal && !(live.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="learn" goal={activeGoal} />}
      {activeGoal && <BroadPursuitParallelSupportKickoff goal={activeGoal} mode="learn" onStartLane={startLaneLearn} />}
      {visibleSuggestions.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <p className="text-sm font-medium">Prep starters</p>
            <p className="mt-1 text-xs text-muted-foreground">Anchor has already found these prep starters from your active role types and current gaps. Use one, save it for later, or hide it.</p>
          </div>
          <SuggestedStarterList list={readySuggestions} title="Ready now" />
          <SuggestedStarterList list={savedSuggestions} title="Saved for later" />
        </div>
      )}
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 space-y-3">
          {selectedLane && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2" data-testid="learn-form-lane-banner">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Role type</p>
                <p className="text-sm font-medium">{displayCombinationLabel(selectedLane)}</p>
                {selectedLaneGuide && <p className="text-xs text-muted-foreground mt-0.5">{selectedLaneGuide.fitHint}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedLane(""); setStarterHint(null); setForm((c) => ({ ...c, title: "", category: "", capabilityBuilt: "", requiredOutput: "", note: "", relatedTrackId: null, proofIntent: false })); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0" data-testid="button-clear-learn-lane">Clear</button>
            </div>
          )}
          {starterHint && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" data-testid="learn-starter-hint">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prep starter</p>
              <p className="text-sm font-medium mt-1">{starterHint.label}</p>
              {starterHint.why && <p className="text-xs text-muted-foreground mt-1">{starterHint.why}</p>}
              <p className="text-xs text-muted-foreground mt-1">You can save this as-is, or tweak it first.</p>
            </div>
          )}
          <Input placeholder="Title *" value={form.title} onChange={(e) => updateLearnForm({ title: e.target.value }, true)} data-testid="input-learn-title" autoFocus />
          <Input placeholder="Link (optional)" value={form.url} onChange={(e) => updateLearnForm({ url: e.target.value })} data-testid="input-learn-url" />
          {suggestedDomainKeys.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Topic area (optional)</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedDomainKeys.map((key) => {
                  const label = domainLabel(key);
                  return (
                  <button key={key} type="button" onClick={() => updateLearnForm({ category: label, capabilityBuilt: label }, true)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.category === domainLabel(key) ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-learn-domain-${key}`}>{label}</button>
                )})}
              </div>
            </div>
          )}
          <button type="button" onClick={() => setShowMoreLearnFields((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreLearnFields ? "rotate-180" : ""}`} />
            {showMoreLearnFields ? "Fewer options" : "More options (result, mode, role type)"}
          </button>
          {showMoreLearnFields && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Helps you get better at" value={form.capabilityBuilt} onChange={(e) => updateLearnForm({ capabilityBuilt: e.target.value }, true)} data-testid="input-learn-capability-built" />
                <Input placeholder="Optional notes, checklist, or brief to keep" value={form.requiredOutput} onChange={(e) => updateLearnForm({ requiredOutput: e.target.value })} data-testid="input-learn-required-output" />
                <Input placeholder="Note" value={form.note} onChange={(e) => updateLearnForm({ note: e.target.value })} className="sm:col-span-2" data-testid="input-learn-note" />
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Mode</p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => updateLearnForm({ proofIntent: false })} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${!form.proofIntent ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`} data-testid="button-learn-mode-reference">Just learning</button>
                    <button type="button" onClick={() => updateLearnForm({ proofIntent: true })} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.proofIntent ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`} data-testid="button-learn-mode-output">May leave notes worth keeping</button>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Status</p>
                  <div className="flex gap-1.5">
                    {(["open", "watch", "active"] as LearnStatus[]).map((status) => (
                      <button key={status} type="button" onClick={() => updateLearnForm({ learnStatus: status })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.learnStatus === status ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                        data-testid={`button-learn-status-${status}`}>{LEARN_STATUS_LABEL[status]}</button>
                    ))}
                  </div>
                </div>
              </div>
              {tracks.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Link to role type</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tracks.map((track) => (
                      <button key={track.id} type="button" onClick={() => updateLearnForm({ relatedTrackId: form.relatedTrackId === track.id ? null : track.id }, true)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}
                        data-testid={`button-learn-track-${track.id}`}>{track.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setSelectedLane(""); setStarterHint(null); setForm(EMPTY_LEARN_FORM); setShowMoreLearnFields(false); }}>Cancel</Button>
            <Button onClick={add} data-testid="button-save-learn">Save</Button>
          </div>
        </div>
      )}
      {isLoading ? <Loading /> : items.length === 0 ? (
        <Empty icon={GraduationCap} text="No learning items yet. Add one thing you want to learn, practise, or get clearer on." action={{ label: "Add a learning item", onClick: () => setShowForm(true) }} />
      ) : (
        <div className="space-y-6">
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

      <div className="mt-8 pt-6 border-t border-card-border">
        <ProofAssetsView />
      </div>
    </div>
  );
}
