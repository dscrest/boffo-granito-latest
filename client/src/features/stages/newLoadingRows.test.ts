/* Self-check for newLoadingRows — run with:  npx tsx client/src/features/stages/newLoadingRows.test.ts
   Plain asserts, no framework (same style as allocateFifo.test.ts). */
import assert from "node:assert";
import { batchSummary, groupReady, itemOptions, openLines, palletBoxesLabel, palletSplit, palletsOfLine, pickerEntries, readyLabel, spreadPallets, spreadQty } from "./newLoadingRows";
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

// Pallets (CR-258): full pallets + loose remainder; bpp 0 = all loose.
assert.deepStrictEqual(palletSplit(390, 32), { pallets: 12, loose: 6 });
assert.deepStrictEqual(palletSplit(64, 32), { pallets: 2, loose: 0 });
assert.deepStrictEqual(palletSplit(390, 0), { pallets: 0, loose: 390 });
assert.strictEqual(palletBoxesLabel(390, 32), "12 pallets + 6 boxes");
assert.strictEqual(palletBoxesLabel(32, 32), "1 pallet");
assert.strictEqual(palletBoxesLabel(1, 32), "1 box");
assert.strictEqual(palletBoxesLabel(0, 32), "0 boxes");

// Pallets typed on the Item Table (CR-258): whole pallets oldest batch first; round-trips with the ceil display.
const pl = [
  line({ id: "p1", boxes: 150, boxesPerPallet: 32 }), // 5 pallets (4 full + 22)
  line({ id: "p2", boxes: 50, boxesPerPallet: 32 }), // 2 pallets (1 full + 18)
  line({ id: "p3", boxes: 40, boxesPerPallet: 0 }), // pallet-less: one lump
];
assert.strictEqual(palletsOfLine(150, 32), 5);
assert.strictEqual(palletsOfLine(0, 32), 0);
assert.strictEqual(palletsOfLine(40, 0), 1);
assert.deepStrictEqual([...spreadPallets(pl, 5)], [["p1", 150], ["p2", 0], ["p3", 0]]);
assert.deepStrictEqual([...spreadPallets(pl, 6)], [["p1", 150], ["p2", 32], ["p3", 0]]);
assert.deepStrictEqual([...spreadPallets(pl, 7)], [["p1", 150], ["p2", 50], ["p3", 0]]);
assert.deepStrictEqual([...spreadPallets(pl, 8)], [["p1", 150], ["p2", 50], ["p3", 40]]);
assert.deepStrictEqual([...spreadPallets(pl, 99)], [["p1", 150], ["p2", 50], ["p3", 40]]);
assert.deepStrictEqual([...spreadPallets(pl, 0)], [["p1", 0], ["p2", 0], ["p3", 0]]);
assert.deepStrictEqual([...spreadPallets(pl, 1, new Set(["p1"]))], [["p1", 0], ["p2", 32], ["p3", 0]]);
// The display count of what was spread equals what was typed (round trip).
const shown = (want: number) => [...spreadPallets(pl, want)].reduce((s, [id, n]) => s + palletsOfLine(n, pl.find((l) => l.id === id)!.boxesPerPallet), 0);
for (const w of [1, 2, 3, 4, 5, 6, 7, 8]) assert.strictEqual(shown(w), w);
assert.strictEqual(readyLabel({ lines: pl.map((l) => ({ line: l })), ready: 240 }), "8 pallets · 240 boxes");

// Mix Batch: lines sharing a palletGroup (both in scope) are ONE entry; a partner out of scope leaves a plain entry.
const mixed = [
  line({ id: "m1", salesOrderId: "20", orderItemId: "o5", designId: "grey", batchNumber: "B6", boxes: 6, createdTime: "1", palletGroup: "g1", boxesPerPallet: 32 }),
  line({ id: "m2", salesOrderId: "20", orderItemId: "o6", designId: "nero", batchNumber: "B7", boxes: 26, createdTime: "2", palletGroup: "g1", boxesPerPallet: 32 }),
  line({ id: "m3", salesOrderId: "20", orderItemId: "o6", designId: "nero", batchNumber: "B8", boxes: 10, createdTime: "3", palletGroup: "g2", boxesPerPallet: 32 }),
  line({ id: "m4", salesOrderId: "20", orderItemId: "o7", designId: "white", batchNumber: "B9", boxes: 22, createdTime: "4", palletGroup: "g2", boxesPerPallet: 32, loadBoxId: "x" }),
];
const entries = pickerEntries(groupReady(mixed, () => true));
assert.deepStrictEqual(entries.map((e) => [e.key, e.mixed, e.boxes]), [["g1", true, 32], ["m3", false, 10]]);
assert.deepStrictEqual(entries[0].lines.map((p) => [p.line.id, p.rowKey]), [["m1", "20|grey"], ["m2", "20|nero"]]);
assert.strictEqual(pickerEntries(bands).every((e) => !e.mixed), true);

console.log("newLoadingRows self-check passed");
