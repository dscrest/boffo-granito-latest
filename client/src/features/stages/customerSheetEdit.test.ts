/* Self-check for customerSheetEdit — run with:  npx tsx client/src/features/stages/customerSheetEdit.test.ts
   Plain asserts, no framework (same style as productionSheetEdit.test.ts). */
import assert from "node:assert";
import { palletRanges, resolveCustomerSheet } from "./customerSheetEdit";

// Running range: 276 boxes @ 18/plt = 16 pallets → "1 TO 16", next 276 → "17 TO 32".
{
  const r = palletRanges([
    { id: "a", boxes: 276, boxesPerPallet: 18 },
    { id: "b", boxes: 276, boxesPerPallet: 18 },
  ]);
  assert.strictEqual(r.get("a"), "1 TO 16");
  assert.strictEqual(r.get("b"), "17 TO 32");
}

// A single-pallet line renders a bare number, and the cursor still advances.
{
  const r = palletRanges([
    { id: "a", boxes: 10, boxesPerPallet: 48 },
    { id: "b", boxes: 96, boxesPerPallet: 48 },
  ]);
  assert.strictEqual(r.get("a"), "1");
  assert.strictEqual(r.get("b"), "2 TO 3");
}

// Unknown pallet spec: blank range, cursor unchanged for the next line.
{
  const r = palletRanges([
    { id: "a", boxes: 100, boxesPerPallet: 0 },
    { id: "b", boxes: 48, boxesPerPallet: 48 },
  ]);
  assert.strictEqual(r.get("a"), "");
  assert.strictEqual(r.get("b"), "1");
}

// Ranges are per call — the caller resets per container (fresh call → cursor 1).
{
  const r = palletRanges([{ id: "c", boxes: 240, boxesPerPallet: 15 }]);
  assert.strictEqual(r.get("c"), "1 TO 16");
}

const current = {
  boxes: {
    b1: { containerNumber: "MSCU1", lrNumber: "", electronicSeal: "", lineSeal: "", vehicleId: "v1" },
  },
  lines: { l1: "", l2: "brandA" },
  sos: { s1: "PO-9" },
};

// Untouched drafts → nothing to do.
{
  const r = resolveCustomerSheet(current, { boxes: {}, lines: {}, sos: {} });
  assert.deepStrictEqual(r, { boxOps: [], lineOps: [], soOps: [], dirty: false });
}

// Only changed keys are emitted; unchanged/whitespace-equal values are dropped.
{
  const r = resolveCustomerSheet(current, {
    boxes: { b1: { container_number: "MSCU1", lr_number: "  LR-77  ", vehicle: "v1" } },
    lines: {},
    sos: { s1: { poNumber: "PO-9" } },
  });
  assert.deepStrictEqual(r.boxOps, [{ id: "b1", patch: { lr_number: "LR-77" } }]);
  assert.deepStrictEqual(r.soOps, []);
  assert.strictEqual(r.dirty, true);
}

// Brand override: set on l1, cleared on l2 (→ null unsets the FK).
{
  const r = resolveCustomerSheet(current, {
    boxes: {},
    lines: { l1: { boxBrandId: "brandB" }, l2: { boxBrandId: "" } },
    sos: {},
  });
  assert.deepStrictEqual(r.lineOps, [
    { id: "l1", patch: { box_brand: "brandB" } },
    { id: "l2", patch: { box_brand: null } },
  ]);
}

// A draft for an unknown box id is ignored (row disappeared on refresh).
{
  const r = resolveCustomerSheet(current, {
    boxes: { ghost: { lr_number: "X" } },
    lines: {},
    sos: {},
  });
  assert.strictEqual(r.dirty, false);
}

console.log("customerSheetEdit self-check passed");
