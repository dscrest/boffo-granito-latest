/* Batch-complete loading gate — pure, no fetching (type-only import keeps the
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
const batchKey = (l: PalPlanLine) => `${l.orderItemId}|${l.batchNumber}`;

/** Ids of lines loadable NOW: ReadyToLoad, un-boxed, and the whole batch group
    (same order item + batch) fully palletised — a partially palletised batch
    never reaches the loading pools. Feed ALL lines (boxed + Completed plans
    included) or split siblings deflate the totals. */
export function loadableLineIds(allLines: PalPlanLine[]): Set<string> {
  const prog = groupProgressOf(allLines, batchKey);
  const ids = new Set<string>();
  for (const l of allLines) {
    if (l.status !== "ReadyToLoad" || l.loadBoxId) continue;
    const g = prog.get(batchKey(l))!;
    if (g.done >= g.total) ids.add(l.id);
  }
  return ids;
}
