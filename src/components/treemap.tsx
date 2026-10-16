import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import { squarify, type Rect } from "@/lib/treemap";
import type { TreeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ColorMode = "category" | "cleanup";

interface TreemapProps {
  root: TreeItem;
  mode: ColorMode;
  highlight: Set<string>;
  onOpen: (item: TreeItem) => void;
  onReveal: (item: TreeItem) => void;
}

const GAP = 4;
const HEADER = 26;
const PAD = 6;

export function Treemap({ root, mode, highlight, onOpen, onReveal }: TreemapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(
    () => squarify(root.children, (c) => c.size, { x: 0, y: 0, w: size.w, h: size.h }),
    [root, size],
  );

  return (
    <div ref={ref} className="relative size-full">
      {tiles.map((t) => (
        <Tile
          key={t.item.path ?? t.item.name}
          item={t.item}
          rect={inset(t, GAP / 2)}
          depth={0}
          mode={mode}
          highlight={highlight}
          onOpen={onOpen}
          onReveal={onReveal}
        />
      ))}
    </div>
  );
}

function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: Math.max(0, r.w - by * 2), h: Math.max(0, r.h - by * 2) };
}

interface TileProps extends Omit<TreemapProps, "root"> {
  item: TreeItem;
  rect: Rect;
  depth: number;
}

function Tile({ item, rect, depth, mode, highlight, onOpen, onReveal }: TileProps) {
  if (rect.w < 3 || rect.h < 3) return null;

  // A tile that is entirely cleanable reads better as one solid block.
  const nested =
    depth === 0 &&
    item.children.length > 0 &&
    !(item.cleanable && item.children.every((c) => c.cleanable === item.cleanable)) &&
    rect.w > 90 &&
    rect.h > 70;
  const inner = nested
    ? squarify(item.children, (c) => c.size, {
        x: PAD,
        y: HEADER,
        w: rect.w - PAD * 2,
        h: rect.h - HEADER - PAD,
      })
    : [];

  const opens = item.kind === "dir" || item.kind === "file";
  const hot = item.path !== null && highlight.has(item.path);
  const showName = rect.w > 44 && rect.h > 22;
  const big = !nested && rect.w > 80 && rect.h > 56;

  return (
    <div
      title={`${item.path ?? item.name}\n${formatBytes(item.size)}${item.fileCount ? ` · ${item.fileCount.toLocaleString()} files` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (opens) onOpen(item);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (opens) onReveal(item);
      }}
      className={cn(
        "absolute overflow-hidden rounded-md border transition-[filter,box-shadow]",
        opens && "cursor-pointer",
        opens && "hover:brightness-[0.97] dark:hover:brightness-110",
        hot && "ring-2 ring-foreground/70",
        tileClass(item, mode),
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, ...tileStyle(item, mode) }}
    >
      {showName && (
        <div className="flex items-baseline justify-between gap-2 px-2 pt-1.5 text-[13px] leading-tight">
          <span className={cn("truncate", depth === 0 ? "font-medium" : "text-foreground/80")}>
            {item.name}
          </span>
          {nested && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatBytes(item.size)}</span>
          )}
        </div>
      )}
      {big && (
        <div
          className={cn(
            "absolute bottom-1.5 left-2 font-mono font-semibold tracking-tight",
            rect.w > 180 && rect.h > 140 ? "text-2xl" : "text-base",
          )}
        >
          {formatBytes(item.size)}
        </div>
      )}
      {inner.map((t) => (
        <Tile
          key={t.item.path ?? t.item.name}
          item={t.item}
          rect={inset(t, 2)}
          depth={depth + 1}
          mode={mode}
          highlight={highlight}
          onOpen={onOpen}
          onReveal={onReveal}
        />
      ))}
    </div>
  );
}

function tileClass(item: TreeItem, mode: ColorMode): string {
  if (item.cleanable === "safe") return "hatch-safe";
  if (item.cleanable === "review") return mode === "cleanup" ? "hatch-review" : "hatch-safe";
  return "";
}

function tileStyle(item: TreeItem, mode: ColorMode): React.CSSProperties {
  if (mode === "cleanup") {
    if (item.cleanable === "safe") return { backgroundColor: "var(--safe-soft)", borderColor: "var(--safe)" };
    if (item.cleanable === "review") return { backgroundColor: "var(--review-soft)", borderColor: "var(--review)" };
    return { backgroundColor: "var(--muted)", borderColor: "var(--border)", color: "var(--muted-foreground)" };
  }
  return {
    backgroundColor: `var(--cat-${item.category})`,
    borderColor: item.cleanable ? "var(--safe)" : `var(--cat-${item.category}-border)`,
  };
}
