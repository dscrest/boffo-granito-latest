/* Loading pool + batch palletization progress — pure, no fetching (type-only import keeps the
   self-check runnable under plain node, same trade as batchLedger.ts). */
import type { PalPlanLine } from "./palPlansApi";

/** Palletised progress per group — done = boxes ReadyToLoad or in a box. */
export function groupProgressOf(
  lines: PalPlanLine[],
  keyOf: (l: PalPlanLine) => string,
): Map<string, { done: number; total: number }> {
  const m = new Map<string, { done: number; total: number }>();
  for (const l of lines) {
    const k = keyOf(l);
    const g = m.get(k) ?? m.set(k, { done: 0, total: 0 }).get(k)!;
    g.total += l.boxes;
    if (l.status === "ReadyToLoad" || l.loadBoxId) g.done += l.boxes;
  }
  return m;
}

/** CR-481: pallets are WHOLE — never a fraction (user: 23 boxes on an 18-box pallet =
    1 pallet, 18 boxes; the 5 stay as "need palletization" for a mixed-batch pallet). */
export const wholePallets = (boxes: number, boxesPerPallet: number) => (boxesPerPallet > 0 && boxes > 0 ? Math.floor(boxes / boxesPerPallet) : 0);
/** Boxes sitting on full pallets = wholePallets × capacity. */
export const palletBoxes = (boxes: number, boxesPerPallet: number) => wholePallets(boxes, boxesPerPallet) * boxesPerPallet;
/** Boxes left over below one pallet (unknown capacity → all of them). */
export const looseBoxes = (boxes: number, boxesPerPallet: number) => Math.max(0, boxes - palletBoxes(boxes, boxesPerPallet));

/** "N (boxes)" readout of palletized boxes as physical pallets (CR-279) —
    the Prepared Pallets column, its footer and the Complete dialog share it.
    Unknown pallet capacity → just "(boxes)"; nothing done → "—". CR-481: whole pallets
    and the boxes ON them (floor), never rounded up. */
export function readyPalletsLabel(doneBoxes: number, boxesPerPallet: number, fmtNum: (n: number) => string = String): string {
  if (doneBoxes <= 0) return "—";
  if (boxesPerPallet <= 0) return `(${fmtNum(doneBoxes)})`;
  return `${fmtNum(wholePallets(doneBoxes, boxesPerPallet))} (${fmtNum(palletBoxes(doneBoxes, boxesPerPallet))})`;
}

// Blank batchNumber = legacy aggregate: those lines group per order item, so
// the gate degrades to "whole order item palletised" for legacy data.
export const batchKey = (l: PalPlanLine) => `${l.orderItemId}|${l.batchNumber}`;

/** Ids of lines loadable NOW: ReadyToLoad and un-boxed. Since CR-248 the palletized part of a
    batch loads even while the rest of the batch is still being palletized (CR-151's
    whole-batch gate is reversed); `groupProgressOf` only feeds the "300 of 400 palletized" note. */
export function loadableLineIds(allLines: PalPlanLine[]): Set<string> {
  return new Set(allLines.filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId).map((l) => l.id));
}
