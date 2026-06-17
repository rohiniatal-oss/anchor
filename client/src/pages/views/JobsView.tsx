import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Trash2, ExternalLink, CalendarDays, ChevronDown, ChevronUp, ChevronRight,
  Loader2, Check, Compass, Lock, ListChecks, Pencil,
  ArrowUp, ArrowDown, Ban, CheckCircle2, RefreshCw,
  Flame, Users, Hammer, GraduationCap, FileText, MessageSquare,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS, PENDING_CONTACT_DRAFT_KEY, PENDING_LEARN_DRAFT_KEY, queueIntakeDraft, buildPrefillHash, daysUntil, formatDeadline, deadlineTone } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useRecommendations } from "@/hooks/useRecommendations";
import { SectionHeading } from "@/components/home/SectionHeading";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import { TrackChip } from "@/components/home/TrackChip";
import { ConstraintBadge } from "@/components/home/ConstraintBadge";
import { CardActions } from "@/components/home/CardActions";
import { ViewSpineCallout, BroadPursuitJobsKickoff } from "@/lib/parallelPursuit";
import { laneGuideForCombination, lanePresetForJob, JOB_ARCHETYPE_OPTIONS } from "@/lib/parallelPursuit";
import { buildPrepStarterDraft } from "@/lib/learnStarter";
import { displayCombinationLabel } from "@/lib/goalSpine";
import { findOpenLinkedTask, useLinkedTaskCount } from "@/lib/homeHelpers";
import { LEARN_OUTPUT_META, LEARN_STATUS_LABEL, learnTaskActionLabel, learnTaskCreatedLabel } from "@/lib/learnShared";
import { noLinkedTasksHelp, taskActionLabelForEntity, taskPreviewHint, taskToastDescription } from "@/lib/taskActionCopy";
import { STEP_STATUS_TONE } from "@/lib/stepRailShared";
import { nextContactTaskTitle, nextJobTaskTitle, nextLearnTaskTitle } from "@shared/taskPreview";
import type { Job, Learn, Contact, Task, CareerTrack, JobPipelineStep } from "@shared/schema";
import type { GoalPortfolioItemT, GoalsStateResponseT } from "@/lib/goalSpine";
import type { JobFormT, JobTruthStripT } from "@/lib/jobsViewTypes";
import { EMPTY_JOB_FORM } from "@/lib/jobsViewTypes";
import { getTrackId, getRelationshipStrength, getLearnOutputState, getLearnStatus, isFellowship } from "@shared/domainState";
import { requiredDomainsForTrack } from "@shared/capabilityTargets";
import { domainLabel } from "@shared/capabilityDomains";

