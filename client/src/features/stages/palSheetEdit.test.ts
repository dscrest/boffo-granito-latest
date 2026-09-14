/* Self-check for palSheetEdit — run with:  npx tsx client/src/features/stages/palSheetEdit.test.ts
   Plain asserts, no framework (same style as productionSheetEdit.test.ts). */
import assert from "node:assert";
import { hasOps, resolvePalSheetEdit } from "./palSheetEdit";
import type { PalPlanLine } from "./palPlansApi";

const line = (over: Partial<PalPlanLine> = {}): PalPlanLine =>
  ({ id: "1", status: "Planning", boxes: 100, palletId: "pal1", designId: "d1", ...over }) as PalPlanLine;

const donor = (over: Partial<PalPlanLine> = {}): PalPlanLine =>
  ({ id: "d-1", status: "Planning", boxes: 40, designId: "d1", batchNumber: "B/2026-09/001", ...over }) as PalPlanLine;

// Untouched row → nothing to do, no error.
{
  const r = resolvePalSheetEdit(line(), [], undefined);
  assert.deepStrictEqual(r, { ops: {}, error: null });
  assert.strictEqual(hasOps(r.ops), false);
  assert.deepStrictEqual(resolvePalSheetEdit(line(), [], { qty: "" }), { ops: {}, error: null });
}

// Record: full and partial qty both resolve; the split happens server-side.
{
  assert.deepStrictEqual(resolvePalSheetEdit(line(), [], { qty: "100" }).ops, { record: { boxes: 100 } });
  assert.deepStrictEqual(resolvePalSheetEdit(line({ status: "Palletizing" }), [], { qty: "30" }).ops, { record: { boxes: 30 } });
}

// Record rejections: over the line, zero, already recorded, no pallet.
{
  assert.strictEqual(resolvePalSheetEdit(line(), [], { qty: "101" }).error, "Only 100 boxes on this line");
  assert.strictEqual(resolvePalSheetEdit(line(), [], { qty: "0" }).error, "Boxes must be more than 0");
  assert.strictEqual(resolvePalSheetEdit(line({ status: "ReadyToLoad" }), [], { qty: "10" }).error, "Already recorded");
  assert.strictEqual(resolvePalSheetEdit(line({ palletId: "" }), [], { qty: "10" }).error, "No pallet on record — use the + menu");
}

// Top-up: donor + qty on an In-Palletization line with a pallet.
{
  const r = resolvePalSheetEdit(line({ status: "Palletizing" }), [donor()], { donorId: "d-1", qty: "25" });
  assert.deepStrictEqual(r.ops, { topUp: { donorId: "d-1", boxes: 25 } });
  assert.strictEqual(hasOps(r.ops), true);
}

// Top-up rejections: wrong stage, stale donor, missing/over qty.
{
  assert.strictEqual(resolvePalSheetEdit(line(), [donor()], { donorId: "d-1", qty: "10" }).error, "Start palletisation first");
  assert.strictEqual(resolvePalSheetEdit(line({ status: "Palletizing", palletId: "" }), [donor()], { donorId: "d-1", qty: "10" }).error, "Start palletisation first");
  assert.strictEqual(resolvePalSheetEdit(line({ status: "Palletizing" }), [], { donorId: "d-1", qty: "10" }).error, "That batch is no longer available");
  assert.strictEqual(resolvePalSheetEdit(line({ status: "Palletizing" }), [donor()], { donorId: "d-1" }).error, "Enter the boxes to move from that batch");
  assert.strictEqual(resolvePalSheetEdit(line({ status: "Palletizing" }), [donor()], { donorId: "d-1", qty: "41" }).error, "Only 40 boxes in that batch");
}

console.log("palSheetEdit: all checks passed");
