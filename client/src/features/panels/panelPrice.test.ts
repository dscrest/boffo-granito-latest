/* Self-check for panelPrice — run with:  npx tsx client/src/features/panels/panelPrice.test.ts */
import assert from "node:assert";
import { lineAmount, lineRate, mdfPrice, orderAmount, panelPriceParts, piecePrice, pieceSqft, vinylPrice } from "./panelPrice";

const item = { ratePerSqft: 50, widthMm: 600, lengthMm: 1200, sizeLabel: "600x1200" };
const near = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-5, `${a} ≈ ${b}`);

near(pieceSqft("600x600"), 3.875008);
near(pieceSqft("300x600"), pieceSqft("600x300")!); // orientation-free
near(pieceSqft("", item), 7.750016); // blank = full tile
near(pieceSqft("600x1200", item), 7.750016);
assert.strictEqual(pieceSqft("Strip", item), null, "unparseable, not the item size");

assert.strictEqual(piecePrice(item, "600x600"), 193.75);
assert.strictEqual(piecePrice({ ...item, ratePerSqft: 0 }, "600x600"), 0, "no rate → 0");
assert.strictEqual(piecePrice(item, "Strip"), 0, "unknown size → 0");
assert.strictEqual(piecePrice(undefined, "600x600"), 0);

const panel = { vinylSize: "", panelSize: "1200x2100", vinylRateSqft: 10, lines: [{ designId: "d1", cutSizeName: "600x600", qty: 4 }] };
assert.strictEqual(vinylPrice(panel), 271.25, "blank vinyl size falls back to the panel size");
assert.strictEqual(vinylPrice({ ...panel, vinylSize: "600x600" }), 38.75);
assert.strictEqual(mdfPrice({ weightKg: 20, ratePerKg: 35 }), 700);
assert.strictEqual(mdfPrice({ weightKg: null, ratePerKg: 35 }), 0);
assert.strictEqual(mdfPrice(undefined), 0, "no thickness picked");
assert.deepStrictEqual(panelPriceParts(panel, { weightKg: 20, ratePerKg: 35 }, () => item), { vinyl: 271.25, mdf: 700, pieces: 775 });

assert.strictEqual(lineRate({ vinylPrice: null, mdfPrice: null, piecesPrice: null, qty: 2 }), null, "legacy line");
assert.strictEqual(lineRate({ vinylPrice: 271.25, mdfPrice: 700, piecesPrice: 775, qty: 2 }), 1746.25);
assert.strictEqual(lineAmount({ vinylPrice: 271.25, mdfPrice: 700, piecesPrice: 775, qty: 2 }), 3492.5);
assert.strictEqual(lineAmount({ vinylPrice: null, mdfPrice: null, piecesPrice: 193.75, qty: 3 }), 581.25, "cut-piece line");
assert.strictEqual(orderAmount([{ amount: 3492.5 }, { amount: 581.25 }]), 4073.75);
assert.strictEqual(orderAmount([{ amount: 10 }, { amount: null }]), null, "never a partial sum");
assert.strictEqual(orderAmount([]), null);

console.log("panelPrice: all checks passed");
