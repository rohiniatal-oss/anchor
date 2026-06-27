/**
 * Markdown export of a persisted curriculum. Mirrors the structure of a hand-built
 * study plan: a header with the theme/summary, an explicit capstone, then one
 * section per week (module) with objective, two-tier sources, and a day-by-day
 * table including planned date, focus, activity, and the done-when test.
 *
 * NOTE: the canonical reference (docs/geopolitics-study-plan-v2.md) is not present
 * in this checkout; this layout follows the structure described in the task.
 */
import type { PersistedCurriculum, PersistedModule, PersistedSource, ComposedDayBlock } from "./types";

function statusMark(status: string): string {
  if (status === "completed") return "x";
  if (status === "skipped") return "~";
  return " ";
}

function escapeCell(value: string): string {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function sourceLine(s: PersistedSource): string {
  const name = s.url ? `[${s.title}](${s.url})` : s.title;
  const author = s.author ? ` — ${s.author}` : "";
  const verify = s.tier === "spine"
    ? (s.verified ? " _(verified)_" : " _(verification pending)_")
    : " _(unverified)_";
  const why = s.why ? ` — ${s.why}` : "";
  return `- ${name}${author}${verify}${why}`;
}

function dayBlock(label: string, b: ComposedDayBlock | null | undefined): string[] {
  if (!b) return [];
  const lines: string[] = [];
  const hrs = b.hours ?? 0;
  lines.push(`*${label}${hrs ? ` (${hrs}h)` : ""}:*`);
  if (b.focus) lines.push(b.focus);
  if (b.items && b.items.length) {
    b.items.forEach((it) => lines.push(`- ${it}`));
  }
  lines.push("");
  return lines;
}

function moduleSection(mod: PersistedModule): string {
  const lines: string[] = [];
  lines.push(`## Week ${mod.weekNumber} — ${mod.title}`);
  lines.push("");
  if (mod.focus) lines.push(`**Focus:** ${mod.focus}`);
  if (mod.objective) lines.push(`**Objective:** ${mod.objective}`);
  if (mod.focus || mod.objective) lines.push("");

  const spine = mod.sources.filter((s) => s.tier === "spine");
  const secondary = mod.sources.filter((s) => s.tier === "secondary");
  if (spine.length) {
    lines.push("### Spine sources");
    lines.push("");
    spine.forEach((s) => lines.push(sourceLine(s)));
    lines.push("");
  }
  if (secondary.length) {
    lines.push("### Secondary sources");
    lines.push("");
    secondary.forEach((s) => lines.push(sourceLine(s)));
    lines.push("");
  }

  lines.push("### Daily plan");
  lines.push("");
  // Block-rich format when any day has morning/afternoon; table otherwise.
  const anyBlocks = mod.days.some((d) => d.morning || d.afternoon);
  if (anyBlocks) {
    mod.days.forEach((d) => {
      lines.push(`**Day ${d.dayIndex + 1} — ${d.plannedDate} — ${d.title}** [${statusMark(d.status)}]`);
      lines.push("");
      lines.push(...dayBlock("Morning", d.morning));
      lines.push(...dayBlock("Afternoon", d.afternoon));
      if (d.doneWhen) { lines.push(`**Done when:** ${d.doneWhen}`); lines.push(""); }
    });
  } else {
    lines.push("| ✓ | Date | Day | Focus | Activity | Done when |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    mod.days.forEach((d) => {
      lines.push(
        `| ${statusMark(d.status)} | ${d.plannedDate} | ${d.dayIndex + 1} | ${escapeCell(d.focus)} | ${escapeCell(d.activity || d.title)} | ${escapeCell(d.doneWhen)} |`,
      );
    });
  }
  lines.push("");
  return lines.join("\n");
}

export function exportCurriculumMarkdown(curriculum: PersistedCurriculum): string {
  const lines: string[] = [];
  lines.push(`# ${curriculum.theme}`);
  lines.push("");
  lines.push(`> ${curriculum.weeks}-week living curriculum · ${curriculum.hoursPerDay} hrs/day · capstone: ${curriculum.capstoneShape}`);
  lines.push("");
  if (curriculum.summary) {
    lines.push(curriculum.summary);
    lines.push("");
  }

  if (curriculum.capstone) {
    lines.push("## Capstone");
    lines.push("");
    lines.push(`**${curriculum.capstone.title}** (${curriculum.capstone.shape})`);
    lines.push("");
    if (curriculum.capstone.description) {
      lines.push(curriculum.capstone.description);
      lines.push("");
    }
    if (curriculum.capstone.doneWhen) {
      lines.push(`**Done when:** ${curriculum.capstone.doneWhen}`);
      lines.push("");
    }
  }

  lines.push("## Schedule");
  lines.push("");
  curriculum.modules.forEach((mod) => {
    lines.push(moduleSection(mod));
  });

  if (curriculum.standingObligations && curriculum.standingObligations.length) {
    lines.push("## Standing weekly obligations");
    lines.push("");
    curriculum.standingObligations.forEach((o) => {
      const cadence = o.cadence === "weekly_friday" ? "Every Friday"
        : o.cadence === "weekly_monday" ? "Every Monday"
        : o.cadence === "monthly_first_monday" ? "First Monday of each month"
        : o.cadence;
      lines.push(`- **${cadence}:** ${o.title}${o.doneWhen ? ` — _done when:_ ${o.doneWhen}` : ""}`);
    });
    lines.push("");
  }

  if (curriculum.milestones && curriculum.milestones.length) {
    lines.push("## Milestone checkpoints");
    lines.push("");
    lines.push("| Day | Milestone | What good looks like |");
    lines.push("| --- | --- | --- |");
    curriculum.milestones.forEach((m) => {
      lines.push(`| ${m.atDayIndex} | ${escapeCell(m.label)} | ${escapeCell(m.whatGoodLooksLike)} |`);
    });
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
