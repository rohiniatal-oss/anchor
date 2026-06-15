import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/home/Empty";
import { Loading } from "@/components/home/Loading";
import { SectionHeading } from "@/components/home/SectionHeading";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";

type CaptureSug = { id: number; route: string; label: string; reason: string; confidence: string; question?: string };

const ROUTE_ACTION_LABEL: Record<string, string> = {
  today: "Do today",
  task: "Keep as task",
  job: "File under Jobs",
  learn: "File under Learn",
  network: "File under Network",
  proof: "File as Proof asset",
  decision: "Needs a decision",
  keep: "Keep here",
};

export default function BrainDumpView() {
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

  async function remove(id: number) {
    await mutateAndInvalidate("DELETE", `/api/tasks/${id}`, undefined, ["/api/tasks"]);
  }

  async function sortAll() {
    setSorting(true);
    try {
      const r = await apiRequest("POST", "/api/capture/sort");
      const data = await r.json();
      const map: Record<number, CaptureSug> = {};
      (data?.suggestions || []).forEach((sg: CaptureSug) => {
        map[sg.id] = sg;
      });
      setTriage(map);
    } catch {
      toast({ title: "Couldn't sort right now", description: "Give it another go in a moment." });
    } finally {
      setSorting(false);
    }
  }

  async function applyRoute(t: Task, route: string, label = "Done") {
    await mutateAndInvalidate("POST", `/api/capture/${t.id}/route`, { route }, ["/api/tasks", "/api/jobs", "/api/learn", "/api/hustles", "/api/contacts", "/api/plan/current"]);
    setTriage((st) => {
      const n = { ...st };
      delete n[t.id];
      return n;
    });
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
