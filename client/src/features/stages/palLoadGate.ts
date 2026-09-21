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

// Blank batchNumber = legacy aggregate: those lines group per order item, so
// the gate degrades to "whole order item palletised" for legacy data.
export const batchKey = (l: PalPlanLine) => `${l.orderItemId}|${l.batchNumber}`;

/** Ids of lines loadable NOW: ReadyToLoad and un-boxed. Since CR-248 the palletized part of a
    batch loads even while the rest of the batch is still being palletized (CR-151's
    whole-batch gate is reversed); `groupProgressOf` only feeds the "300 of 400 palletized" note. */
export function loadableLineIds(allLines: PalPlanLine[]): Set<string> {
  return new Set(allLines.filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId).map((l) => l.id));
}
