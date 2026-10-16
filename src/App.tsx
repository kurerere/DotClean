import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { Explorer } from "@/components/explorer";
import { Recommendations } from "@/components/recommendations";
import { StatsBar, type Stat } from "@/components/stats-bar";
import type { ColorMode } from "@/components/treemap";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { formatBytes, formatCount } from "@/lib/format";
import { buildScript } from "@/lib/script";
import type { DiskInfo, Recommendation, ScanProgress, TreeItem } from "@/lib/types";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [home, setHome] = useState("");
  const [homeSize, setHomeSize] = useState<number | null>(null);
  const [tree, setTree] = useState<TreeItem | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ColorMode>("category");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>({ files: 0, bytes: 0 });
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Recommendation | null>(null);
  // Folders visited before the current view, most recent last.
  const [history, setHistory] = useState<string[]>([]);
  const started = useRef(false);

  const refresh = useCallback(async (path: string | null) => {
    const [nextTree, nextRecs, nextDisk] = await Promise.all([
      api.getTree(path).catch(() => api.getTree(null)),
      api.getRecommendations(),
      api.diskInfo(),
    ]);
    setTree(nextTree);
    setRecs(nextRecs);
    setDisk(nextDisk);
    return nextRecs;
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setProgress({ files: 0, bytes: 0 });
    try {
      const summary = await api.startScan();
      if (summary.cancelled) {
        setError("Scan cancelled.");
        return;
      }
      setHome(summary.home);
      setHomeSize(summary.size);
      setHistory([]);
      const nextRecs = await refresh(null);
      setSelected(new Set(nextRecs.filter((r) => r.safety === "safe").map((r) => r.id)));
      toast.success(`Scanned ${formatCount(summary.files)} files in ${(summary.millis / 1000).toFixed(1)}s`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setScanning(false);
    }
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen<ScanProgress>("scan-progress", (e) => setProgress(e.payload));
    api.diskInfo().then(setDisk).catch(() => {});
    // StrictMode mounts effects twice in dev; only kick off one scan.
    if (!started.current) {
      started.current = true;
      runScan();
    }
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [runScan]);

  const navigate = (path: string) => {
    if (!tree?.path || path === tree.path) return;
    const from = tree.path;
    api
      .getTree(path)
      .then((next) => {
        setTree(next);
        setHistory((h) => [...h, from]);
      })
      .catch((e) => toast.error(errorText(e)));
  };

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    setHistory(history.slice(0, -1));
    // The folder may have been trashed since; fall back to home.
    api
      .getTree(prev)
      .catch(() => api.getTree(null))
      .then(setTree)
      .catch((e) => toast.error(errorText(e)));
  }, [history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Backspace" || ((e.metaKey || e.altKey) && (e.key === "[" || e.key === "ArrowLeft"))) {
        e.preventDefault();
        back();
      }
    };
    // Mouse "back" side button.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [back]);

  const reveal = (path: string) => revealItemInDir(path).catch((e) => toast.error(errorText(e)));

  const chosen = recs.filter((r) => selected.has(r.id));
  const chosenSize = chosen.reduce((s, r) => s + r.size, 0);

  const copyScript = async () => {
    try {
      await writeText(buildScript(chosen, home));
      toast.success(`Cleanup script copied · ${formatBytes(chosenSize)}`, {
        description: "Paste it into Terminal after reviewing each line.",
      });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const trash = async () => {
    try {
      const result = await api.trashPaths(chosen.flatMap((r) => r.paths.map((p) => p.path)));
      const nextRecs = await refresh(tree?.path ?? null);
      setSelected((prev) => new Set(nextRecs.filter((r) => prev.has(r.id)).map((r) => r.id)));
      setHomeSize((s) => (s === null ? s : s - result.bytes));
      if (result.failed.length) {
        toast.warning(`${result.failed.length} folders could not be moved`, {
          description: result.failed.map(([p, why]) => `${p}: ${why}`).join("\n"),
        });
      }
      if (result.trashed.length) {
        toast.success(`Moved ${formatBytes(result.bytes)} to the Trash`, {
          description: "Empty the Trash to reclaim the space.",
        });
      }
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const highlight = useMemo(() => new Set(hovered?.paths.map((p) => p.path) ?? []), [hovered]);

  const totals = (safety: Recommendation["safety"]) => {
    const items = recs.filter((r) => r.safety === safety);
    return { size: items.reduce((s, r) => s + r.size, 0), count: items.length };
  };
  const safe = totals("safe");
  const review = totals("review");
  const stats: Stat[] = [
    {
      label: "Free after cleanup",
      value: disk ? disk.free + chosenSize : null,
      hint: chosenSize > 0 && <span style={{ color: "var(--safe)" }}>+{formatBytes(chosenSize)}</span>,
    },
    { label: "Safe to remove", dot: "var(--safe)", value: homeSize === null ? null : safe.size, hint: `${safe.count} items` },
    {
      label: "Needs review",
      dot: "var(--review)",
      value: homeSize === null ? null : review.size,
      hint: `${review.count} items`,
    },
    {
      label: "Not scanned",
      value: disk && homeSize !== null ? Math.max(0, disk.total - disk.free - homeSize) : null,
      hint: "system & apps",
    },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      <div data-tauri-drag-region className="h-8 shrink-0" />
      <main className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
        <StatsBar stats={stats} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,380px)] gap-4">
          <Explorer
            home={home}
            tree={tree}
            mode={mode}
            onModeChange={setMode}
            onNavigate={navigate}
            onBack={history.length > 0 && !scanning ? back : null}
            onOpenFile={reveal}
            highlight={highlight}
            scanning={scanning}
            progress={progress}
            onCancel={() => api.cancelScan()}
            onRescan={runScan}
            error={error}
          />
          <Recommendations
            home={home}
            recs={recs}
            selected={selected}
            onToggle={(id, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            onSelectSafe={() => setSelected(new Set(recs.filter((r) => r.safety === "safe").map((r) => r.id)))}
            onCopyScript={copyScript}
            onTrash={trash}
            onReveal={reveal}
            onHover={setHovered}
          />
        </div>
      </main>
      <Toaster position="top-center" />
    </div>
  );
}
