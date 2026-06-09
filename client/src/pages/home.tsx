import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Sun, Moon, Sparkles, Briefcase, GraduationCap, Trophy,
  ChevronDown, ChevronRight, Users, Compass, FileText,
} from "lucide-react";
import { AnchorLogo } from "@/components/AnchorLogo";
import { useTheme } from "@/components/ThemeProvider";
import { type Tab, tabFromPath, pathForTab } from "@/lib/homeTypes";
import { TodayView } from "@/pages/views/TodayView";
import { StrategyView } from "@/pages/views/StrategyView";
import BrainDumpView from "@/pages/views/BrainDumpView";
import { JobsView } from "@/pages/views/JobsView";
import { NetworkView } from "@/pages/views/NetworkView";
import { LearnView } from "@/pages/views/LearnView";
import WinsView from "@/pages/views/WinsView";
import { ProfileView } from "@/pages/views/ProfileView";

const HEADER_TABS: { id: Tab; label: string; icon: typeof Sun }[] = [
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "network", label: "Network", icon: Users },
  { id: "braindump", label: "Capture", icon: Sparkles },
];

const MORE_TABS: { id: Tab; label: string; icon: typeof Sun; blurb: string }[] = [
  { id: "strategy", label: "Strategy", icon: Compass, blurb: "Your paths, at a glance" },
  { id: "learn", label: "Learn", icon: GraduationCap, blurb: "What you're learning" },
  { id: "wins", label: "Wins", icon: Trophy, blurb: "What's gone well" },
  { id: "profile", label: "Profile", icon: FileText, blurb: "Your CV for tailored suggestions" },
];

export default function Home() {
  const { theme, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>(() => tabFromPath(location));
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const next = tabFromPath(location);
    setTab((current) => (current === next ? current : next));
  }, [location]);

  function go(t: Tab) {
    setTab(t);
    setMoreOpen(false);
    const nextPath = pathForTab(t);
    if (location !== nextPath) navigate(nextPath);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => go("today")} className="flex items-center gap-2.5" data-testid="button-home">
            <span className="text-primary"><AnchorLogo className="w-7 h-7" /></span>
            <div className="leading-tight text-left">
              <div className="font-bold text-lg tracking-tight" data-testid="text-appname">Anchor</div>
            </div>
          </button>
          <div className="flex items-center gap-0.5">
            {HEADER_TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => go(id)} data-testid={`tab-${id}`}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm font-medium hover-elevate transition-colors ${tab === id ? "text-foreground bg-muted/60" : "text-muted-foreground"}`}>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            <div className="relative">
              <button onClick={() => setMoreOpen((o) => !o)} data-testid="button-more"
                className={`flex items-center gap-1 px-2.5 py-2 rounded-md text-sm font-medium hover-elevate transition-colors ${MORE_TABS.some((t) => t.id === tab) ? "text-foreground bg-muted/60" : "text-muted-foreground"}`}>
                <span className="hidden sm:inline">More</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 mt-1 w-56 rounded-xl border border-card-border bg-card shadow-lg p-1.5 z-40">
                    {MORE_TABS.map(({ id, label, icon: Icon, blurb }) => (
                      <button key={id} onClick={() => go(id)} data-testid={`tab-${id}`}
                        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left hover-elevate ${tab === id ? "text-primary" : ""}`}>
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1">
                          <span className="block text-sm font-medium leading-tight">{label}</span>
                          <span className="block text-xs text-muted-foreground">{blurb}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={toggle} aria-label="Toggle theme" data-testid="button-theme"
              className="w-9 h-9 grid place-items-center rounded-md hover-elevate text-muted-foreground">
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-7 pb-28 sm:pb-24">
        {tab !== "today" && (
          <button onClick={() => go("today")} data-testid="button-back-today" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight className="w-4 h-4 rotate-180" /> Back to Today
          </button>
        )}
        {tab === "today" && <TodayView onOpenTab={go} />}
        {tab === "strategy" && <StrategyView onOpenTab={go} />}
        {tab === "braindump" && <BrainDumpView />}
        {tab === "jobs" && <JobsView />}
        {tab === "network" && <NetworkView />}
        {tab === "learn" && <LearnView />}
        {tab === "wins" && <WinsView />}
        {tab === "profile" && <ProfileView />}
      </main>
    </div>
  );
}
