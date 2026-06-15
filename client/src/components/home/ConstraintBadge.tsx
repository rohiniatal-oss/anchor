export function ConstraintBadge({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" }) {
  const cls = tone === "warn" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{text}</span>;
}
