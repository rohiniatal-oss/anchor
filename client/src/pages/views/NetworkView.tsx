import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Flame,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { ConstraintBadge } from "@/components/home/ConstraintBadge";
import { Empty } from "@/components/home/Empty";
import { LinkTrackControl } from "@/components/home/LinkTrackControl";
import { Loading } from "@/components/home/Loading";
import { SectionHeading } from "@/components/home/SectionHeading";
import { TrackChip } from "@/components/home/TrackChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { useLinkedTaskCount } from "@/lib/homeHelpers";
import { daysUntil, formatDeadline, GOAL_SPINE_QUERY_KEYS, PENDING_CONTACT_DRAFT_KEY, takeHashDraft, takeIntakeDraft } from "@/lib/homeTypes";
import { GoalPortfolioItemT, GoalsStateResponseT } from "@/lib/goalSpine";
import { BroadPursuitParallelSupportKickoff, ContactFormT, contactPresetForLane, laneGuideForCombination, ViewSpineCallout } from "@/lib/parallelPursuit";
import { ALL_LANE_KEYS, laneForSourceNetwork, laneLabel, NETWORK_LANES } from "@shared/networkLanes";
import type { CareerTrack, Contact, Task } from "@shared/schema";
import { getRelationshipStrength, getTrackId } from "@shared/domainState";

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

function isFollowUpOverdue(c: Contact): boolean {
  const d = daysUntil(c.nextFollowUpDate || "");
  return d !== null && d < 0;
}

