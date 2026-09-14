/* Sheet edit mode (/packing, sheet view) — turns one row's staged draft into
   the server op to run, or an error explaining why it can't commit. Pure, so
   the caps/gates are testable without React (palSheetEdit.test.ts). Mirrors
   productionSheetEdit.ts; the server is still the source of truth — this is
   the pre-flight that keeps Save disabled instead of firing a doomed 409. */
import type { PalPlanLine } from "./palPlansApi";

/** What the user typed in one sheet row (empty string = untouched cell). */
export type PalSheetDraft = { qty?: string; donorId?: string };

/** What Save must do for that row — the two ops are mutually exclusive:
    a donor picked means the qty is boxes moved FROM the donor (top-up),
    otherwise the qty is this line's boxes recorded as palletised. */
export type PalSheetOps = { record?: { boxes: number }; topUp?: { donorId: string; boxes: number } };

const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** null error = committable. Empty ops = nothing changed on this row. */
export function resolvePalSheetEdit(
  l: PalPlanLine,
  donors: PalPlanLine[],
  d: PalSheetDraft | undefined,
): { ops: PalSheetOps; error: string | null } {
  const qty = num(d?.qty);
  const donorId = d?.donorId || "";
  if (qty == null && !donorId) return { ops: {}, error: null };

  if (donorId) {
    // Top-up: same gate as the + menu — target must be In Palletization on a pallet.
    if (l.status !== "Palletizing" || !l.palletId) return { ops: {}, error: "Start palletisation first" };
    const donor = donors.find((x) => x.id === donorId);
    if (!donor) return { ops: {}, error: "That batch is no longer available" };
    if (qty == null || qty <= 0) return { ops: {}, error: "Enter the boxes to move from that batch" };
    if (qty > donor.boxes) return { ops: {}, error: `Only ${donor.boxes} boxes in that batch` };
    return { ops: { topUp: { donorId, boxes: qty } }, error: null };
  }

  // Record palletised: a partial qty splits the line server-side.
  if (l.status === "ReadyToLoad") return { ops: {}, error: "Already recorded" };
  if (qty == null || qty <= 0) return { ops: {}, error: "Boxes must be more than 0" };
  if (qty > l.boxes) return { ops: {}, error: `Only ${l.boxes} boxes on this line` };
  // /pal-line-status refuses ReadyToLoad without a pallet; rare post-CR-146
  // (size-default + backfill) but legacy rows can still be empty.
  if (!l.palletId) return { ops: {}, error: "No pallet on record — use the + menu" };
  return { ops: { record: { boxes: qty } }, error: null };
}

export function hasOps(ops: PalSheetOps): boolean {
  return ops.record != null || ops.topUp != null;
}
