import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Sparkles, Wand2, X } from "lucide-react";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/home/SectionHeading";
import { Loading } from "@/components/home/Loading";
import { Empty } from "@/components/home/Empty";
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
  decision: "Needs a decision",
  research: "Explore this",
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

export default function BrainDumpView() {
  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [captureNote, setCaptureNote] = useState("");
  const [sorting, setSorting] = useState(false);
  const [suggestingId, setSuggestingId] = useState<number | null>(null);
  const [triage, setTriage] = useState<Record<number, CaptureSug>>({});
  const { toast } = useToast();
  const inbox = tasks.filter((t) => t.list === "inbox");

  const autoSorted = useRef(false);
  useEffect(() => {
    if (isLoading || autoSorted.current) return;
    autoSorted.current = true;
    if (inbox.length > 0 && !sorting && Object.keys(triage).length === 0) {
      sortAll();
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
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/tasks/${id}`, undefined, ["/api/tasks"]); }

  async function sortAll() {
    setSorting(true);
    try {
      const r = await apiRequest("POST", "/api/capture/sort");
      const data = await r.json();
      const map: Record<number, CaptureSug> = {};
      (data?.suggestions || []).forEach((sg: CaptureSug) => { map[sg.id] = sg; });
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
      const r = await apiRequest("POST", `/api/capture/${taskId}/suggest`);
      const data = await r.json();
      if (data?.suggestion) {
        setTriage((current) => ({ ...current, [taskId]: data.suggestion as CaptureSug }));
      }
    } catch {
      toast({ title: "Couldn't work that one out", description: "Edit the title to be clearer, then try sorting again." });
    } finally {
      setSuggestingId((current) => (current === taskId ? null : current));
    }
  }

  async function applyRoute(t: Task, route: string, label = "Done") {
    await mutateAndInvalidate("POST", `/api/capture/${t.id}/route`, { route }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles", "/api/contacts", "/api/plan/current", ...GOAL_SPINE_QUERY_KEYS]);
    setTriage((st) => { const n = { ...st }; delete n[t.id]; return n; });
    toast({ title: label });
  }

  async function acceptAll() {
    const actionable = inbox.filter((t) => triage[t.id] && triage[t.id].route !== "keep");
    if (!actionable.length) return;
    await Promise.all(actionable.map((t) => mutateAndInvalidate("POST", `/api/capture/${t.id}/route`, { route: triage[t.id].route }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles", "/api/contacts", "/api/plan/current", ...GOAL_SPINE_QUERY_KEYS])));
    setTriage({});
    toast({ title: `Filed ${actionable.length} item${actionable.length > 1 ? "s" : ""}`, description: "All sorted items filed." });
  }

  return (
    <div>
      <SectionHeading title="Capture" sub="Empty your head now. Sort it later." />
      <div className="mb-4 rounded-xl border border-card-border bg-card p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={text}
            onChange={(e) => { setText(e.target.value); if (captureNote) setCaptureNote(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Get a thought out of your head..."
            className="h-11 min-w-0 sm:flex-1"
            data-testid="input-braindump"
            disabled={adding}
          />
          <Button className="h-11 w-full px-4 sm:w-auto sm:shrink-0" onClick={add} data-testid="button-add-braindump" disabled={adding || !text.trim()}>
            {adding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
            {adding ? "Saving..." : "Capture"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            This is a holding area. Nothing here lands on today's plan unless you choose it.
          </p>
          {captureNote ? (
            <span className="text-xs text-primary" data-testid="text-braindump-capture-note">{captureNote}</span>
          ) : null}
        </div>
      </div>
      {inbox.length > 0 && (
        <div className="mb-5 flex flex-wrap items-start gap-3">
          {sorting ? (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> I'll work out what each one probably is: something to do today, a learning item, part of something you've already saved, or just a note.
            </p>
          ) : Object.keys(triage).length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {inbox.some((t) => triage[t.id] && triage[t.id].route !== "keep") && (
                <Button variant="default" size="sm" onClick={acceptAll} data-testid="button-accept-all-braindump" className="inline-flex items-center gap-1.5">
                  <ArrowRight className="w-4 h-4" />
                  Accept all suggestions
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={sortAll} data-testid="button-sort-braindump" className="inline-flex items-center gap-1.5">
                <Wand2 className="w-4 h-4" /> Re-sort
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={sortAll} data-testid="button-sort-braindump" className="inline-flex items-center gap-1.5">
              <Wand2 className="w-4 h-4" /> Sort these for me
            </Button>
          )}
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
                    {!tr && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => suggestOne(t.id)}
                        data-testid={`button-route-braindump-${t.id}`}
                        disabled={suggestingId === t.id}
                      >
                        {suggestingId === t.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowRight className="w-3 h-3 mr-1" />}
                        {suggestingId === t.id ? "Thinking..." : "Suggest"}
                      </Button>
                    )}
                    {!tr && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => applyRoute(t, "today", "Added to today")} data-testid={`button-addday-${t.id}`}>Add to day</Button>}
                    <button onClick={() => remove(t.id)} aria-label="Delete" data-testid={`button-delete-braindump-${t.id}`} className="text-muted-foreground hover:text-destructive ml-0.5"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                {tr && (
                  <div className="mt-2 pt-2 border-t border-card-border">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {tr.label}
                      </span>
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {CONFIDENCE_LABEL[tr.confidence] || tr.confidence}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{tr.reason || tr.label}</p>
                    {tr.question && (
                      <p className="text-xs text-foreground/80 mt-1">{tr.question}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {tr.route !== "keep" && (
                        <button
                          onClick={() => applyRoute(t, tr.route, `${ROUTE_ACTION_LABEL[tr.route] || "Filed"}`)}
                          data-testid={`button-triage-accept-${t.id}`}
                          className="text-xs font-medium text-primary inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 hover-elevate"
                        >
                          <ArrowRight className="w-3 h-3" /> {ROUTE_ACTION_LABEL[tr.route] || "File it"}
                        </button>
                      )}
                      {tr.route !== "today" && (
                        <button onClick={() => applyRoute(t, "today", "Added to today")} data-testid={`button-triage-today-${t.id}`} className="text-xs text-muted-foreground hover:text-foreground">or put it on today's plan</button>
                      )}
                      <button onClick={() => setTriage((s) => { const n = { ...s }; delete n[t.id]; return n; })} data-testid={`button-triage-dismiss-${t.id}`} className="text-xs text-muted-foreground hover:text-foreground">leave it here for now</button>
                    </div>
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
