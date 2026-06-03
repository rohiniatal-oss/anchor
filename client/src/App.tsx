import { useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Home from "@/pages/home";
import NotFound from "@/pages/not-found";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RestartFromHereButton() {
  const [busy, setBusy] = useState(false);

  async function restart() {
    setBusy(true);
    try {
      const res = await fetch("/api/plan/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day: todayKey(), energy: "medium" }),
      });
      if (!res.ok) throw new Error("restart failed");
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
      className="fixed bottom-4 right-4 z-50 rounded-full border border-primary/30 bg-card/95 px-4 py-2 text-sm font-medium text-primary shadow-lg backdrop-blur hover:bg-primary/10 disabled:opacity-60"
      aria-label="Restart from here"
    >
      {busy ? "Restarting…" : "Restart from here"}
    </button>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
            <RestartFromHereButton />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
export default App;
