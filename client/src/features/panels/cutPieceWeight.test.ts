/* Self-check for cutPieceWeight — run with:  npx tsx client/src/features/panels/cutPieceWeight.test.ts */
import assert from "node:assert";
import { cutPieceWeight, parseCutSize, weightPerPc } from "./cutPieceWeight";

const tile = { boxWeightKg: 28.8, pcsPerBox: 2, widthMm: 600, lengthMm: 1200 }; // 14.4 kg / pc

assert.strictEqual(weightPerPc(tile), 14.4);
assert.strictEqual(weightPerPc({ ...tile, boxWeightKg: 0 }), null, "no box weight → unknown");
assert.deepStrictEqual(parseCutSize("600x600"), { w: 600, h: 600 });
assert.deepStrictEqual(parseCutSize(" 300 × 600 mm "), { w: 300, h: 600 });
assert.strictEqual(parseCutSize("Strip"), null);

assert.strictEqual(cutPieceWeight(tile, "600x1200"), 14.4, "full size = whole piece");
assert.strictEqual(cutPieceWeight(tile, "600x600"), 7.2, "half the face = half the weight");
assert.strictEqual(cutPieceWeight(tile, "300x600"), 3.6);
assert.strictEqual(cutPieceWeight(tile, "600x300"), 3.6, "orientation-free");
assert.strictEqual(cutPieceWeight(tile, "Strip"), 14.4, "unparseable name = full piece");
assert.strictEqual(cutPieceWeight(tile, "1200x1200"), 14.4, "never above a full tile");
assert.strictEqual(cutPieceWeight({ ...tile, widthMm: 0 }, "600x600"), 14.4, "no tile dims = full piece");
assert.strictEqual(cutPieceWeight({ ...tile, pcsPerBox: 0 }, "600x600"), null);

console.log("cutPieceWeight: all checks passed");
