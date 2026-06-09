export function GroupLabel({ children, count }: { children: any; count?: number }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
      {children}{typeof count === "number" && <span className="tabular-nums opacity-70">({count})</span>}
    </div>
  );
}
