/* ============================================================
   newLoadingRows — pure shaping for the Loading Session's pick list (SessionItemsStep)
   (CR-201/202). Ready-for-Loading lines → Sales Order bands → design
   rows → batch sub-rows (the actual PalPlanLines, FIFO). A batch that is
   only partly palletized is loadable all the same (CR-248) — `partial`
   just carries its progress for a "300 of 400 palletized" note.
   Type-only imports keep the self-check runnable under plain tsx.
   ============================================================ */
import { allocateFifo } from "./allocateFifo";
import { batchKey, groupProgressOf } from "./palLoadGate";
import type { PalPlanLine } from "./palPlansApi";

export interface PickLine {
  line: PalPlanLine;
  /** Set when the line's batch is only partly palletized — a note, never a block (CR-248). */
  partial?: { done: number; total: number };
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
  customerName: string;
  designs: DesignRow[];
}

/** Un-boxed Ready-for-Loading lines in `scope`, banded newest SO first.
    `allLines` must be EVERY line (boxed + completed plans) — the gate needs them. */
export function groupReady(allLines: PalPlanLine[], scope: (l: PalPlanLine) => boolean): SoBand[] {
  const prog = groupProgressOf(allLines, batchKey);
  const bands = new Map<string, SoBand>();
  const rows = new Map<string, DesignRow>();
  const pool = allLines
    .filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId && scope(l))
    .sort((a, b) => Number(b.salesOrderId) - Number(a.salesOrderId) || a.createdTime.localeCompare(b.createdTime));
  for (const l of pool) {
    const band = bands.get(l.salesOrderId) ?? bands.set(l.salesOrderId, { salesOrderId: l.salesOrderId, soNumber: l.soNumber || l.salesOrderId, customerName: l.customerName || "", designs: [] }).get(l.salesOrderId)!;
    const key = `${l.salesOrderId}|${l.designId}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, designId: l.designId, designLabel: l.designLabel, brandId: l.boxBrandId || l.soBoxBrandId || l.customerBoxBrandId, lines: [], ready: 0 };
      rows.set(key, row);
      band.designs.push(row);
    }
    const g = prog.get(batchKey(l))!;
    row.lines.push(g.done < g.total ? { line: l, partial: g } : { line: l });
    row.ready += l.boxes;
  }
  return [...bands.values()];
}

/** Lines of a design row — what a typed quantity may draw on. */
export const openLines = (row: DesignRow) => row.lines.map((p) => p.line);

/** A design-level quantity spread FIFO over its batches → qty per line id
    (every open line gets an entry, 0 when untouched, so a retype clears stale picks).
    `skip` = batches the row has unticked: never drawn on, always 0. */
export function spreadQty(lines: PalPlanLine[], want: number, skip?: Set<string>): Map<string, number> {
  const out = new Map(lines.map((l) => [l.id, 0]));
  const use = lines.filter((l) => !skip?.has(l.id));
  for (const e of allocateFifo(use.map((l) => ({ id: l.id, boxes: l.boxes })), want))
    out.set(e.lineId, e.boxes ?? use.find((l) => l.id === e.lineId)!.boxes);
  return out;
}

/* ---- Item Table (CR-247 → CR-256: ONE row per item, its batches combined) ---- */
interface Opt { value: string; label: string; hint?: string; badge?: string }

/** "SO/…/006 · Customer" — whose stock a row is, now that a loading lists every customer (CR-252). */
export const bandLabel = (b: SoBand) => [b.soNumber, b.customerName].filter(Boolean).join(" · ");

/** Item pick list: one option per design row (value = row.key), loadable designs first;
    `takenRows` = items another table row already holds (one row per item). */
export const itemOptions = (bands: SoBand[], takenRows?: Set<string>): Opt[] =>
  bands
    .flatMap((b) => b.designs.filter((r) => !takenRows?.has(r.key)).map((r) => ({ r, o: { value: r.key, label: `${r.designLabel} · ${bandLabel(b)}`, hint: `${r.ready} boxes ready` } })))
    .sort((a, b) => Number(b.r.ready > 0) - Number(a.r.ready > 0))
    .map((x) => x.o);

export const batchLabel = (l: PalPlanLine) => l.batchNumber || "Unbatched stock";

/** The row's batch cell: "All 3 batches" / the one batch / "2 of 3 batches". */
export function batchSummary(lines: PalPlanLine[], skip?: Set<string>): string {
  const on = lines.filter((l) => !skip?.has(l.id));
  if (on.length === 1) return batchLabel(on[0]);
  return on.length === lines.length ? `All ${lines.length} batches` : `${on.length} of ${lines.length} batches`;
}

/** "300 of 400 palletized" — the rest of the batch is still to come. */
export const partialNote = (g: { done: number; total: number }) => `${g.done} of ${g.total} palletized`;
