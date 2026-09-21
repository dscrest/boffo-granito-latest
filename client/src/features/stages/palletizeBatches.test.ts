/* Self-check for palletizeBatches — run with:  npx tsx client/src/features/stages/palletizeBatches.test.ts */
import assert from "node:assert";
import { unqueuedByItem } from "./palletizeBatches";

const got = unqueuedByItem(
  [
    { orderItemId: "o1", batchNumber: "B2", qtyBoxes: 80, createdTime: "2" },
    { orderItemId: "o1", batchNumber: "B1", qtyBoxes: 100, createdTime: "1" },
    { orderItemId: "o1", batchNumber: "B1", qtyBoxes: 20, createdTime: "3" }, // alloc tops up B1
    { orderItemId: "o1", batchNumber: "", qtyBoxes: 5, createdTime: "0" }, // batch-less supply ignored
    { orderItemId: "o2", batchNumber: "B9", qtyBoxes: 50, createdTime: "1" },
  ],
  [
    { orderItemId: "o1", batchNumber: "B1", boxes: 70 },
    { orderItemId: "o2", batchNumber: "B9", boxes: 50 }, // fully queued → item drops out
  ],
);
assert.deepStrictEqual(got.get("o1"), [
  { batch: "B1", available: 50 }, // FIFO: earliest record first
  { batch: "B2", available: 80 },
]);
assert.strictEqual(got.has("o2"), false);
console.log("palletizeBatches ok");
