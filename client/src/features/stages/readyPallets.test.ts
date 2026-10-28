/* Self-check for readyPalletsLabel (CR-279) — run with:  npx tsx client/src/features/stages/readyPallets.test.ts
   Plain asserts, no framework (same style as palSheetEdit.test.ts). */
import assert from "node:assert";
import { readyPalletsLabel } from "./palLoadGate";

// CR-481: WHOLE pallets only — a partial pallet is not a pallet; unknown capacity shows boxes only, nothing done = dash.
assert.strictEqual(readyPalletsLabel(480, 60), "8 (480)");
assert.strictEqual(readyPalletsLabel(481, 60), "8 (480)");
import { looseBoxes, palletBoxes, wholePallets } from "./palLoadGate";
// The user's example: 23 boxes on an 18-box pallet = 1 pallet · 18 boxes · 5 need palletization.
assert.strictEqual(wholePallets(23, 18), 1);
assert.strictEqual(palletBoxes(23, 18), 18);
assert.strictEqual(looseBoxes(23, 18), 5);
assert.strictEqual(wholePallets(17, 18), 0);
assert.deepStrictEqual([wholePallets(23, 0), palletBoxes(23, 0), looseBoxes(23, 0)], [0, 0, 23]);
assert.strictEqual(readyPalletsLabel(60, 0), "(60)");
assert.strictEqual(readyPalletsLabel(0, 60), "—");
// Formatter is applied to both numbers.
assert.strictEqual(readyPalletsLabel(1040, 65, (n) => n.toLocaleString("en-IN")), "16 (1,040)");

console.log("readyPallets.test.ts: ok");

// CR-472: progress is per order item × BATCH — a loaded sibling batch never bleeds into
// another batch's Ready Pallets / Remaining (live shape: 234234 loaded 100, 456456 palletizing 35).
import { batchKey, groupProgressOf } from "./palLoadGate";
import type { PalPlanLine } from "./palPlansApi";
const line = (batchNumber: string, boxes: number, status: string, loadBoxId = ""): PalPlanLine =>
  ({ orderItemId: "oi1", batchNumber, boxes, status, loadBoxId } as unknown as PalPlanLine);
const prog = groupProgressOf([line("234234", 100, "ReadyToLoad", "box1"), line("456456", 35, "Palletizing")], batchKey);
assert.deepStrictEqual(prog.get("oi1|234234"), { done: 100, total: 100 });
assert.deepStrictEqual(prog.get("oi1|456456"), { done: 0, total: 35 });
assert.strictEqual(readyPalletsLabel(prog.get("oi1|456456")!.done, 27), "—");
// Once 27 of the 35 are recorded (split line) the batch reads 1 pallet (27) · remaining 8.
const split = groupProgressOf([line("456456", 27, "ReadyToLoad"), line("456456", 8, "Palletizing")], batchKey);
assert.strictEqual(readyPalletsLabel(split.get("oi1|456456")!.done, 27), "1 (27)");
assert.strictEqual(split.get("oi1|456456")!.total - split.get("oi1|456456")!.done, 8);
console.log("readyPallets.test.ts (CR-472 per batch): ok");
