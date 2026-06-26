import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Layers, Loader2, Plus, Sparkles, Wand2, X } from "lucide-react";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/home/SectionHeading";
import { Loading } from "@/components/home/Loading";
import { Empty } from "@/components/home/Empty";
import { WorkPreviewPanel, type WorkPreviewResponse } from "@/components/home/WorkPreviewPanel";
import type { Task } from "@shared/schema";

type CaptureSug = { id: number; route: string; label: string; reason: string; confidence: string; question?: string };

const ROUTE_ACTION_LABEL: Record<string, string> = {
  today: "Do today",
  task: "Keep as task",
  subtask: "Link to existing work",
  job: "File under Jobs",
  learn: "File under Learning",
  network: "File under Network",
  proof: "File under Projects",
  deadline: "Add a deadline",
  blocker: "Flag as blocked",
  decision: "Define the decision",
  research: "Understand and plan",
  note: "Save as a note",
  duplicate: "Already captured",
  parking_lot: "Park for later",
  keep: "Keep here",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "clear match",
  medium: "probably right",
  low: "needs a quick check",
};

const BROAD_WORK_RE = /^(?:please\s+)?(?:research|investigate|look\s+into|find\s+out\s+about|explore|understand|prepare|review|work\s+on|improve|fix|sort\s+out|think\s+about|plan|figure\s+out|develop|build|create|draft|write|organize|organise|update|launch|set\s+up)\b/i;

function needsWorkPreview(task: Task, route?: string) {
  if (route === "research" || route === "decision" || route === "subtask") return true;
  if (route === "proof" && BROAD_WORK_RE.test(task.title)) return true;
  return BROAD_WORK_RE.test(task.title) && ["task", "keep", undefined].includes(route);
}

