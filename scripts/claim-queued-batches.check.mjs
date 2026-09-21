/* Self-check for claimQueuedBatches (CR-249) — run:  node scripts/claim-queued-batches.check.mjs
   Lifts the pure function out of data-ops/index.js (it is not exported). */
import assert from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../functions/data-ops/index.js", import.meta.url), "utf8");
const claim = (0, eval)(`(${src.slice(src.indexOf("function claimQueuedBatches"), src.indexOf("/** Apply the claims"))})`);

const row = (p) => ({ order_item: "1", status: "Planning", load_box: null, CREATEDTIME: "a", ...p });
const rows = [
  row({ ROWID: "3", batch_number: "B001", boxes: "460", box_brand: "br1", CREATEDTIME: "2026-09-21 12:57:55:357" }),
  row({ ROWID: "2", batch_number: "B534", boxes: "60", box_brand: "br2", CREATEDTIME: "2026-09-21 12:57:55:309" }),
  row({ ROWID: "4", batch_number: "", boxes: "100" }), // blank batch is never a donor
  row({ ROWID: "5", batch_number: "B9", boxes: "50", status: "ReadyToLoad" }), // already palletized
  row({ ROWID: "6", batch_number: "B9", boxes: "50", order_item: "2" }), // another item
];
const left = new Map();
// Oldest batch first; the shared `left` map stops two lines claiming the same boxes.
assert.deepStrictEqual(claim(rows, "1", 100, left).map((c) => [c.batch, c.take]), [["B534", 60], ["B001", 40]]);
assert.deepStrictEqual(claim(rows, "1", 300, left).map((c) => [c.batch, c.take, c.brand]), [["B001", 300, "br1"]]);
assert.deepStrictEqual([...left].map(([k, v]) => [k, v.was, v.left]), [["2", 60, 0], ["3", 460, 120]]);
// Never more than the queue holds.
assert.strictEqual(claim(rows, "1", 900, new Map()).reduce((n, c) => n + c.take, 0), 520);
console.log("claimQueuedBatches self-check passed");