const JOB_COLS = [
  { id: "wishlist", label: "Want to apply" }, { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interviewing" }, { id: "closed", label: "Closed" },
] as const;

type RecommendationItem = {
  id: number;
  collection: string;
  kind: string;
  status: string;
  title: string;
  whySuggested: string;
  linkedTrackId?: number | null;
  linkedGapKey?: string | null;
  acceptanceEntityType?: string | null;
};

function sortJobs(a: Job, b: Job): number {
  const da = daysUntil(a.deadline), db = daysUntil(b.deadline);
  if (da !== null && db !== null) return da - db;
  if (da !== null) return -1;
  if (db !== null) return 1;
  return b.id - a.id;
}

const ELIGIBILITY_LABEL: Record<string, string> = {
  visa: "Visa sponsorship needed", citizenship: "Citizenship required",
  phd: "PhD required", likely_ineligible: "Likely ineligible",
};

const READINESS_STAGES = [
  { key: "cv", label: "CV tailored" },
  { key: "cover", label: "Cover letter" },
  { key: "questions", label: "Application questions" },
  { key: "sample", label: "Extra material" },
  { key: "referral", label: "Intro / referral" },
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
    await mutateAndInvalidate("PATCH", `/api/jobs/${j.id}`, { applicationReadiness: newKey }, ["/api/jobs", "/api/jobs/truth-strips", ...GOAL_SPINE_QUERY_KEYS]);
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
      toast({ title: r?.reused ? "Already on your list." : "Task created from this step.", description: taskToastDescription(r, "There's already an open task for this role.") });
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
                {s.status === "skipped" && <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> skipped{s.note ? `: ${s.note}` : ""}</p>}
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

function getJobWarmSupport(trackId: number | null, contacts: Contact[], job?: { company?: string; title?: string }) {
  const trackContacts = trackId != null ? contacts.filter((c) => getTrackId("contacts", c) === trackId) : [];
  const companyLower = (job?.company || "").toLowerCase().trim();
  const companyContacts = companyLower.length > 2
    ? contacts.filter((c) => c.targetOrg && c.targetOrg.toLowerCase().includes(companyLower) && !trackContacts.some((tc) => tc.id === c.id))
    : [];
  const allRelevant = [...trackContacts, ...companyContacts];
  const warmTrackContacts = allRelevant.filter((c) => c.status === "messaged" || c.status === "replied" || getRelationshipStrength(c) !== "cold");
  const weak = allRelevant.length === 0 || warmTrackContacts.length === 0;
  const pool = allRelevant.length > 0 ? allRelevant : contacts;
  const candidates = pool.filter((c) => c.status !== "replied").slice(0, 3);
  return { trackContacts: allRelevant, warmTrackContacts, weak, candidates, companyContacts };
}

function visibleTrackRecommendation(
  recommendations: RecommendationItem[],
  input: { trackId: number | null; collection: string; gapKey?: string | null },
) {
  if (input.trackId == null) return null;
  return recommendations.find((rec) =>
    rec.linkedTrackId === input.trackId &&
    rec.collection === input.collection &&
    !["accepted", "rejected", "archived", "duplicate", "stale"].includes(rec.status) &&
    (!input.gapKey || rec.linkedGapKey === input.gapKey)
  ) || null;
}

const LOW_WARM_PATH = 40;
function JobWarmPath({ j, trackId, contacts, savedContactRec, onAcceptRecommendation }: { j: Job; trackId: number | null; contacts: Contact[]; savedContactRec: RecommendationItem | null; onAcceptRecommendation: (rec: RecommendationItem) => Promise<void> }) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  if (j.status === "closed") return null;

  const trackContacts = trackId != null ? contacts.filter((c) => getTrackId("contacts", c) === trackId) : [];
  const warmTrackContacts = trackContacts.filter((c) => c.status === "messaged" || c.status === "replied" || getRelationshipStrength(c) !== "cold");
  const weak = ((j.warmPathScore ?? 0) < LOW_WARM_PATH) || warmTrackContacts.length === 0;
  if (!weak) return null;

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
      why: `Could help you get closer to ${j.title}${j.company ? ` at ${j.company}` : ""}.`,
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
        <Flame className="w-3.5 h-3.5" /> Helpful contacts
      </div>
      {candidates.length === 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {savedContactRec ? "No contacts are linked to this role yet, but Anchor already saved a useful contact suggestion for this track." : "No contacts linked to this role yet. Add someone in Network."}
          </p>
          {savedContactRec ? (
            <button
              type="button"
              onClick={() => onAcceptRecommendation(savedContactRec)}
              className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1"
              data-testid={`button-use-saved-network-from-job-${j.id}`}
            >
              <Users className="w-3.5 h-3.5" /> Use saved suggestion
            </button>
          ) : (
            <button
              type="button"
              onClick={openNetworkIntake}
              className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1"
              data-testid={`button-open-network-from-job-${j.id}`}
            >
              <Users className="w-3.5 h-3.5" /> Add contact for this role
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Someone who could help here:</p>
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
  truth,
  savedLearningRec,
  onAcceptRecommendation,
}: {
  j: Job;
  trackId: number | null;
  tracks: CareerTrack[];
  learns: Learn[];
  truth: JobTruthStripT | null;
  savedLearningRec: RecommendationItem | null;
  onAcceptRecommendation: (rec: RecommendationItem) => Promise<void>;
}) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  if (j.status === "closed" || trackId == null) return null;

  const track = tracks.find((t) => t.id === trackId) || null;
  const requiredDomains = track ? requiredDomainsForTrack(track) : [];
  const needsPrep = truth?.action === "prove" || truth?.action === "prepare";
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
      const outputState = getLearnOutputState(l);
      const endpoint = outputState === "reference" ? `/api/learn/${l.id}/create-next-task` : `/api/learn/${l.id}/create-output-task`;
      const r = await mutateAndInvalidate("POST", endpoint, {}, ["/api/tasks", "/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      toast({
        title: r?.reused ? "Already on your list." : learnTaskCreatedLabel(outputState),
        description: taskToastDescription(r, "There's already an open task for this learning item."),
      });
    } catch {
      toast({ title: "Couldn't create the learning task", description: "Try again in a moment." });
    } finally {
      setBusyId(null);
    }
  }

  function openLearnIntake() {
    const draft = buildPrepStarterDraft({
      subjectText: `${track?.name || ""} ${j.title} ${j.company || ""}`.trim(),
      relatedTrackId: trackId,
      track,
      noteIntro: `Build familiarity with ${track?.name || "this role type"} while pursuing ${j.title}${j.company ? ` @ ${j.company}` : ""}.`,
      fallbackTitle: `${track?.name || j.title} learning`,
    });
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-card-border rounded-md bg-slate-50/70 dark:bg-slate-900/20 -mx-1 px-2 pb-2" data-testid={`capability-support-${j.id}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-1.5">
        <Hammer className="w-3.5 h-3.5" /> Learning
      </div>
      {supportItems.length === 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {savedLearningRec
              ? "Anchor already saved a useful learning item for this track, so you can start from that instead of setting one up from scratch."
              : needsPrep
                ? "This role may need clearer learning support. Start learning about it if you want more focused help here."
                : "No learning is linked to this role type yet. Set one up if you want extra support for this role or interview."}
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
          {savedLearningRec ? (
            <button
              type="button"
              onClick={() => onAcceptRecommendation(savedLearningRec)}
              className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1"
              data-testid={`button-use-saved-learn-from-job-${j.id}`}
            >
              <GraduationCap className="w-3.5 h-3.5" /> Use saved learning item
            </button>
          ) : (
            <button
              type="button"
              onClick={openLearnIntake}
              className="text-[11px] text-primary font-medium hover:underline inline-flex items-center gap-1"
              data-testid={`button-open-learn-from-job-${j.id}`}
            >
              <GraduationCap className="w-3.5 h-3.5" /> Start learning about
            </button>
          )}
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
                    {l.requiredOutput && <p className="text-[11px] text-muted-foreground mt-1">Possible result: {l.requiredOutput}</p>}
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
                      {learnTaskActionLabel(outputState)}
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

function JobCard({ j, truth, tracks, tasks, contacts, learns, recommendations, onAcceptRecommendation, onMove, onRemove }: { j: Job; truth: JobTruthStripT | null; tracks: CareerTrack[]; tasks: Task[]; contacts: Contact[]; learns: Learn[]; recommendations: RecommendationItem[]; onAcceptRecommendation: (rec: RecommendationItem) => Promise<void>; onMove: (j: Job, d: 1 | -1) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const idx = JOB_COLS.findIndex((c) => c.id === j.status);
  const trackId = getTrackId("jobs", j);
  const track = tracks.find((t) => t.id === trackId) || null;
  const linked = useLinkedTaskCount(tasks, "job", j.id);
  const openJobTask = findOpenLinkedTask(tasks, "job", j.id);
  const [open, setOpen] = useState(false);
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const gated = j.eligibilityRisk === "likely_ineligible";
  const windowClosed = j.applicationWindowStatus === "closed" || j.status === "closed";
  const warmSupport = getJobWarmSupport(trackId, contacts, j);
  const supportItems = getJobCapabilitySupportItems(trackId, learns);
  const requiredDomains = track ? requiredDomainsForTrack(track) : [];
  const savedContactRec = visibleTrackRecommendation(recommendations, { trackId, collection: "network-targets" });
  const savedLearningRec = visibleTrackRecommendation(recommendations, { trackId, collection: "learning-corpus" });

  async function createJobNextTask() {
    const r = await mutateAndInvalidate("POST", `/api/jobs/${j.id}/create-next-task`, {}, ["/api/tasks", "/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: r?.reused ? "Already on your list." : "Job task created.",
      description: taskToastDescription(r, "There's already an open task for this role."),
    });
  }

  async function createOutreachTask(c: Contact) {
    const r = await mutateAndInvalidate("POST", `/api/contacts/${c.id}/create-next-task`, {}, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: r?.reused ? "Already on your list." : "Outreach task created.",
      description: taskToastDescription(r, "There's already an open task for this contact."),
    });
  }

  async function createSupportTask(l: Learn) {
    const outputState = getLearnOutputState(l);
    const endpoint = outputState === "reference" ? `/api/learn/${l.id}/create-next-task` : `/api/learn/${l.id}/create-output-task`;
    const r = await mutateAndInvalidate("POST", endpoint, {}, ["/api/tasks", "/api/learn", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: r?.reused ? "Already on your list." : learnTaskCreatedLabel(outputState),
      description: taskToastDescription(r, "There's already an open task for this learning item."),
    });
  }

  function openNetworkIntake() {
    const draft = {
      sector: j.company || "",
      targetOrg: j.company || "",
      targetRole: j.title || "",
      why: `Could help you get closer to ${j.title}${j.company ? ` at ${j.company}` : ""}.`,
      relatedTrackId: trackId,
      askType: truth?.action === "warm" ? "referral" : "advice",
      relationshipStrength: "cold",
      status: "to_contact",
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
  }

  function openLearnIntake() {
    const draft = buildPrepStarterDraft({
      subjectText: `${track?.name || ""} ${j.title} ${j.company || ""}`.trim(),
      relatedTrackId: trackId,
      track,
      noteIntro: `Build familiarity with ${track?.name || "this role type"} while pursuing ${j.title}${j.company ? ` @ ${j.company}` : ""}.`,
      fallbackTitle: `${track?.name || j.title} learning`,
    });
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
  }

  function openRoleSource() {
    if (j.url) window.open(j.url, "_blank", "noopener,noreferrer");
  }

  const primary = (() => {
    if (gated || windowClosed) return null;
    if (j.status === "wishlist") return {
      label: "Mark applied", icon: CheckCircle2,
      run: async () => { await mutateAndInvalidate("POST", `/api/jobs/${j.id}/mark-submitted`, {}, ["/api/jobs", "/api/jobs/truth-strips", "/api/strategy/diagnostics", "/api/strategy/front-door", ...GOAL_SPINE_QUERY_KEYS]); toast({ title: "Marked as applied.", description: "Moved to Applied — nice." }); },
    };
    return {
      label: "Log progress", icon: Trophy,
      run: async () => { await mutateAndInvalidate("POST", "/api/wins", { text: `Applied: ${j.title}${j.company ? " @ " + j.company : ""}`, kind: "source", winCategory: "job_progress" }, ["/api/wins", "/api/stats", "/api/wins/summary"]); toast({ title: "Logged as a win.", description: "Application progress counts." }); },
    };
  })();
  const truthPrimary = (() => {
    if (gated || windowClosed || !truth) return null;
    if (truth.action === "warm") {
      return warmSupport.candidates[0]
        ? { label: "Warm this role", icon: Flame, run: async () => createOutreachTask(warmSupport.candidates[0]) }
        : savedContactRec
          ? { label: "Use saved contact", icon: Users, run: async () => onAcceptRecommendation(savedContactRec) }
          : { label: "Add warm contact", icon: Users, run: async () => openNetworkIntake() };
    }
    if (truth.action === "prove") {
      return supportItems[0]
        ? { label: "Strengthen fit", icon: Hammer, run: async () => createSupportTask(supportItems[0]) }
        : savedLearningRec
          ? { label: "Use saved learning item", icon: GraduationCap, run: async () => onAcceptRecommendation(savedLearningRec) }
          : { label: "Start learning about", icon: GraduationCap, run: async () => openLearnIntake() };
    }
    if (truth.action === "clarify") {
      return j.url
        ? { label: "Clarify role", icon: ExternalLink, run: async () => openRoleSource() }
        : { label: "Clarify role", icon: Compass, run: createJobNextTask };
    }
    if (truth.action === "prepare") return { label: "Create learning task", icon: FileText, run: createJobNextTask };
    if (truth.action === "follow_up") return { label: "Create follow-up task", icon: MessageSquare, run: createJobNextTask };
    if (truth.action === "apply") return { label: "Create application task", icon: CheckCircle2, run: createJobNextTask };
    return null;
  })();
  const effectivePrimary = truthPrimary || (truth ? null : primary);

  return (
    <div className={`group rounded-lg border bg-card p-3 ${gated || windowClosed ? "border-card-border opacity-70" : "border-card-border"}`} data-testid={`job-${j.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm leading-snug">{j.title}</h3>
        <button onClick={onRemove} aria-label="Delete" data-testid={`button-delete-job-${j.id}`} className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {(j.company || j.location) && <p className="text-xs text-muted-foreground mt-0.5">{[j.company, j.location].filter(Boolean).join(" · ")}</p>}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {j.deadline && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${deadlineTone(j.deadline)}`}><CalendarDays className="w-2.5 h-2.5" />{formatDeadline(j.deadline)}</span>}
        {gated && <ConstraintBadge text={`eligibility: ${j.eligibilityRisk}`} tone="warn" />}
        {windowClosed && !gated && <ConstraintBadge text="window closed" />}
      </div>

      {gated ? (
        <p className="text-xs text-muted-foreground mt-2">Probably skip for now: {j.note || "a stretch versus your background"}. Kept for reference.</p>
      ) : windowClosed ? (
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">{j.rejectReason ? `Passed: ${j.rejectReason}` : "Watching for the next cycle."}</p>
          {j.url && <a href={j.url} target="_blank" rel="noopener noreferrer" data-testid={`link-job-${j.id}`} className="text-muted-foreground hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      ) : (
        <>
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

          {open && (
            <div className="mt-3 pt-3 border-t border-card-border space-y-3">
              <ApplicationReadinessBar j={j} expanded={true} />
              {j.note && <p className="text-xs text-muted-foreground leading-snug">{j.note}</p>}
              {j.narrativeAngle && (
                <p className="text-xs text-foreground/80 leading-snug">
                  <span className="font-medium text-muted-foreground">Why you fit: </span>{j.narrativeAngle}
                </p>
              )}
              {j.jdText && (
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <FileText className="w-3 h-3 shrink-0" /> Job description saved. Used for CV suggestions when you work on this application.
                </p>
              )}
              <div className="flex items-center gap-1">
                {idx > 0 && <button onClick={() => onMove(j, -1)} data-testid={`button-job-back-${j.id}`} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">← back</button>}
                {idx < JOB_COLS.length - 1 && <button onClick={() => onMove(j, 1)} data-testid={`button-job-fwd-${j.id}`} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">Move to {JOB_COLS[idx + 1].label} →</button>}
                <button
                  data-testid={`button-job-reject-${j.id}`}
                  onClick={async () => {
                    const reason = window.prompt("Why are you passing on this role? (optional)");
                    if (reason === null) return;
                    await apiRequest("POST", `/api/jobs/${j.id}/reject`, { reason });
                    await mutateAndInvalidate("GET", "", {}, ["/api/jobs", "/api/jobs/truth-strips", "/api/strategy/front-door", ...GOAL_SPINE_QUERY_KEYS]);
                    toast({ title: "Role dismissed.", description: reason ? `Reason: ${reason}` : "Moved to closed." });
                  }}
                  className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-destructive hover-elevate"
                >
                  <Ban className="w-3 h-3 inline mr-0.5" />Not for me
                </button>
              </div>
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
                data-testid={`button-job-details-${j.id}`}
              >
                {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showDetails ? "Hide details" : "See steps, contacts & learning"}
              </button>
              {showDetails && (
                <>
                  <JobStepRail j={j} />
                  <JobWarmPath j={j} trackId={trackId} contacts={contacts} savedContactRec={savedContactRec} onAcceptRecommendation={onAcceptRecommendation} />
                  <JobCapabilitySupport j={j} trackId={trackId} tracks={tracks} learns={learns} truth={truth} savedLearningRec={savedLearningRec} onAcceptRecommendation={onAcceptRecommendation} />
                </>
              )}
              <CardActions entity="jobs" id={j.id} trackId={trackId} tracks={tracks}
                nextTaskHint={taskPreviewHint(nextJobTaskTitle(j), openJobTask?.title)}
                onViewTasks={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : noLinkedTasksHelp(taskActionLabelForEntity("jobs")) })} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function JobsView() {
  const { toast } = useToast();
  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: learns = [] } = useQuery<Learn[]>({ queryKey: ["/api/learn"] });
  const { data: recommendations = [] } = useRecommendations<RecommendationItem[]>();
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
    await mutateAndInvalidate("POST", "/api/jobs", { ...form, status: "wishlist", flag: "" }, ["/api/jobs", "/api/jobs/truth-strips", ...GOAL_SPINE_QUERY_KEYS]);
    toast({
      title: "Role saved.",
      description: "It stays in Jobs for now. Use the readiness rail when you decide to work this one.",
    });
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
    if (next) await mutateAndInvalidate("PATCH", `/api/jobs/${j.id}`, { status: next.id }, ["/api/jobs", "/api/jobs/truth-strips", ...GOAL_SPINE_QUERY_KEYS]);
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/jobs/${id}`, undefined, ["/api/jobs", "/api/jobs/truth-strips", ...GOAL_SPINE_QUERY_KEYS]); }
  async function acceptRecommendation(rec: RecommendationItem) {
    const entityType = rec.collection === "network-targets" ? "contact" : "learn";
    await mutateAndInvalidate("POST", `/api/recommendations/${rec.id}/accept`, { entityType }, [
      "/api/recommendations",
      "/api/contacts",
      "/api/learn",
      "/api/tasks",
      "/api/jobs",
      "/api/strategy",
      "/api/strategy/front-door",
      "/api/strategy/diagnostics",
      ...GOAL_SPINE_QUERY_KEYS,
    ]);
    toast({
      title: entityType === "contact" ? "Added to your network." : "Added to your learning list.",
      description: entityType === "contact" ? "This should make it easier to move the role with a real person who can help." : "This gives the role focused learning support instead of a blank starter.",
    });
  }

  const fellowships = jobs.filter(isFellowship).sort(sortJobs);
  const roles = jobs.filter((j) => !isFellowship(j));

  const grouped = JOB_COLS.map((col) => ({ col, items: roles.filter((j) => j.status === col.id).sort(sortJobs) }));
  const active = grouped.filter((g) => g.items.length > 0 || g.col.id === "wishlist");
  const empty = grouped.filter((g) => g.items.length === 0 && g.col.id !== "wishlist");

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
      {activeGoal && <BroadPursuitJobsKickoff goal={activeGoal} onStartLane={startLaneRole} />}
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 space-y-3">
          {selectedLane && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2" data-testid="job-form-lane-banner">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Role type</p>
                <p className="text-sm font-medium">{displayCombinationLabel(selectedLane)}</p>
                {selectedLaneGuide && <p className="text-xs text-muted-foreground mt-0.5">{selectedLaneGuide.fitHint}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedLane(""); setForm((c) => ({ ...c, roleArchetype: "", narrativeAngle: "", note: "", nextStep: "", relatedTrackId: null })); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0" data-testid="button-clear-job-lane">Clear</button>
            </div>
          )}
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
          <button type="button" onClick={() => setShowMoreJobFields((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreJobFields ? "rotate-180" : ""}`} />
            {showMoreJobFields ? "Fewer options" : "More options (deadline, role shape, notes)"}
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
                      {items.map((j) => <JobCard key={j.id} j={j} truth={truthById.get(j.id) || null} tracks={tracks} tasks={tasks} contacts={contacts} learns={learns} recommendations={recommendations} onAcceptRecommendation={acceptRecommendation} onMove={move} onRemove={() => remove(j.id)} />)}
                      {items.length === 0 && col.id === "wishlist" && (
                        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                          <p className="text-sm text-muted-foreground">No roles yet - add one above or start from one of the suggested role types.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          )}
          {fellowships.length > 0 && (
            <div className="mt-8" data-testid="fellowships-lane">
              <SectionHeading title="Fellowships" sub="Opportunities you apply to. Closed ones are kept to watch for next cycle." />
              {openFellowships.length > 0 && (
                <div className="mb-4">
                  <GroupLabel count={openFellowships.length}><Compass className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Open / apply now</GroupLabel>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {openFellowships.map((j) => <JobCard key={j.id} j={j} truth={truthById.get(j.id) || null} tracks={tracks} tasks={tasks} contacts={contacts} learns={learns} recommendations={recommendations} onAcceptRecommendation={acceptRecommendation} onMove={move} onRemove={() => remove(j.id)} />)}
                  </div>
                </div>
              )}
              {watchFellowships.length > 0 && (
                <div>
                  <GroupLabel count={watchFellowships.length}><CalendarDays className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Watch / closed for 2026</GroupLabel>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {watchFellowships.map((j) => <JobCard key={j.id} j={j} truth={truthById.get(j.id) || null} tracks={tracks} tasks={tasks} contacts={contacts} learns={learns} recommendations={recommendations} onAcceptRecommendation={acceptRecommendation} onMove={move} onRemove={() => remove(j.id)} />)}
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