export default function BrainDumpView() {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [captureNote, setCaptureNote] = useState("");
  const [sorting, setSorting] = useState(false);
  const [suggestingId, setSuggestingId] = useState<number | null>(null);
  const [planningId, setPlanningId] = useState<number | null>(null);
  const [triage, setTriage] = useState<Record<number, CaptureSug>>({});
  const [workPreviews, setWorkPreviews] = useState<Record<number, WorkPreviewResponse>>({});
  const { toast } = useToast();
  const inbox = tasks.filter((task) => task.list === "inbox");

  const autoSorted = useRef(false);
  useEffect(() => {
    if (isLoading || autoSorted.current) return;
    autoSorted.current = true;
    if (inbox.length > 0 && !sorting && Object.keys(triage).length === 0) {
      void sortAll();
    }
  }, [inbox.length, isLoading]);

  async function add() {
    const value = text.trim();
    if (!value || adding) return;
    setAdding(true);
    setCaptureNote("");
    setText("");
    try {
      await mutateAndInvalidate("POST", "/api/tasks", { title: value, list: "inbox", done: false }, ["/api/tasks"]);
      setCaptureNote("Captured. You can leave it here until you're ready to sort it.");
      toast({ title: "Captured.", description: "It's out of your head. You can sort it later." });
    } catch {
      setText(value);
      toast({ title: "Couldn't capture that", description: "Your text is still in the box — try submitting again." });
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: number) {
    await mutateAndInvalidate("DELETE", `/api/tasks/${id}`, undefined, ["/api/tasks"]);
    setWorkPreviews((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  async function sortAll() {
    setSorting(true);
    try {
      const response = await apiRequest("POST", "/api/capture/sort");
      const data = await response.json();
      const map: Record<number, CaptureSug> = {};
      (data?.suggestions || []).forEach((suggestion: CaptureSug) => { map[suggestion.id] = suggestion; });
      setTriage(map);
    } catch {
      toast({ title: "Couldn't sort right now", description: "Hit 'Sort all' again — it usually works on a second try." });
    } finally {
      setSorting(false);
    }
  }

  async function suggestOne(taskId: number) {
    setSuggestingId(taskId);
    try {
      const response = await apiRequest("POST", `/api/capture/${taskId}/suggest`);
      const data = await response.json();
      if (data?.suggestion) {
        setTriage((current) => ({ ...current, [taskId]: data.suggestion as CaptureSug }));
      }
    } catch {
      toast({ title: "Couldn't work that one out", description: "Edit the title to be clearer, then try sorting again." });
    } finally {
      setSuggestingId((current) => (current === taskId ? null : current));
    }
  }

  async function interpretWork(task: Task) {
    if (planningId === task.id) return;
    setPlanningId(task.id);
    try {
      const response = await apiRequest("POST", "/api/work/interpret", {
        title: task.title,
        sourceType: "task",
        sourceId: task.id,
        sourceNote: task.sourceNote,
        doneWhen: task.doneWhen,
        minimumOutcome: task.minimumOutcome,
        steps: task.steps,
        relatedTrackId: task.relatedTrackId,
        refine: true,
      });
      const preview = await response.json();
      if (!preview?.definition) throw new Error("No work definition was returned");
      setWorkPreviews((current) => ({ ...current, [task.id]: preview as WorkPreviewResponse }));
    } catch (error: any) {
      toast({ title: "Couldn't understand that work", description: error?.message || "The capture is still safe in your inbox." });
    } finally {
      setPlanningId((current) => current === task.id ? null : current);
    }
  }

  async function applyRoute(task: Task, route: string, label = "Done") {
    if (needsWorkPreview(task, route)) {
      await interpretWork(task);
      return;
    }
    await mutateAndInvalidate(
      "POST",
      `/api/capture/${task.id}/route`,
      { route },
      ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles", "/api/contacts", "/api/plan/current", ...GOAL_SPINE_QUERY_KEYS],
    );
    setTriage((current) => { const next = { ...current }; delete next[task.id]; return next; });
    toast({ title: label });
  }

  async function acceptAll() {
    const actionable = inbox.filter((task) => {
      const suggestion = triage[task.id];
      return suggestion && suggestion.route !== "keep" && !needsWorkPreview(task, suggestion.route);
    });
    if (!actionable.length) {
      toast({ title: "Project-shaped items need review", description: "Use Understand and plan so Anchor can show the project or task before creating work." });
      return;
    }
    await Promise.all(actionable.map((task) => mutateAndInvalidate(
      "POST",
      `/api/capture/${task.id}/route`,
      { route: triage[task.id].route },
      ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles", "/api/contacts", "/api/plan/current", ...GOAL_SPINE_QUERY_KEYS],
    )));
    setTriage((current) => {
      const next = { ...current };
      actionable.forEach((task) => { delete next[task.id]; });
      return next;
    });
    toast({ title: `Filed ${actionable.length} item${actionable.length > 1 ? "s" : ""}`, description: "Items that may be projects were left for your review." });
  }

  function clearWorkPreview(taskId: number) {
    setWorkPreviews((current) => { const next = { ...current }; delete next[taskId]; return next; });
  }

  function resolveWorkPreview(taskId: number) {
    clearWorkPreview(taskId);
    setTriage((current) => { const next = { ...current }; delete next[taskId]; return next; });
  }

  return (
    <div>
      <SectionHeading title="Capture" sub="Empty your head now. Sort it later." />
      <div className="mb-4 rounded-xl border border-card-border bg-card p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={text}
            onChange={(event) => { setText(event.target.value); if (captureNote) setCaptureNote(""); }}
            onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
            placeholder="Get a thought out of your head..."
            className="h-11 min-w-0 sm:flex-1"
            data-testid="input-braindump"
            disabled={adding}
          />
          <Button className="h-11 w-full px-4 sm:w-auto sm:shrink-0" onClick={add} data-testid="button-add-braindump" disabled={adding || !text.trim()}>
            {adding ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            {adding ? "Saving..." : "Capture"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">This is a holding area. Nothing here becomes a project or lands on today's plan without your confirmation.</p>
          {captureNote ? <span className="text-xs text-primary" data-testid="text-braindump-capture-note">{captureNote}</span> : null}
        </div>
      </div>

      {inbox.length > 0 && (
        <div className="mb-5 flex flex-wrap items-start gap-3">
          {sorting ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> I'll identify what each capture probably is. Project-shaped work will still wait for your review.
            </p>
          ) : Object.keys(triage).length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {inbox.some((task) => triage[task.id] && triage[task.id].route !== "keep" && !needsWorkPreview(task, triage[task.id].route)) && (
                <Button variant="default" size="sm" onClick={acceptAll} data-testid="button-accept-all-braindump" className="inline-flex items-center gap-1.5">
                  <ArrowRight className="h-4 w-4" /> Accept straightforward suggestions
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={sortAll} data-testid="button-sort-braindump" className="inline-flex items-center gap-1.5">
                <Wand2 className="h-4 w-4" /> Re-sort
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={sortAll} data-testid="button-sort-braindump" className="inline-flex items-center gap-1.5">
              <Wand2 className="h-4 w-4" /> Sort these for me
            </Button>
          )}
        </div>
      )}

      {isLoading ? <Loading /> : inbox.length === 0 ? (
        <Empty icon={Sparkles} text="Empty head, clear mind. Add a thought above when one shows up." />
      ) : (
        <div className="space-y-2">
          {inbox.map((task) => {
            const suggestion = triage[task.id];
            const preview = workPreviews[task.id];
            return (
              <div key={task.id} className="group rounded-lg border border-card-border bg-card px-3 py-2.5" data-testid={`braindump-${task.id}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{task.title}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {!suggestion && !preview && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => suggestOne(task.id)}
                        data-testid={`button-route-braindump-${task.id}`}
                        disabled={suggestingId === task.id}
                      >
                        {suggestingId === task.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRight className="mr-1 h-3 w-3" />}
                        {suggestingId === task.id ? "Thinking..." : "Suggest"}
                      </Button>
                    )}
                    {!preview && BROAD_WORK_RE.test(task.title) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => interpretWork(task)}
                        data-testid={`button-understand-work-${task.id}`}
                        disabled={planningId === task.id}
                      >
                        {planningId === task.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Layers className="mr-1 h-3 w-3" />}
                        {planningId === task.id ? "Understanding..." : "Plan work"}
                      </Button>
                    )}
                    {!suggestion && !preview && !BROAD_WORK_RE.test(task.title) && (
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => applyRoute(task, "today", "Added to today")} data-testid={`button-addday-${task.id}`}>Add to day</Button>
                    )}
                    <button onClick={() => remove(task.id)} aria-label="Delete" data-testid={`button-delete-braindump-${task.id}`} className="ml-0.5 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                  </div>
                </div>

                {suggestion && !preview && (
                  <div className="mt-2 border-t border-card-border pt-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{suggestion.label}</span>
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{CONFIDENCE_LABEL[suggestion.confidence] || suggestion.confidence}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{suggestion.reason || suggestion.label}</p>
                    {suggestion.question && <p className="mt-1 text-xs text-foreground/80">{suggestion.question}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {suggestion.route !== "keep" && (
                        <button
                          onClick={() => applyRoute(task, suggestion.route, ROUTE_ACTION_LABEL[suggestion.route] || "Filed")}
                          data-testid={`button-triage-accept-${task.id}`}
                          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover-elevate"
                        >
                          {planningId === task.id ? <Loader2 className="h-3 w-3 animate-spin" /> : needsWorkPreview(task, suggestion.route) ? <Layers className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                          {planningId === task.id ? "Understanding..." : ROUTE_ACTION_LABEL[suggestion.route] || "File it"}
                        </button>
                      )}
                      {!needsWorkPreview(task, suggestion.route) && suggestion.route !== "today" && (
                        <button onClick={() => applyRoute(task, "today", "Added to today")} data-testid={`button-triage-today-${task.id}`} className="text-xs text-muted-foreground hover:text-foreground">or put it on today's plan</button>
                      )}
                      <button onClick={() => setTriage((current) => { const next = { ...current }; delete next[task.id]; return next; })} data-testid={`button-triage-dismiss-${task.id}`} className="text-xs text-muted-foreground hover:text-foreground">leave it here for now</button>
                    </div>
                  </div>
                )}

                {preview && (
                  <WorkPreviewPanel
                    task={task}
                    preview={preview}
                    onPreviewChange={(next) => setWorkPreviews((current) => ({ ...current, [task.id]: next }))}
                    onClose={() => clearWorkPreview(task.id)}
                    onResolved={() => resolveWorkPreview(task.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
