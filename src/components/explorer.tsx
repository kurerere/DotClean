import { ChevronRight, RefreshCw } from "lucide-react";

import { Treemap, type ColorMode } from "@/components/treemap";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatBytes, formatCount } from "@/lib/format";
import { CATEGORIES, type ScanProgress, type TreeItem } from "@/lib/types";

interface ExplorerProps {
  home: string;
  tree: TreeItem | null;
  mode: ColorMode;
  onModeChange: (mode: ColorMode) => void;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  highlight: Set<string>;
  scanning: boolean;
  progress: ScanProgress;
  onCancel: () => void;
  onRescan: () => void;
  error: string | null;
}

export function Explorer(props: ExplorerProps) {
  const { home, tree, mode, onModeChange, onNavigate, onOpenFile, highlight } = props;

  return (
    <section className="flex min-h-0 flex-col rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div>
          <h2 className="font-semibold">Explorer</h2>
          <p className="text-sm text-muted-foreground">Your home folder, sized by space used. Click a tile to open it.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Rescan"
            disabled={props.scanning}
            onClick={props.onRescan}
          >
            <RefreshCw className={props.scanning ? "animate-spin" : undefined} />
          </Button>
          <ToggleGroup
            type="single"
            size="sm"
            value={mode}
            onValueChange={(v) => v && onModeChange(v as ColorMode)}
            className="rounded-lg bg-muted p-0.5"
          >
            {(["category", "cleanup"] as const).map((m) => (
              <ToggleGroupItem
                key={m}
                value={m}
                className="px-3 capitalize text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                {m}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </header>

      <div className="flex items-center justify-between border-t px-5 py-2 text-sm">
        <Breadcrumb home={home} path={tree?.path ?? home} onNavigate={onNavigate} />
        {tree && <span className="font-mono text-xs text-muted-foreground">{formatBytes(tree.size)}</span>}
      </div>

      <div className="min-h-0 flex-1 px-4 pb-2">
        {tree && !props.scanning ? (
          <Treemap
            root={tree}
            mode={mode}
            highlight={highlight}
            onOpen={(item) => {
              if (!item.path) return;
              if (item.kind === "dir" && item.children.length > 0) onNavigate(item.path);
              else onOpenFile(item.path);
            }}
          />
        ) : (
          <ScanStatus {...props} />
        )}
      </div>

      <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
        {mode === "category" ? (
          CATEGORIES.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: `var(--cat-${c.id}-dot)` }} />
              {c.label}
            </span>
          ))
        ) : (
          <>
            <LegendSwatch className="hatch-safe" color="var(--safe)" label="Safe to remove" />
            <LegendSwatch className="hatch-review" color="var(--review)" label="Review first" />
            <LegendSwatch color="var(--border)" label="Keep" />
          </>
        )}
      </footer>
    </section>
  );
}

function LegendSwatch({ className, color, label }: { className?: string; color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-3 rounded-[3px] border ${className ?? ""}`} style={{ borderColor: color }} />
      {label}
    </span>
  );
}

function Breadcrumb({ home, path, onNavigate }: { home: string; path: string; onNavigate: (p: string) => void }) {
  const rel = path.startsWith(home) ? path.slice(home.length).split("/").filter(Boolean) : [];
  const crumbs = [{ label: "~ Home", path: home }].concat(
    rel.map((part, i) => ({ label: part, path: `${home}/${rel.slice(0, i + 1).join("/")}` })),
  );
  return (
    <nav className="flex min-w-0 items-center gap-1 text-muted-foreground">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.path} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0" />}
            <button
              disabled={last}
              onClick={() => onNavigate(c.path)}
              className={last ? "truncate text-foreground" : "truncate hover:text-foreground hover:underline"}
            >
              {c.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function ScanStatus({ scanning, progress, onCancel, onRescan, error }: ExplorerProps) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed text-center">
      {scanning ? (
        <>
          <div className="text-sm text-muted-foreground">Scanning your home folder…</div>
          <div className="font-mono text-3xl font-semibold tracking-tight">{formatBytes(progress.bytes)}</div>
          <div className="font-mono text-xs text-muted-foreground">{formatCount(progress.files)} files</div>
          <div className="h-1 w-56 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-[scan_1.2s_ease-in-out_infinite] rounded-full bg-foreground/60" />
          </div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">{error ?? "No scan results yet."}</div>
          <Button size="sm" onClick={onRescan}>
            Scan home folder
          </Button>
        </>
      )}
    </div>
  );
}
