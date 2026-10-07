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
    .flatMap((b) => b.designs.filter((r) => !takenRows?.has(r.key)).map((r) => ({ r, o: { value: r.key, label: `${r.designLabel} · ${bandLabel(b)}`, hint: `${readyLabel(r)} ready` } })))
    .sort((a, b) => Number(b.r.ready > 0) - Number(a.r.ready > 0))
    .map((x) => x.o);

export const batchLabel = (l: PalPlanLine) => l.batchNumber || "Unbatched stock";

/** "7 pallets · 200 boxes" — what a row (or a customer) has ready, pallets first (CR-258). */
export const readyLabel = (r: { lines: PickLine[]; ready: number }) => {
  const p = r.lines.reduce((s, x) => s + palletsOfLine(x.line.boxes, x.line.boxesPerPallet), 0);
  return `${p} pallet${p === 1 ? "" : "s"} · ${r.ready} boxes`;
};

/** The row's batch cell: "All 3 batches" / the one batch / "2 of 3 batches". */
export function batchSummary(lines: PalPlanLine[], skip?: Set<string>): string {
  const on = lines.filter((l) => !skip?.has(l.id));
  if (on.length === 1) return batchLabel(on[0]);
  return on.length === lines.length ? `All ${lines.length} batches` : `${on.length} of ${lines.length} batches`;
}

/** "300 of 400 palletized" — the rest of the batch is still to come. */
export const partialNote = (g: { done: number; total: number }) => `${g.done} of ${g.total} palletized`;

/* ---- Batch picker in PALLETS (CR-258). Boxes stay the stored unit; a line reads
   as full pallets + the loose remainder, and Mix Batch partners (shared
   pallet_group = one physical pallet) collapse into one entry. ---- */

/** A line as it sits on the floor: full pallets + the loose remainder (bpp 0 → all loose). */
export const palletSplit = (boxes: number, bpp: number) =>
  bpp > 0 ? { pallets: Math.floor(boxes / bpp), loose: boxes % bpp } : { pallets: 0, loose: boxes };

/** Physical pallets a line stands on: ceil(boxes/bpp); a pallet-less line (bpp 0) is one lump. */
export const palletsOfLine = (boxes: number, bpp: number) => (boxes <= 0 ? 0 : bpp > 0 ? Math.ceil(boxes / bpp) : 1);

/** A design-level PALLET count spread oldest batch first → boxes per line id (every line gets an
    entry, 0 when untouched). Whole pallets only: k pallets of a line = min(line.boxes, k × bpp), so
    the count round-trips with the ceil display; a bpp-0 line is one all-or-nothing lump.
    `skip` = batches the row has unticked: never drawn on, always 0. */
export function spreadPallets(lines: PalPlanLine[], wantPallets: number, skip?: Set<string>): Map<string, number> {
  const out = new Map(lines.map((l) => [l.id, 0]));
  let left = Math.max(0, Math.floor(wantPallets) || 0);
  for (const l of lines) {
    if (left <= 0) break;
    if (skip?.has(l.id)) continue;
    const k = Math.min(left, palletsOfLine(l.boxes, l.boxesPerPallet));
    out.set(l.id, l.boxesPerPallet > 0 ? Math.min(l.boxes, k * l.boxesPerPallet) : l.boxes);
    left -= k;
  }
  return out;
}

/** "12 pallets + 6 boxes" / "12 pallets" / "6 boxes". */
export function palletBoxesLabel(boxes: number, bpp: number): string {
  const { pallets, loose } = palletSplit(boxes, bpp);
  const parts = [pallets > 0 && `${pallets} pallet${pallets === 1 ? "" : "s"}`, loose > 0 && `${loose} box${loose === 1 ? "" : "es"}`].filter(Boolean);
  return parts.join(" + ") || "0 boxes";
}

/** A picker line knows its Item Table row (a Mix Batch pallet may span two items). */
export type PickEntryLine = PickLine & { rowKey: string };
export interface PickEntry {
  key: string; // line id, or the shared palletGroup for a Mix Batch entry
  title: string;
  lines: PickEntryLine[];
  /** ONE physical pallet made of several batch lines — moves as a whole. */
  mixed: boolean;
  boxes: number;
  bpp: number;
}

/** Picker entries: one per line, except lines that share a palletGroup (both in scope)
    which become ONE Mix Batch entry. A partner out of scope (loaded, still Palletizing,
    filtered away) leaves its line a plain entry. */
export function pickerEntries(bands: SoBand[]): PickEntry[] {
  const flat: (PickEntryLine & { title: string })[] = bands.flatMap((b) =>
    b.designs.flatMap((r) => r.lines.map((p) => ({ ...p, rowKey: r.key, title: `${r.designLabel} · ${bandLabel(b)}` }))),
  );
  const groupSize = new Map<string, number>();
  for (const { line } of flat) if (line.palletGroup) groupSize.set(line.palletGroup, (groupSize.get(line.palletGroup) || 0) + 1);
  const out: PickEntry[] = [];
  const byGroup = new Map<string, PickEntry>();
  for (const { title, ...p } of flat) {
    const g = p.line.palletGroup;
    const grouped = g && (groupSize.get(g) || 0) > 1;
    const e = grouped ? byGroup.get(g) : undefined;
    if (e) {
      e.lines.push(p);
      e.boxes += p.line.boxes;
      if (!e.title.includes(title)) e.title += ` + ${title}`;
      continue;
    }
    const ne: PickEntry = { key: grouped ? g : p.line.id, title, lines: [p], mixed: !!grouped, boxes: p.line.boxes, bpp: p.line.boxesPerPallet };
    if (grouped) byGroup.set(g, ne);
    out.push(ne);
  }
  return out;
}
