/* Self-check for containerPack — run with:  npx tsx client/src/features/quotes/containerPack.test.ts
   Same style as planProgress.test.ts: plain asserts, no framework. */
import assert from "node:assert";
import { cellsOfSegs, emptyCells, packItemWise } from "./containerPack";

// Exact fit → one container.
{
  const r = packItemWise([{ idx: 0, qty: 200 }], () => 200);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0], [{ idx: 0, boxes: 200 }]);
}

// Overflow spawns extra containers with the remainder in the last.
{
  const r = packItemWise([{ idx: 0, qty: 500 }], () => 200);
  assert.deepStrictEqual(r.map((c) => c[0].boxes), [200, 200, 100]);
}

// Two lines pack item-wise in order — no mixing at baseline.
{
  const r = packItemWise([{ idx: 0, qty: 250 }, { idx: 1, qty: 100 }], (idx) => (idx === 0 ? 200 : 120));
  assert.deepStrictEqual(r, [
    [{ idx: 0, boxes: 200 }],
    [{ idx: 0, boxes: 50 }],
    [{ idx: 1, boxes: 100 }],
  ]);
}

// Zero-capacity line is skipped, others still pack.
{
  const r = packItemWise([{ idx: 0, qty: 50 }, { idx: 1, qty: 60 }], (idx) => (idx === 0 ? 0 : 60));
  assert.deepStrictEqual(r, [[{ idx: 1, boxes: 60 }]]);
}

// Per-position capacity (weight mode with per-container ton overrides).
{
  const r = packItemWise([{ idx: 0, qty: 300 }], (_idx, pos) => (pos === 0 ? 100 : 200));
  assert.deepStrictEqual(r.map((c) => c[0].boxes), [100, 200]);
}

// Cells: ceil(boxes / boxesPerPallet) per seg, at least 1.
{
  assert.deepStrictEqual(cellsOfSegs([{ idx: 0, boxes: 25 }], () => 10), [0, 0, 0]);
  assert.deepStrictEqual(cellsOfSegs([{ idx: 0, boxes: 1 }, { idx: 2, boxes: 20 }], () => 10), [0, 2, 2]);
}

// Empty cells: capacity minus used, never negative, zero when full.
{
  assert.strictEqual(emptyCells(0.5, 20, 10), 10);
  assert.strictEqual(emptyCells(1, 20, 20), 0);
  assert.strictEqual(emptyCells(0.9, 10, 12), 0); // used beyond nominal cap → clamp
}

console.log("containerPack self-check OK");
