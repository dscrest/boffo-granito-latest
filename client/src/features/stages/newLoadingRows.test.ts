/* Self-check for newLoadingRows — run with:  npx tsx client/src/features/stages/newLoadingRows.test.ts
   Plain asserts, no framework (same style as allocateFifo.test.ts). */
import assert from "node:assert";
import { batchSummary, groupReady, itemOptions, openLines, spreadQty } from "./newLoadingRows";
import type { PalPlanLine } from "./palPlansApi";

const line = (p: Partial<PalPlanLine>): PalPlanLine =>
  ({ status: "ReadyToLoad", loadBoxId: "", boxBrandId: "", soBoxBrandId: "", customerBoxBrandId: "", createdTime: "", soNumber: "", ...p }) as PalPlanLine;

const all = [
  line({ id: "a", salesOrderId: "10", orderItemId: "o1", designId: "grey", batchNumber: "B1", boxes: 150, createdTime: "1", soBoxBrandId: "so-brand" }),
  line({ id: "b", salesOrderId: "10", orderItemId: "o1", designId: "grey", batchNumber: "B2", boxes: 50, createdTime: "2", boxBrandId: "own" }),
  // B3 is half palletized: 300 ready, 200 still Planning → loadable, flagged partial (CR-248).
  line({ id: "c", salesOrderId: "10", orderItemId: "o2", designId: "nero", batchNumber: "B3", boxes: 300, createdTime: "3" }),
  line({ id: "c2", salesOrderId: "10", orderItemId: "o2", designId: "nero", batchNumber: "B3", boxes: 200, status: "Planning" }),
  line({ id: "d", salesOrderId: "11", orderItemId: "o3", designId: "white", batchNumber: "B4", boxes: 80 }),
  line({ id: "boxed", salesOrderId: "11", orderItemId: "o3", designId: "white", batchNumber: "B4", boxes: 20, loadBoxId: "x" }),
  line({ id: "other", salesOrderId: "12", orderItemId: "o4", designId: "grey", batchNumber: "B5", boxes: 10, customerId: "zed" }),
];

const bands = groupReady(all, (l) => l.customerId !== "zed");
// Newest SO first; the other customer and the boxed line are out.
assert.deepStrictEqual(bands.map((b) => b.salesOrderId), ["11", "10"]);
const [grey, nero] = bands[1].designs;
assert.deepStrictEqual(grey.lines.map((p) => p.line.id), ["a", "b"]); // FIFO
assert.strictEqual(grey.ready, 200);
assert.strictEqual(grey.brandId, "so-brand"); // first line: own → SO → customer
// Half-palletized batch: its palletized part loads; `partial` only carries the progress note.
assert.deepStrictEqual(nero.lines[0].partial, { done: 300, total: 500 });
assert.strictEqual(grey.lines[0].partial, undefined);
assert.strictEqual(nero.ready, 300);
assert.deepStrictEqual(openLines(nero).map((l) => l.id), ["c"]);
assert.strictEqual(bands[0].designs[0].ready, 80);

// Design qty spreads FIFO; a retype rewrites every line (stale picks cleared); sum-back holds.
const s = spreadQty(openLines(grey), 170);
assert.deepStrictEqual([...s], [["a", 150], ["b", 20]]);
assert.deepStrictEqual([...spreadQty(openLines(grey), 40)], [["a", 40], ["b", 0]]);
assert.strictEqual([...spreadQty(openLines(grey), 999).values()].reduce((x, y) => x + y, 0), 200);

// Item Table (CR-256): one row per item — unticked batches are never drawn on; an item on a row leaves the list.
assert.deepStrictEqual([...spreadQty(openLines(grey), 170, new Set(["a"]))], [["a", 0], ["b", 50]]);
assert.strictEqual(batchSummary(openLines(grey)), "All 2 batches");
assert.strictEqual(batchSummary(openLines(grey), new Set(["a"])), "B2");
assert.strictEqual(batchSummary(openLines(nero)), "B3");
assert.strictEqual(itemOptions(bands).length, 3);
assert.deepStrictEqual(itemOptions(bands, new Set([grey.key])).map((o) => o.value).includes(grey.key), false);

console.log("newLoadingRows self-check passed");
