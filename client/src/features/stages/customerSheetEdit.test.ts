/* Self-check for customerSheetEdit — run with:  npx tsx client/src/features/stages/customerSheetEdit.test.ts
   Plain asserts, no framework (same style as productionSheetEdit.test.ts). */
import assert from "node:assert";
import { palletNumbers, palletRanges, resolveCustomerSheet } from "./customerSheetEdit";

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

// Manual Pallet No. wins; blank/whitespace falls back to the auto range, and the
// auto cursor still counts the manual row's pallets (CR-184).
{
  const r = palletNumbers([
    { id: "a", boxes: 276, boxesPerPallet: 18, palletNo: " A-1 TO A-16 " },
    { id: "b", boxes: 276, boxesPerPallet: 18, palletNo: "  " },
  ]);
  assert.strictEqual(r.get("a"), "A-1 TO A-16");
  assert.strictEqual(r.get("b"), "17 TO 32");
}

const current = {
  boxes: {
    b1: { containerNumber: "MSCU1", lrNumber: "", electronicSeal: "", lineSeal: "", vehicleNumber: "GJ-01-AB-1234" },
  },
  lines: { l1: { palletNo: "", palletType: "" }, l2: { palletNo: "5 TO 9", palletType: "Wooden" } },
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
    boxes: { b1: { container_number: "MSCU1", lr_number: "  LR-77  ", vehicle_number: "GJ-01-AB-1234" } },
    lines: {},
    sos: { s1: { poNumber: "PO-9" } },
  });
  assert.deepStrictEqual(r.boxOps, [{ id: "b1", patch: { lr_number: "LR-77" } }]);
  assert.deepStrictEqual(r.soOps, []);
  assert.strictEqual(r.dirty, true);
}

// A changed truck number is emitted as text (the save resolves it to a Vehicle
// ROWID); a blanked truck cell is "leave as-is", never an empty vehicle.
{
  const r = resolveCustomerSheet(current, {
    boxes: { b1: { vehicle_number: "GJ-02-KK-9999" } },
    lines: {},
    sos: {},
  });
  assert.deepStrictEqual(r.boxOps, [{ id: "b1", patch: { vehicle_number: "GJ-02-KK-9999" } }]);
  const blank = resolveCustomerSheet(current, { boxes: { b1: { vehicle_number: "  " } }, lines: {}, sos: {} });
  assert.strictEqual(blank.dirty, false);
}

// Pallet type (CR-208): typed on l1, cleared on l2 (→ "" = blank).
{
  const r = resolveCustomerSheet(current, {
    boxes: {},
    lines: { l1: { palletType: " Plastic " }, l2: { palletType: "" } },
    sos: {},
  });
  assert.deepStrictEqual(r.lineOps, [
    { id: "l1", patch: { pallet_type: "Plastic" } },
    { id: "l2", patch: { pallet_type: "" } },
  ]);
}

// Pallet No.: typed on l1, cleared on l2 (→ "" back to auto); both fields of a
// line land in ONE patch; an unchanged value is dropped.
{
  const r = resolveCustomerSheet(current, {
    boxes: {},
    lines: { l1: { palletNo: " 1 TO 4 ", palletType: "Plastic" }, l2: { palletNo: "" } },
    sos: {},
  });
  assert.deepStrictEqual(r.lineOps, [
    { id: "l1", patch: { pallet_no: "1 TO 4", pallet_type: "Plastic" } },
    { id: "l2", patch: { pallet_no: "" } },
  ]);
  const same = resolveCustomerSheet(current, { boxes: {}, lines: { l2: { palletNo: "5 TO 9" } }, sos: {} });
  assert.strictEqual(same.dirty, false);
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
