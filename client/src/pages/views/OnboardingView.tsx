import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OnboardingRole = { archetype: string; priority: string; fitLogic: string; nextExperiment: string };

export default function OnboardingView() {
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
