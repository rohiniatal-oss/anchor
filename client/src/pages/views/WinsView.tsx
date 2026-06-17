import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, Trophy, X } from "lucide-react";
import { mutateAndInvalidate } from "@/lib/api";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { WIN_CATEGORY_LABEL, WIN_CATEGORY_SWATCH } from "@/lib/homeTypes";
import { SectionHeading } from "@/components/home/SectionHeading";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import { Empty } from "@/components/home/Empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WIN_CATEGORIES, type WinCategory } from "@shared/domainState";
import type { Win } from "@shared/schema";

type WinsSummary = {
  total: number; thisWeek: number; thisMonth: number;
  byCategory: Record<WinCategory, number>; byCategoryWeek: Record<WinCategory, number>;
  streakDays: number; trackByWinId: Record<number, number | "untracked">;
};

export default function WinsView() {
  const { data: wins = [], isLoading } = useQuery<Win[]>({ queryKey: ["/api/wins"] });
  const { data: stats } = useQuery<{ doneThisWeek: number }>({ queryKey: ["/api/stats"] });
  const { data: summary } = useQuery<WinsSummary>({ queryKey: ["/api/wins/summary"] });
  const { data: careerTracks = [] } = useCareerTracks();
  const trackNameById = new Map(careerTracks.map((t) => [t.id, t.name] as const));
  const [text, setText] = useState("");
  const [category, setCategory] = useState<WinCategory>("mindset");
  async function add() {
    if (!text.trim()) return;
    await mutateAndInvalidate("POST", "/api/wins", { text: text.trim(), winCategory: category }, ["/api/wins", "/api/stats", "/api/wins/summary"]);
    setText("");
  }
  async function remove(id: number) { await mutateAndInvalidate("DELETE", `/api/wins/${id}`, undefined, ["/api/wins", "/api/stats", "/api/wins/summary"]); }
  function dayLabel(ts: number) { return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = wins.filter((w) => w.createdAt >= weekAgo);
  const earlier = wins.filter((w) => w.createdAt < weekAgo);

  function dayGroupLabel(ts: number) {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const winDay = new Date(d); winDay.setHours(0, 0, 0, 0);
    if (winDay.getTime() === today.getTime()) return "Today";
    if (winDay.getTime() === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }

  function groupByDay(list: Win[]): { label: string; key: string; items: Win[] }[] {
    const groups: { label: string; key: string; items: Win[] }[] = [];
    for (const w of list) {
      const key = new Date(w.createdAt).toDateString();
      const last = groups[groups.length - 1];
      if (last && last.key === key) { last.items.push(w); }
      else { groups.push({ label: dayGroupLabel(w.createdAt), key, items: [w] }); }
    }
    return groups;
  }

  const SOURCE_LABEL: Record<string, string> = { learn: "Learning", task: "Task", milestone: "Learning step", contact: "Networking", hustle: "Project" };

  function Row({ w }: { w: Win }) {
    const tid = summary?.trackByWinId[w.id];
    const trackName = tid && tid !== "untracked" ? trackNameById.get(tid) : undefined;
    const sourceLabel = w.sourceEntityType ? SOURCE_LABEL[w.sourceEntityType] || w.sourceEntityType : null;
    return (
      <div className="group flex items-center gap-3 rounded-lg border border-card-border bg-card px-3.5 py-3" data-testid={`win-${w.id}`}>
        <Trophy className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 text-sm">{w.text}</span>
        {sourceLabel && <span className="hidden md:inline-flex shrink-0 text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-0.5">from {sourceLabel}</span>}
        {trackName && <span className="hidden md:inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid={`win-track-${w.id}`} title="Derived track">{trackName}</span>}
        {w.winCategory && <span className="hidden sm:inline-flex shrink-0 text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{WIN_CATEGORY_LABEL[w.winCategory as WinCategory] || w.winCategory}</span>}
        <span className="text-xs text-muted-foreground shrink-0">{dayLabel(w.createdAt)}</span>
        <button onClick={() => remove(w.id)} aria-label="Delete" data-testid={`button-delete-win-${w.id}`} className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Wins" sub="Small wins count — log them so you don't forget the progress you made." />
        {stats && stats.doneThisWeek > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 rounded-full bg-accent text-accent-foreground px-3 py-1.5 text-sm font-medium" data-testid="text-wins-momentum">
            <Trophy className="w-4 h-4" /> {stats.doneThisWeek} this week
          </div>
        )}
      </div>

      {summary && summary.total > 0 && (
        <div className="mb-4 rounded-xl border border-card-border bg-card px-4 py-3" data-testid="wins-summary">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span data-testid="wins-week"><span className="font-semibold tabular-nums">{summary.thisWeek}</span> <span className="text-muted-foreground">this week</span></span>
            <span data-testid="wins-month"><span className="font-semibold tabular-nums">{summary.thisMonth}</span> <span className="text-muted-foreground">this month</span></span>
            {summary.streakDays > 0 && (
              <span className="inline-flex items-center gap-1 text-primary" data-testid="wins-streak">
                <Flame className="w-3.5 h-3.5" /> <span className="font-semibold tabular-nums">{summary.streakDays}</span>
                <span className="text-muted-foreground">day{summary.streakDays > 1 ? "s" : ""} in a row</span>
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="wins-by-category">
            {WIN_CATEGORIES.filter((c) => summary.byCategory[c] > 0).map((c) => (
              <span key={c} className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 font-medium ${WIN_CATEGORY_SWATCH[c]}`} data-testid={`wins-cat-${c}`}>
                {WIN_CATEGORY_LABEL[c]} <span className="tabular-nums opacity-80">{summary.byCategory[c]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="What went well? A task done, a message sent, something you learned…" className="h-11 flex-1 min-w-[12rem]" data-testid="input-win" />
        <select value={category} onChange={(e) => setCategory(e.target.value as WinCategory)} data-testid="select-win-category"
          className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          {WIN_CATEGORIES.map((c) => <option key={c} value={c}>{WIN_CATEGORY_LABEL[c]}</option>)}
        </select>
        <Button className="h-11 px-4" onClick={add} data-testid="button-add-win"><Trophy className="w-4 h-4 mr-1" /> Log win</Button>
      </div>
      {isLoading ? <Loading /> : wins.length === 0 ? (
        <Empty icon={Trophy} text="No wins logged yet. A win can be a task finished, a message sent, or something you learned — anything counts." />
      ) : (
        <div className="space-y-6">
          {thisWeek.length > 0 && (
            <div>
              <GroupLabel count={thisWeek.length}>This week</GroupLabel>
              <div className="space-y-4">
                {groupByDay(thisWeek).map(({ label, key, items }) => (
                  <div key={key}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 pl-1">{label}</p>
                    <div className="space-y-2">{items.map((w) => <Row key={w.id} w={w} />)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {earlier.length > 0 && (<div><GroupLabel count={earlier.length}>Earlier</GroupLabel><div className="space-y-2">{earlier.map((w) => <Row key={w.id} w={w} />)}</div></div>)}
        </div>
      )}
    </div>
  );
}
