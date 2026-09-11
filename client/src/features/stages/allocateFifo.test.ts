/* Self-check for allocateFifo — run with:  npx tsx client/src/features/stages/allocateFifo.test.ts
   Plain asserts, no framework (same style as customerSheetEdit.test.ts). */
import assert from "node:assert";
import { allocateFifo } from "./allocateFifo";

// Whole-line takes omit `boxes`; the closing partial carries it.
assert.deepStrictEqual(
  allocateFifo([{ id: "a", boxes: 100 }, { id: "b", boxes: 50 }], 120),
  [{ lineId: "a" }, { lineId: "b", boxes: 20 }],
);

// Want beyond the pool caps at what exists.
assert.deepStrictEqual(
  allocateFifo([{ id: "a", boxes: 30 }], 500),
  [{ lineId: "a" }],
);

// Want 0 (and negatives) allocate nothing; empty lines are skipped.
assert.deepStrictEqual(allocateFifo([{ id: "a", boxes: 30 }], 0), []);
assert.deepStrictEqual(allocateFifo([{ id: "a", boxes: 30 }], -5), []);
assert.deepStrictEqual(
  allocateFifo([{ id: "a", boxes: 0 }, { id: "b", boxes: 10 }], 10),
  [{ lineId: "b" }],
);

console.log("allocateFifo self-check passed");
