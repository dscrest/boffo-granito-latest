/* ============================================================
   containerPack — the pure container-packing math shared by the SO/Quote
   planner (PlanContainerisation).
   Item-wise pack: each container starts with a single item, in line order;
   a line that exceeds one container's capacity spawns extra containers.
   Manual moves/DnD stay in the planner — this is just the baseline.
   ============================================================ */

export const PACK_EPS = 1e-6;

/** A line's boxes inside one container. */
export interface PackSeg {
  idx: number; // caller's line index
  boxes: number;
}

/**
 * Baseline item-wise pack, strictly in line order: take = min(left, capacity),
 * overflow spawns the next container. `capOf(idx, pos)` is the boxes one
 * container at position `pos` can hold of line `idx` on its own (pallet-format
 * capacity in boxes mode; ton cap / box weight in weight mode). A line whose
 * capacity is < 1 is skipped (unpackable).
 */
export function packItemWise(
  lines: { idx: number; qty: number }[],
  capOf: (idx: number, pos: number) => number,
): PackSeg[][] {
  const list: PackSeg[][] = [];
  for (const l of lines) {
    let left = l.qty;
    while (left > 0) {
      const cap = capOf(l.idx, list.length);
      if (cap < 1) break;
      const take = Math.min(left, cap);
      list.push([{ idx: l.idx, boxes: take }]);
      left -= take;
    }
  }
  return list;
}

/** Colored pallet cells of a container: per seg, ceil(boxes / boxes-per-pallet)
    cells carrying the seg's line idx (caller maps idx → color/label). */
export function cellsOfSegs(segs: PackSeg[], boxesPerPalletOf: (idx: number) => number): number[] {
  const cells: number[] = [];
  for (const s of segs) {
    const bpp = Math.max(1, boxesPerPalletOf(s.idx));
    const n = Math.max(1, Math.ceil(s.boxes / bpp));
    for (let k = 0; k < n; k++) cells.push(s.idx);
  }
  return cells;
}

/** Empty (hatched) cells = capacity in pallet units minus used; 0 when full. */
export function emptyCells(fill: number, capCells: number, used: number): number {
  if (fill >= 1 - PACK_EPS) return 0;
  return Math.max(0, Math.max(used, capCells) - used);
}
