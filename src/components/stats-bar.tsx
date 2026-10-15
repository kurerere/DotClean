import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Stat {
  label: string;
  dot?: string;
  value: number | null;
  approx?: boolean;
  hint?: React.ReactNode;
}

export function StatsBar({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-4 divide-x rounded-xl border bg-card">
      {stats.map((s) => (
        <div key={s.label} className="px-5 py-4">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {s.dot && <span className="size-1.5 rounded-full" style={{ background: s.dot }} />}
            {s.label}
          </div>
          <div className="mt-1.5 flex items-baseline gap-2 whitespace-nowrap">
            <span className={cn("font-mono text-2xl font-semibold tracking-tight", s.value === null && "text-muted-foreground")}>
              {s.value === null ? "—" : `${s.approx ? "~" : ""}${formatBytes(s.value)}`}
            </span>
            {s.hint && <span className="truncate font-mono text-xs text-muted-foreground">{s.hint}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
