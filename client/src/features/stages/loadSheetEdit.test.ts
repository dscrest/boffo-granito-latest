/* Self-check for loadSheetEdit — run with:  npx tsx client/src/features/stages/loadSheetEdit.test.ts
   Plain asserts, no framework (same style as palSheetEdit.test.ts). */
import assert from "node:assert";
import { hasLoadOps, resolveLoadSheetEdit, UNLOAD } from "./loadSheetEdit";
import type { LoadBox, PalPlanLine } from "./palPlansApi";

const line = (over: Partial<PalPlanLine> = {}): PalPlanLine =>
  ({ id: "1", status: "ReadyToLoad", boxes: 100, loadBoxId: "b1", ...over }) as PalPlanLine;
const box = (id: string, status: "Open" | "Dispatched" = "Open"): LoadBox => ({ id, status }) as LoadBox;
const b1 = box("b1");
const b2 = box("b2");
const open = [b1, b2];

// Untouched row → nothing to do, no error.
{
  const r = resolveLoadSheetEdit(line(), b1, open, undefined);
  assert.deepStrictEqual(r, { ops: {}, error: null });
  assert.strictEqual(hasLoadOps(r.ops), false);
  assert.deepStrictEqual(resolveLoadSheetEdit(line(), b1, open, { qty: "", boxId: "" }), { ops: {}, error: null });
}

// Same box, same/blank qty → no change; fewer boxes → partial (remainder back to Ready).
{
  assert.deepStrictEqual(resolveLoadSheetEdit(line(), b1, open, { qty: "100" }).ops, {});
  assert.deepStrictEqual(resolveLoadSheetEdit(line(), b1, open, { boxId: "b1" }).ops, {});
  assert.deepStrictEqual(resolveLoadSheetEdit(line(), b1, open, { qty: "60" }).ops, { move: { box: "b1", boxes: 60 } });
}

// Move to another open box, whole line or part of it.
{
  assert.deepStrictEqual(resolveLoadSheetEdit(line(), b1, open, { boxId: "b2" }).ops, { move: { box: "b2" } });
  assert.deepStrictEqual(resolveLoadSheetEdit(line(), b1, open, { boxId: "b2", qty: "40" }).ops, { move: { box: "b2", boxes: 40 } });
}

// Unload wins over any qty.
{
  const r = resolveLoadSheetEdit(line(), b1, open, { boxId: UNLOAD, qty: "5" });
  assert.deepStrictEqual(r.ops, { unload: true });
  assert.strictEqual(hasLoadOps(r.ops), true);
}

// Rejections: not in an open box, zero, over the line, target box gone.
{
  assert.strictEqual(resolveLoadSheetEdit(line({ loadBoxId: "" }), undefined, open, { qty: "10" }).error, "Only items in an open loading can be edited");
  assert.strictEqual(resolveLoadSheetEdit(line(), box("b1", "Dispatched"), open, { qty: "10" }).error, "Only items in an open loading can be edited");
  assert.strictEqual(resolveLoadSheetEdit(line(), b1, open, { qty: "0" }).error, "Boxes must be more than 0");
  assert.strictEqual(resolveLoadSheetEdit(line(), b1, open, { qty: "101" }).error, "Only 100 boxes on this line");
  assert.strictEqual(resolveLoadSheetEdit(line(), b1, open, { boxId: "b9" }).error, "That loading is no longer open");
}

console.log("loadSheetEdit: all checks passed");
