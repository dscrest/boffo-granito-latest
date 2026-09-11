/* Sheet edit mode (Production, sheet view) — turns one row's staged draft into
   the server ops to run, or an error explaining why it can't commit. Pure, so
   the quantity caps are testable without React (productionSheetEdit.test.ts).
   The server is still the source of truth; this is the pre-flight that keeps
   Save disabled instead of firing a 409. */
import type { ProductionEntry, ProductionStage } from "./productionApi";

/** What the user typed in one sheet row (empty string = untouched cell). */
export type SheetDraft = { inProd?: string; qty?: string; stage?: ProductionStage };

/** What Save must do for that row (absent key = nothing to do). */
export type SheetOps = { qtyRequested?: number; record?: number; stage?: ProductionStage };

const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** The plan qty this row will have after Save (drafted value, else current). */
export function effectiveRequested(e: ProductionEntry, d: SheetDraft): number {
  return num(d.inProd) ?? e.qtyRequested;
}

/** Boxes still recordable on this row — mirrors RecordOutputForm.capFor(),
    but reading the drafted plan qty so raising In Production raises the cap. */
export function capFor(e: ProductionEntry, d: SheetDraft): number {
  const lineRemaining = Math.max(0, effectiveRequested(e, d) - e.producedSoFar);
  const orderRemaining = e.orderItemId ? Math.max(0, e.ordered - e.produced) : Infinity;
  return Math.min(lineRemaining, orderRemaining);
}

/** null error = committable. Empty ops = nothing changed on this row. */
export function resolveSheetEdit(e: ProductionEntry, d: SheetDraft): { ops: SheetOps; error: string | null } {
  const ops: SheetOps = {};

  const inProd = num(d.inProd);
  if (inProd != null && inProd !== e.qtyRequested) {
    // /production-update refuses a qty change once any output exists.
    if (e.producedSoFar > 0) return { ops: {}, error: "Output already recorded — quantity is locked" };
    if (inProd <= 0) return { ops: {}, error: "In Production must be more than 0" };
    if (e.orderItemId && inProd > e.ordered) return { ops: {}, error: `Exceeds the order (${e.ordered} boxes)` };
    ops.qtyRequested = inProd;
  }

  const qty = num(d.qty);
  if (qty != null && qty > 0) {
    const cap = capFor(e, d);
    if (qty > cap) return { ops: {}, error: `Only ${cap} boxes left to produce` };
    ops.record = qty;
  } else if (qty != null && qty < 0) {
    return { ops: {}, error: "Produced must be more than 0" };
  }

  if (d.stage && d.stage !== e.stage) ops.stage = d.stage;

  return { ops, error: null };
}

export function hasOps(ops: SheetOps): boolean {
  return ops.qtyRequested != null || ops.record != null || ops.stage != null;
}
