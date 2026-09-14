/* /loading Sheet edit mode (CR-173) — turns one row's staged draft into the
   /pal-line-box call to make, or an error explaining why it can't commit.
   Pure (loadSheetEdit.test.ts); mirrors palSheetEdit.ts. The server stays the
   source of truth — this only keeps ✓/Save disabled instead of firing a 409. */
import type { LoadBox, PalPlanLine } from "./palPlansApi";

/** What the user typed in one row (empty string = untouched cell). */
export type LoadSheetDraft = { qty?: string; boxId?: string };
export const UNLOAD = "__unload";

/** unload → setLineBox(id, ""); move → setLineBox(id, box, boxes?) — `boxes`
    only when fewer than the line holds (the rest returns to Ready for Loading). */
export type LoadSheetOps = { unload?: true; move?: { box: string; boxes?: number } };

const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export function resolveLoadSheetEdit(
  l: PalPlanLine,
  currentBox: LoadBox | undefined,
  openBoxes: LoadBox[],
  d: LoadSheetDraft | undefined,
): { ops: LoadSheetOps; error: string | null } {
  const qty = num(d?.qty);
  const boxId = d?.boxId || "";
  if (qty == null && !boxId) return { ops: {}, error: null };
  if (!currentBox || currentBox.status !== "Open") return { ops: {}, error: "Only items in an open loading can be edited" };
  if (boxId === UNLOAD) return { ops: { unload: true }, error: null };
  if (qty != null && qty <= 0) return { ops: {}, error: "Boxes must be more than 0" };
  if (qty != null && qty > l.boxes) return { ops: {}, error: `Only ${l.boxes} boxes on this line` };
  const box = boxId || currentBox.id;
  if (box !== currentBox.id && !openBoxes.some((b) => b.id === box)) return { ops: {}, error: "That loading is no longer open" };
  const boxes = qty != null && qty < l.boxes ? qty : undefined;
  if (box === currentBox.id && boxes === undefined) return { ops: {}, error: null }; // nothing changed
  return { ops: { move: { box, ...(boxes !== undefined ? { boxes } : {}) } }, error: null };
}

export function hasLoadOps(ops: LoadSheetOps): boolean {
  return ops.unload != null || ops.move != null;
}
