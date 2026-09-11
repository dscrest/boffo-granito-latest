/* Self-check for productionSheetEdit — run with:  npx tsx client/src/features/stages/productionSheetEdit.test.ts
   Plain asserts, no framework (same style as quotes/planProgress.test.ts). */
import assert from "node:assert";
import { capFor, resolveSheetEdit } from "./productionSheetEdit";
import type { ProductionEntry } from "./productionApi";

// SO-linked line: 500 requested, nothing produced, order wants 800 (300 made elsewhere).
const entry = (over: Partial<ProductionEntry> = {}): ProductionEntry =>
  ({
    id: "1",
    stage: "New",
    qtyRequested: 500,
    producedSoFar: 0,
    orderItemId: "oi1",
    ordered: 800,
    produced: 300,
    ...over,
  }) as ProductionEntry;

// Untouched row → nothing to do, no error.
{
  const r = resolveSheetEdit(entry(), {});
  assert.deepStrictEqual(r, { ops: {}, error: null });
}

// Line cap (500) is tighter than the order's remaining (500 too) — 501 rejected.
{
  assert.strictEqual(capFor(entry(), {}), 500);
  assert.strictEqual(resolveSheetEdit(entry(), { qty: "501" }).error, "Only 500 boxes left to produce");
  assert.deepStrictEqual(resolveSheetEdit(entry(), { qty: "500" }).ops, { record: 500 });
}

// Order remaining beats the line cap: 700 requested but only 500 left on the order.
{
  const e = entry({ qtyRequested: 700 });
  assert.strictEqual(capFor(e, {}), 500);
  assert.strictEqual(resolveSheetEdit(e, { qty: "600" }).error, "Only 500 boxes left to produce");
}

// Independent (make-to-stock) line — only its own remaining caps it.
{
  const e = entry({ orderItemId: "", ordered: 0, produced: 0, qtyRequested: 700 });
  assert.strictEqual(capFor(e, {}), 700);
  assert.deepStrictEqual(resolveSheetEdit(e, { qty: "700" }).ops, { record: 700 });
}

// Raising In Production raises the recordable cap in the same pass.
{
  const e = entry({ qtyRequested: 100, ordered: 800, produced: 0 });
  assert.deepStrictEqual(resolveSheetEdit(e, { inProd: "400", qty: "400" }).ops, { qtyRequested: 400, record: 400 });
  assert.strictEqual(resolveSheetEdit(e, { inProd: "400", qty: "401" }).error, "Only 400 boxes left to produce");
}

// Plan qty locks once output exists (/production-update 409s).
{
  const e = entry({ producedSoFar: 120 });
  assert.strictEqual(resolveSheetEdit(e, { inProd: "600" }).error, "Output already recorded — quantity is locked");
  // …but recording more output on that line is still fine: 500 − 120 left.
  assert.deepStrictEqual(resolveSheetEdit(e, { qty: "380" }).ops, { record: 380 });
  assert.strictEqual(resolveSheetEdit(e, { qty: "381" }).error, "Only 380 boxes left to produce");
}

// Plan qty can't exceed the order, and can't be zeroed.
{
  assert.strictEqual(resolveSheetEdit(entry(), { inProd: "900" }).error, "Exceeds the order (800 boxes)");
  assert.strictEqual(resolveSheetEdit(entry(), { inProd: "0" }).error, "In Production must be more than 0");
}

// Retyping the same numbers is not a change; a different stage is.
{
  assert.deepStrictEqual(resolveSheetEdit(entry(), { inProd: "500", stage: "New" }).ops, {});
  assert.deepStrictEqual(resolveSheetEdit(entry(), { stage: "InProduction" }).ops, { stage: "InProduction" });
}

// All three at once → three ops.
{
  const r = resolveSheetEdit(entry({ produced: 0 }), { inProd: "600", qty: "600", stage: "Completed" });
  assert.deepStrictEqual(r, { ops: { qtyRequested: 600, record: 600, stage: "Completed" }, error: null });
}

console.log("productionSheetEdit: ok");