export default function NetworkView() {
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
  function resetForm() {
    setForm(EMPTY_CONTACT_FORM);
    setSelectedLane("");
    setShowForm(false);
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

  const byLane = new Map<string, Contact[]>(ALL_LANE_KEYS.map((k) => [k, []]));
  for (const c of contacts) byLane.get(laneForSourceNetwork(c.sourceNetwork))!.push(c);
  const populatedLaneKeys = ALL_LANE_KEYS.filter((k) => byLane.get(k)!.length > 0);
  const quietLaneKeys = NETWORK_LANES
    .map((lane) => lane.key)
    .filter((key) => byLane.get(key)!.length === 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Network" sub="People to reach, by warmth. Each card leads with the ask." />
        <Button onClick={() => showForm ? setShowForm(false) : startBlankContact()} className="shrink-0" data-testid="button-toggle-contact-form"><Plus className="w-4 h-4 mr-1" /> Add contact</Button>
      </div>
      {activeGoal && !(contacts.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="network" goal={activeGoal} />}
      {activeGoal && contacts.length === 0 && <BroadPursuitParallelSupportKickoff goal={activeGoal} mode="network" onStartLane={startLaneContact} />}

      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 grid gap-2 sm:grid-cols-2" data-testid="contact-intake-form">
          {selectedLane && (
            <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" data-testid="contact-form-lane-banner">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Supporting lane</p>
                  <p className="text-sm font-medium">{selectedLane}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLane("");
                    setForm((current) => ({ ...current, sector: "", why: "", targetRole: "", relatedTrackId: null }));
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-contact-lane"
                >
                  Clear lane
                </button>
              </div>
              {selectedLaneGuide && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-card-border bg-card/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why this contact helps</p>
                    <p className="mt-1 text-xs text-foreground">{selectedLaneGuide.fitHint}</p>
                  </div>
                  <div className="rounded-md border border-card-border bg-card/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Best first ask</p>
                    <p className="mt-1 text-xs text-foreground">Start with advice or a reconnect unless you already have enough warmth for a referral ask.</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <Input placeholder="Who they are *" value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} data-testid="input-contact-who" />
          <Input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-contact-name-new" />
          <Input placeholder="Sector / lane" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} data-testid="input-contact-sector" />
          <Input placeholder="Target org" value={form.targetOrg} onChange={(e) => setForm({ ...form, targetOrg: e.target.value })} data-testid="input-contact-target-org" />
          <Input placeholder="Target role" value={form.targetRole} onChange={(e) => setForm({ ...form, targetRole: e.target.value })} data-testid="input-contact-target-role" />
          <Input placeholder="Follow up date (YYYY-MM-DD)" value={form.nextFollowUpDate} onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })} data-testid="input-contact-follow-up" />
          <Input placeholder="Why this person matters" value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} className="sm:col-span-2" data-testid="input-contact-why" />
          <Input placeholder="Warm lane / network source" value={form.sourceNetwork} onChange={(e) => setForm({ ...form, sourceNetwork: e.target.value })} className="sm:col-span-2" data-testid="input-contact-source-network" />

          <div className="sm:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Ask type</p>
            <div className="flex flex-wrap gap-1.5">
              {ASK_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm({ ...form, askType: option.value })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.askType === option.value ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                  data-testid={`button-contact-ask-${option.value}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Relationship strength</p>
            <div className="flex flex-wrap gap-1.5">
              {RELATIONSHIP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm({ ...form, relationshipStrength: option.value })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.relationshipStrength === option.value ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                  data-testid={`button-contact-strength-${option.value}`}
                >
                  {option.label}
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
                  data-testid="button-contact-track-none"
                >
                  Leave unlinked
                </button>
                {tracks.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setForm({ ...form, relatedTrackId: track.id })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}
                    data-testid={`button-contact-track-${track.id}`}
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

          <Input placeholder="Message draft (optional)" value={form.messageDraft} onChange={(e) => setForm({ ...form, messageDraft: e.target.value })} className="sm:col-span-2" data-testid="input-contact-message-draft" />
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            <Button onClick={addContact} data-testid="button-save-contact">Save contact</Button>
          </div>
        </div>
      )}

      {(sugLoading || sug) && (
        <div className="mb-6 rounded-xl border border-slate-300/60 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/40 p-4" data-testid="network-suggestion">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-2">
            <Lightbulb className="w-4 h-4" /> Who to reach next
          </div>
          {sugLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Thinking about your warm routes...</div>
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
        <div className="space-y-5">
          {populatedLaneKeys.map((key) => {
            const items = byLane.get(key)!;
            const overdue = items.filter(isFollowUpOverdue).length;
            return (
              <div key={key} className="rounded-xl border border-border bg-muted/30 p-3" data-testid={`lane-${key}`}>
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <h2 className="font-semibold text-sm flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" /> {laneLabel(key)}
                  </h2>
                  <div className="flex items-center gap-2">
                    {overdue > 0 && <span className="text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5">{overdue} overdue</span>}
                    <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                  </div>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-1">No one in this lane yet.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((c) => <ContactCard key={c.id} c={c} tracks={tracks} tasks={tasks} onPatch={patch} onRemove={() => remove(c.id)} />)}
                  </div>
                )}
              </div>
            );
          })}

          {quietLaneKeys.length > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card/60 p-4" data-testid="quiet-network-lanes">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h2 className="font-semibold text-sm">Later</h2>
                <span className="text-xs text-muted-foreground">{quietLaneKeys.length} empty</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Optional routes to warm later. They do not need attention before your live contacts.
              </p>
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

      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {(c.targetOrg || c.targetRole) && <span className="inline-flex items-center text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{[c.targetRole, c.targetOrg].filter(Boolean).join(" · ")}</span>}
        {c.nextFollowUpDate && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${overdue ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}><CalendarDays className="w-2.5 h-2.5" /> {formatDeadline(c.nextFollowUpDate)}</span>}
      </div>

      {c.why && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{c.why}</p>}

      <input
        value={name}
        onChange={(e) => setNameLocal(e.target.value)}
        onBlur={() => name !== c.name && onPatch(c, { name })}
        placeholder="Name (optional)"
        data-testid={`input-contact-name-${c.id}`}
        className="mt-1 w-full text-[11px] text-muted-foreground bg-transparent border-b border-input/60 pb-1 focus:outline-none focus:border-primary"
      />

      {draftOpen && (
        <div className="mt-2" data-testid={`draft-editor-${c.id}`}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
            placeholder="Draft your outreach message..." data-testid={`textarea-draft-${c.id}`}
            className="w-full text-xs bg-background border border-input rounded-md p-2 focus:outline-none focus:border-primary" />
          <div className="flex items-center gap-2 mt-1.5">
            <Button size="sm" className="h-7 px-2 text-xs" onClick={saveDraft} disabled={savingDraft} data-testid={`button-save-draft-${c.id}`}>
              {savingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save draft"}
            </Button>
            <button onClick={() => { setDraft(c.messageDraft || ""); setDraftOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground">cancel</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onPatch(c, { status: OUTREACH_COLS[idx - 1].id })} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate" data-testid={`button-contact-back-${c.id}`}>←</button>}
        {idx < OUTREACH_COLS.length - 1 && <button onClick={() => onPatch(c, { status: OUTREACH_COLS[idx + 1].id })} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate" data-testid={`button-contact-fwd-${c.id}`}>{OUTREACH_COLS[idx + 1].label} →</button>}
      </div>

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
