import { useState } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { apiRequest, queryClient } from "./lib/queryClient";
import { todayKey } from "./lib/utils";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { HOME_ROUTE_PATHS, routeBase } from "@/lib/homeTypes";
import Home from "@/pages/home";
import NotFound from "@/pages/not-found";

function normalizeRoutePath(path: string) {
  return routeBase(path);
}

function useNormalizedHashLocation() {
  const [location, navigate] = useHashLocation();
  return [normalizeRoutePath(location), navigate] as [string, typeof navigate];
}

function RestartFromHereButton() {
  const [location] = useLocation();
  const [busy, setBusy] = useState(false);
  if (routeBase(location) !== "/") return null;

  async function restart() {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/plan/restart", { day: todayKey(), energy: "medium" });
      await queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/plan/current"] });
      window.location.hash = "/";
      window.location.reload();
    } catch {
      setBusy(false);
      window.alert("Could not restart the day. Try again in a moment.");
    }
  }

  return (
    <button
      type="button"
      onClick={restart}
      disabled={busy}
      data-testid="button-restart-from-here"
      className="mx-4 mb-4 w-[calc(100%-2rem)] rounded-full border border-primary/30 bg-card/95 px-4 py-2 text-sm font-medium text-primary shadow-lg backdrop-blur hover:bg-primary/10 disabled:opacity-60 sm:fixed sm:bottom-4 sm:right-4 sm:left-auto sm:z-50 sm:mb-0 sm:w-auto"
      aria-label="Restart from here"
    >
      {busy ? "Restarting…" : "Restart from here"}
    </button>
  );
}

function TodayPlanHierarchyStyles() {
  return (
    <style>{`
      /* Plan hierarchy: anchor item stands out, secondary items visually recede. */
      button[data-plan-rank="0"] {
        position: relative !important;
        display: flex !important;
        padding: 2.35rem 1rem 1rem 1rem !important;
        border-color: hsl(var(--primary) / 0.5) !important;
        background: linear-gradient(180deg, hsl(var(--primary) / 0.12), hsl(var(--card))) !important;
        box-shadow: 0 12px 30px -24px hsl(var(--primary) / 0.85) !important;
      }

      button[data-plan-rank="0"]::before {
        content: "Your anchor for today";
        position: absolute;
        top: 0.75rem;
        left: 1rem;
        font-size: 0.68rem;
        line-height: 1;
        font-weight: 750;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: hsl(var(--primary));
      }

      button[data-plan-rank="0"] > span:first-child {
        transform: scale(1.04);
        box-shadow: 0 8px 18px -14px hsl(var(--primary));
      }

      button[data-plan-rank="0"] p:first-of-type {
        font-size: 0.98rem !important;
        line-height: 1.35 !important;
      }

      button[data-plan-rank]:not([data-plan-rank="0"]) {
        position: relative !important;
        width: calc(100% - 1.15rem) !important;
        margin-left: 1.15rem !important;
        padding: 0.75rem 0.85rem !important;
        border-style: dashed !important;
        background: hsl(var(--card) / 0.72) !important;
        opacity: 0.88;
      }

      button[data-plan-rank]:not([data-plan-rank="0"]) > span:first-child {
        background: hsl(var(--muted)) !important;
        color: hsl(var(--muted-foreground)) !important;
      }

      button[data-plan-rank]:not([data-plan-rank="0"]) p:first-of-type {
        font-size: 0.86rem !important;
        line-height: 1.3 !important;
      }

      button[data-plan-rank="1"] {
        margin-top: 1.75rem !important;
      }

      button[data-plan-rank="1"]::before {
        content: "After anchor, if you have capacity";
        position: absolute;
        top: -1.25rem;
        left: 0;
        font-size: 0.67rem;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: hsl(var(--muted-foreground));
      }

      button[data-plan-rank]:not([data-plan-rank="0"])::after {
        opacity: 0.55;
      }
    `}</style>
  );
}

function AppRouter() {
  return (
    <Switch>
      {HOME_ROUTE_PATHS.map((path) => (
        <Route key={path} path={path} component={Home} />
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <TodayPlanHierarchyStyles />
          <Toaster />
          <Router hook={useNormalizedHashLocation}>
            <AppRouter />
            <RestartFromHereButton />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
export default App;
