/* ============================================================
   newLoadingRows — pure shaping for the Loading Session's pick list (SessionItemsStep)
   (CR-201/202). Ready-for-Loading lines → Sales Order bands → design
   rows → batch sub-rows (the actual PalPlanLines, FIFO). A batch that is
   only partly palletised stays in the list, flagged `blocked`, so the
   user sees WHY it cannot load instead of a silently shorter list.
   Type-only imports keep the self-check runnable under plain tsx.
   ============================================================ */
import { allocateFifo } from "./allocateFifo";
import { batchKey, groupProgressOf, loadableLineIds } from "./palLoadGate";
import type { PalPlanLine } from "./palPlansApi";

export interface PickLine {
  line: PalPlanLine;
  /** Set when the line's batch is only partly palletised — not loadable yet. */
  blocked?: { done: number; total: number };
}
export interface DesignRow {
  key: string; // salesOrderId|designId
  designId: string;
  designLabel: string;
  /** Effective Box Brand: the line's own, else the SO's, else the customer's default. */
  brandId: string;
  lines: PickLine[]; // FIFO (creation order)
  ready: number; // loadable boxes
}
export interface SoBand {
  salesOrderId: string;
  soNumber: string;
  designs: DesignRow[];
}

/** Un-boxed Ready-for-Loading lines in `scope`, banded newest SO first.
    `allLines` must be EVERY line (boxed + completed plans) — the gate needs them. */
export function groupReady(allLines: PalPlanLine[], scope: (l: PalPlanLine) => boolean): SoBand[] {
  const loadable = loadableLineIds(allLines);
  const prog = groupProgressOf(allLines, batchKey);
  const bands = new Map<string, SoBand>();
  const rows = new Map<string, DesignRow>();
  const pool = allLines
    .filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId && scope(l))
    .sort((a, b) => Number(b.salesOrderId) - Number(a.salesOrderId) || a.createdTime.localeCompare(b.createdTime));
  for (const l of pool) {
    const band = bands.get(l.salesOrderId) ?? bands.set(l.salesOrderId, { salesOrderId: l.salesOrderId, soNumber: l.soNumber || l.salesOrderId, designs: [] }).get(l.salesOrderId)!;
    const key = `${l.salesOrderId}|${l.designId}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, designId: l.designId, designLabel: l.designLabel, brandId: l.boxBrandId || l.soBoxBrandId || l.customerBoxBrandId, lines: [], ready: 0 };
      rows.set(key, row);
      band.designs.push(row);
    }
    const ok = loadable.has(l.id);
    row.lines.push(ok ? { line: l } : { line: l, blocked: prog.get(batchKey(l)) });
    if (ok) row.ready += l.boxes;
  }
  return [...bands.values()];
}

/** Loadable lines of a design row — what a typed quantity may draw on. */
export const openLines = (row: DesignRow) => row.lines.filter((p) => !p.blocked).map((p) => p.line);

/** A design-level quantity spread FIFO over its batches → qty per line id
    (every open line gets an entry, 0 when untouched, so a retype clears stale picks). */
export function spreadQty(lines: PalPlanLine[], want: number): Map<string, number> {
  const out = new Map(lines.map((l) => [l.id, 0]));
  for (const e of allocateFifo(lines.map((l) => ({ id: l.id, boxes: l.boxes })), want))
    out.set(e.lineId, e.boxes ?? lines.find((l) => l.id === e.lineId)!.boxes);
  return out;
}
