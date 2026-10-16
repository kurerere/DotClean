import { useState } from "react";
import { ChevronRight, FolderSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, tildify } from "@/lib/format";
import type { Recommendation, Safety } from "@/lib/types";
import { cn, FILE_MANAGER } from "@/lib/utils";

interface RecommendationsProps {
  home: string;
  recs: Recommendation[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onSelectSafe: () => void;
  onCopyScript: () => void;
  onTrash: () => Promise<void>;
  onReveal: (path: string) => void;
  onHover: (rec: Recommendation | null) => void;
}

const SECTIONS: { safety: Safety; label: string }[] = [
  { safety: "safe", label: "Safe to remove" },
  { safety: "review", label: "Review first" },
];

export function Recommendations(props: RecommendationsProps) {
  const { recs, selected } = props;
  const chosen = recs.filter((r) => selected.has(r.id));
  const chosenSize = chosen.reduce((s, r) => s + r.size, 0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border bg-card">
      <header className="px-5 pt-4 pb-3">
        <h2 className="font-semibold">Recommendations</h2>
        <p className="text-sm text-muted-foreground">Select items to build a cleanup script</p>
      </header>

      <ScrollArea className="min-h-0 flex-1 border-t">
        {recs.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing to recommend yet.</p>
        )}
        {SECTIONS.map(({ safety, label }) => {
          const items = recs.filter((r) => r.safety === safety);
          if (!items.length) return null;
          return (
            <div key={safety}>
              <div className="flex items-center justify-between bg-muted/40 px-5 py-1.5">
                <Badge
                  variant="outline"
                  className="border-transparent font-normal"
                  style={{
                    background: safety === "safe" ? "var(--safe-soft)" : "var(--review-soft)",
                    color: safety === "safe" ? "var(--safe)" : "var(--review)",
                  }}
                >
                  {label}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatBytes(items.reduce((s, r) => s + r.size, 0))}
                </span>
              </div>
              {items.map((rec) => (
                <RecRow key={rec.id} rec={rec} {...props} />
              ))}
            </div>
          );
        })}
      </ScrollArea>

      <footer className="border-t px-5 py-3">
        <div className="mb-2.5 text-sm text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{formatBytes(chosenSize)}</span> selected ·{" "}
          {chosen.length} items
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={props.onSelectSafe}>
            Select safe
          </Button>
          <Button size="sm" disabled={!chosen.length} onClick={props.onCopyScript}>
            Copy script
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            disabled={!chosen.length}
            onClick={() => setConfirming(true)}
          >
            Move to Trash
          </Button>
        </div>
      </footer>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {formatBytes(chosenSize)} to the Trash?</DialogTitle>
            <DialogDescription>
              {chosen.reduce((n, r) => n + r.paths.length, 0)} folders from {chosen.length} items will be moved to
              the Trash. Space is reclaimed once you empty it.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {chosen.flatMap((r) =>
              r.paths.map((p) => (
                <li key={p.path} className="flex justify-between gap-3">
                  <span className="truncate">{tildify(p.path, props.home)}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(p.size)}</span>
                </li>
              )),
            )}
          </ul>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onTrash();
                  setConfirming(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Moving…" : "Move to Trash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function RecRow({ rec, home, selected, onToggle, onReveal, onHover }: RecommendationsProps & { rec: Recommendation }) {
  const [open, setOpen] = useState(false);
  const checked = selected.has(rec.id);
  return (
    <div className="border-t first:border-t-0" onMouseEnter={() => onHover(rec)} onMouseLeave={() => onHover(null)}>
      <div className="flex items-center gap-3 px-5 py-3">
        <Checkbox checked={checked} onCheckedChange={(v) => onToggle(rec.id, v === true)} aria-label={rec.title} />
        <button className="min-w-0 flex-1 text-left" onClick={() => onToggle(rec.id, !checked)}>
          <div className="truncate text-sm font-medium">{rec.title}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{rec.subtitle}</div>
        </button>
        <span className="shrink-0 font-mono text-sm font-medium">
          {rec.approx && "~"}
          {formatBytes(rec.size)}
        </span>
        <button
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setOpen(!open)}
          aria-label="Show folders"
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
      </div>
      {open && (
        <ul className="space-y-0.5 px-5 pb-3 pl-12">
          {rec.paths.map((p) => (
            <li key={p.path} className="group flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate" title={p.path}>
                {tildify(p.path, home)}
              </span>
              <span>{formatBytes(p.size)}</span>
              <button
                className="opacity-0 group-hover:opacity-100 hover:text-foreground"
                title={`Reveal in ${FILE_MANAGER}`}
                onClick={() => onReveal(p.path)}
              >
                <FolderSearch className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
