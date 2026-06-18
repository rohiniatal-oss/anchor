import { useEffect, useState } from "react";
import { Compass, Loader2, Plus, Sparkles, Users, BookOpen, FileText, Briefcase, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";

type StrategyBuild = {
  headline: string;
  roleArchetypes?: Array<{
    archetype: string;
    priority: string;
    fitLogic: string;
    credibilityGap: string;
    capabilitySignal: string;
    peopleToFind: string[];
    resourceNeed: string;
    nextExperiment: string;
  }>;
  peopleMap?: Array<{ category: string; why: string; ask: string; linkedArchetype: string }>;
  resourceMap?: Array<{ category: string; why: string; output: string; linkedArchetype: string }>;
  exampleProjectIdeas?: Array<{ need: string; asset: string; doneWhen: string; linkedArchetype: string }>;
  planShifts?: Array<{ action: string; target: string; reason: string }>;
  weeklyShape?: Record<string, number>;
};

async function post(path: string, body: any, extraKeys: string[] = []) {
  const res = await apiRequest("POST", path, body);
  const json = await res.json();
  const keys = [...GOAL_SPINE_QUERY_KEYS, ...extraKeys];
  await Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  return json;
}

function Chip({ children }: { children: any }) {
  return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{children}</span>;
}

function priorityLabel(priority: string) {
  if (priority === "convert") return "pursue now";
  if (priority === "explore") return "test";
  if (priority === "watch") return "later";
  if (priority === "pause") return "pause";
  return priority;
}

function AcceptButton({ onClick, label = "Accept" }: { onClick: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function go() {
    setBusy(true);
    try { await onClick(); setDone(true); }
    finally { setBusy(false); }
  }
  return (
    <button onClick={go} disabled={busy || done}
      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-60">
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {done ? "Added" : label}
    </button>
  );
}

export function StrategyBuilderPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<StrategyBuild | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await apiRequest("GET", "/api/strategy-builder");
      setData(await res.json());
    } catch {
      setError("Could not build the strategy plan right now.");
    } finally { setLoading(false); }
  }

  useEffect(() => { if (open && !data && !loading) load(); }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="button-open-strategy-builder"
        className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card/95 px-4 py-2 text-sm font-semibold text-primary shadow-lg backdrop-blur hover:bg-primary/10"
      >
        <Compass className="h-4 w-4" /> Strategic plan
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] bg-background/80 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-5">
            <div className="rounded-2xl border border-card-border bg-card shadow-xl overflow-hidden flex min-h-0 flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-card-border p-4">
                <div>
                  <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><Sparkles className="h-4 w-4" /> Strategy Builder</div>
                  <h2 className="mt-1 text-lg font-bold tracking-tight">What Anchor recommends next</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Suggested role types, people to reach out to, learning items to add, and optional writing, project, or brand ideas. Nothing is added unless you accept it.</p>
                </div>
                <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Building strategy...</div>}
                {error && <p className="text-sm text-destructive">{error}</p>}
                {data && (
                  <div className="space-y-5">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <p className="text-sm font-medium leading-snug">{data.headline}</p>
                      {data.weeklyShape && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {Object.entries(data.weeklyShape).map(([k, v]) => <Chip key={k}>{k} {v}%</Chip>)}
                        </div>
                      )}
                    </div>

                    <section>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Briefcase className="h-4 w-4 text-primary" /> Role types to test or pursue</h3>
                      <div className="space-y-2">
                        {(data.roleArchetypes || []).slice(0, 4).map((r) => (
                          <div key={r.archetype} className="rounded-xl border border-card-border bg-background/40 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{r.archetype}</p><Chip>{priorityLabel(r.priority)}</Chip></div>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Why it fits:</span> {r.fitLogic}</p>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Where to grow:</span> {r.credibilityGap}</p>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Useful learning:</span> {r.capabilitySignal}</p>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Next test:</span> {r.nextExperiment}</p>
                              </div>
                              <AcceptButton label="Add role type" onClick={() => post("/api/strategy-builder/accept-role", r, ["/api/career-tracks", "/api/tasks"])} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-primary" /> People to find</h3>
                      <div className="space-y-2">
                        {(data.peopleMap || []).slice(0, 5).map((p) => (
                          <div key={`${p.category}-${p.linkedArchetype}`} className="rounded-xl border border-card-border bg-background/40 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">{p.category}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{p.why}</p>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Ask:</span> {p.ask}</p>
                              </div>
                              <AcceptButton label="Add person type" onClick={() => post("/api/strategy-builder/accept-person", p, ["/api/contacts"])} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4 text-primary" /> Learning to add only if useful</h3>
                      <div className="space-y-2">
                        {(data.resourceMap || []).slice(0, 3).map((r) => (
                          <div key={`${r.category}-${r.linkedArchetype}`} className="rounded-xl border border-card-border bg-background/40 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">{r.category}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{r.why}</p>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Possible useful note:</span> {r.output}</p>
                              </div>
                              <AcceptButton label="Create learning item" onClick={() => post("/api/strategy-builder/accept-resource", r, ["/api/learn"])} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> Optional writing, project, or brand ideas</h3>
                      <div className="space-y-2">
                        {(data.exampleProjectIdeas || []).slice(0, 3).map((p) => (
                          <div key={`${p.asset}-${p.linkedArchetype}`} className="rounded-xl border border-card-border bg-background/40 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">{p.asset}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{p.need}</p>
                                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Done when:</span> {p.doneWhen}</p>
                              </div>
                              <AcceptButton label="Add writing/project idea" onClick={() => post("/api/strategy-builder/accept-example", p, ["/api/hustles"])} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 text-sm font-semibold">What to do more or less of</h3>
                      <div className="space-y-2">
                        {(data.planShifts || []).slice(0, 6).map((s) => (
                          <div key={`${s.action}-${s.target}`} className="flex items-start justify-between gap-3 rounded-xl border border-card-border bg-background/40 p-3">
                            <div><p className="text-sm font-semibold capitalize">{s.action}: {s.target}</p><p className="mt-1 text-xs text-muted-foreground">{s.reason}</p></div>
                            <AcceptButton label="Add shift" onClick={() => post("/api/strategy-builder/accept-shift", s)} />
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>

              <div className="border-t border-card-border p-3 text-right">
                <button onClick={load} className="text-xs font-medium text-muted-foreground hover:text-foreground">Refresh strategy</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

