export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

/** Squarified treemap (Bruls et al.). Items should be sorted by size, descending. */
export function squarify<T>(items: T[], sizeOf: (item: T) => number, bounds: Rect): Placed<T>[] {
  const total = items.reduce((s, it) => s + sizeOf(it), 0);
  if (total <= 0 || bounds.w <= 0 || bounds.h <= 0) return [];
  const scale = (bounds.w * bounds.h) / total;
  const cells = items
    .map((item) => ({ item, area: sizeOf(item) * scale }))
    .filter((c) => c.area > 0);

  const out: Placed<T>[] = [];
  let { x, y, w, h } = bounds;
  let row: typeof cells = [];
  let rowArea = 0;

  const worst = (areaSum: number, min: number, max: number, side: number) => {
    const s2 = areaSum * areaSum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const flush = () => {
    if (!row.length) return;
    if (w >= h) {
      const colW = rowArea / h;
      let cy = y;
      for (const c of row) {
        const ch = c.area / colW;
        out.push({ item: c.item, x, y: cy, w: colW, h: ch });
        cy += ch;
      }
      x += colW;
      w -= colW;
    } else {
      const rowH = rowArea / w;
      let cx = x;
      for (const c of row) {
        const cw = c.area / rowH;
        out.push({ item: c.item, x: cx, y, w: cw, h: rowH });
        cx += cw;
      }
      y += rowH;
      h -= rowH;
    }
    row = [];
    rowArea = 0;
  };

  for (const cell of cells) {
    const side = Math.min(w, h);
    if (row.length) {
      const areas = row.map((c) => c.area);
      const current = worst(rowArea, Math.min(...areas), Math.max(...areas), side);
      const next = worst(
        rowArea + cell.area,
        Math.min(cell.area, ...areas),
        Math.max(cell.area, ...areas),
        side,
      );
      if (next > current) flush();
    }
    row.push(cell);
    rowArea += cell.area;
  }
  flush();
  return out;
}
