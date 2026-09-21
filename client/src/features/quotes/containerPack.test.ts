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

// Grouped lines share ONE container (fractional fill), created where the first grouped line lands.
{
  const r = packItemWise(
    [{ idx: 0, qty: 200 }, { idx: 0, qty: 100, group: "g" }, { idx: 1, qty: 300 }, { idx: 1, qty: 200, group: "g" }],
    (idx) => (idx === 0 ? 200 : 400),
  );
  assert.deepStrictEqual(r, [
    [{ idx: 0, boxes: 200 }],
    [{ idx: 0, boxes: 100 }, { idx: 1, boxes: 200 }], // 100/200 + 200/400 = 100% full
    [{ idx: 1, boxes: 300 }],
  ]);
}

// A grouped line beyond the group container's free space spills item-wise.
{
  const r = packItemWise([{ idx: 0, qty: 150, group: "g" }, { idx: 1, qty: 500, group: "g" }], (idx) => (idx === 0 ? 200 : 400));
  assert.deepStrictEqual(r, [
    [{ idx: 0, boxes: 150 }, { idx: 1, boxes: 100 }], // 25% free of 400 = 100
    [{ idx: 1, boxes: 400 }],
  ]);
}

// CR-196 override: an `over` group lands whole past 100%, in either row order.
{
  const cap = (idx: number) => (idx === 0 ? 200 : 400);
  const owner = { idx: 0, qty: 200, group: "g", over: true };
  const moved = { idx: 1, qty: 100, group: "g", over: true };
  assert.deepStrictEqual(packItemWise([owner, moved], cap), [[{ idx: 0, boxes: 200 }, { idx: 1, boxes: 100 }]]);
  assert.deepStrictEqual(packItemWise([moved, owner], cap), [[{ idx: 1, boxes: 100 }, { idx: 0, boxes: 200 }]]);
  // same item topping up its own full container merges into one seg
  assert.deepStrictEqual(packItemWise([owner, { idx: 0, qty: 40, group: "g", over: true }], cap), [[{ idx: 0, boxes: 240 }]]);
  // an unpackable line (cap < 1) is still skipped, override or not
  assert.deepStrictEqual(packItemWise([{ idx: 0, qty: 50, group: "g", over: true }], () => 0), []);
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
