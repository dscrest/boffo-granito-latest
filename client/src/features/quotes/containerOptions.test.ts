/* Self-check for containerOptions — run with:  npx tsx client/src/features/quotes/containerOptions.test.ts */
import assert from "node:assert";
import { containerOptions, formatsForPallet, resolveFormatBySize } from "./containerOptions";

const designs = [
  { uniqueName: "A - 600x1200", designName: "A", sizeId: "s1", sizeLabel: "600x1200" },
  { uniqueName: "B - 600x1200", designName: "B", sizeId: "s1", sizeLabel: "600x1200" },
  { uniqueName: "C - 600x600", designName: "C", sizeId: "s2", sizeLabel: "600x600" },
];
const formats = [{ id: "f1", name: "600x1200 · 28 pallets = 896 boxes", sizeId: "s1", totalPallets: 28, totalBoxes: 896 }];
const two = [...formats, { id: "f2", name: "600x1200 · 20 pallets = 640 boxes", sizeId: "s1", totalPallets: 20, totalBoxes: 640 }];

// Two items of one size add up; 1000 boxes over 896/container → 2 containers, last at 12%.
{
  const r = containerOptions([{ item: "A - 600x1200", qty: 600 }, { item: "B - 600x1200", qty: 400 }], designs, formats);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].boxes, 1000);
  assert.strictEqual(r[0].containers, 2);
  assert.strictEqual(r[0].lastFillPct, 12);
}
// Exact multiple → last container 100%.
{
  const r = containerOptions([{ item: "A - 600x1200", qty: 1792 }], designs, formats);
  assert.strictEqual(r[0].containers, 2);
  assert.strictEqual(r[0].lastFillPct, 100);
}
// A size with no container format is listed with no format and 0 containers; blank / zero lines skipped.
{
  const r = containerOptions([{ item: "C - 600x600", qty: 50 }, { item: "", qty: 5 }, { item: "A - 600x1200", qty: 0 }], designs, formats);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].format, null);
  assert.strictEqual(r[0].containers, 0);
}
// CR-273: a size with two formats gets one row per format, same boxes, own container count.
{
  const r = containerOptions([{ item: "A - 600x1200", qty: 1000 }], designs, two);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map((x) => x.format?.id), ["f1", "f2"]);
  assert.deepStrictEqual(r.map((x) => x.containers), [2, 2]);
  assert.deepStrictEqual(r.map((x) => x.boxes), [1000, 1000]);
}
// CR-274: no pick → the size's largest; a pick wins; a stale / foreign-size pick falls back to largest.
{
  assert.strictEqual(resolveFormatBySize(two).get("s1")?.id, "f1");
  assert.strictEqual(resolveFormatBySize(two, { s1: "f2" }).get("s1")?.id, "f2");
  assert.strictEqual(resolveFormatBySize(two, { s1: "gone" }).get("s1")?.id, "f1");
  assert.strictEqual(resolveFormatBySize(two, { s2: "f2" }).get("s1")?.id, "f1");
  assert.strictEqual(resolveFormatBySize(two, { s2: "f2" }).has("s2"), false);
}
// CR-300: a row's containers narrow to those built from its pallet; none use it → all of the size;
// a pick outside the narrowed list is ignored (largest narrowed wins).
{
  const withLines = [
    { id: "f1", sizeId: "s1", totalBoxes: 896, lines: [{ palletId: "p1" }] },
    { id: "f2", sizeId: "s1", totalBoxes: 640, lines: [{ palletId: "p2" }] },
    { id: "f3", sizeId: "s1", totalBoxes: 320, lines: [{ palletId: "p2" }, { palletId: "p1" }] },
    { id: "f4", sizeId: "s2", totalBoxes: 100, lines: [{ palletId: "p1" }] },
  ];
  assert.deepStrictEqual(formatsForPallet(withLines, "s1", "p2").map((x) => x.id), ["f2", "f3"]);
  assert.deepStrictEqual(formatsForPallet(withLines, "s1", "p9").map((x) => x.id), ["f1", "f2", "f3"]);
  assert.deepStrictEqual(formatsForPallet(withLines, "s1", "").map((x) => x.id), ["f1", "f2", "f3"]);
  assert.deepStrictEqual(formatsForPallet(withLines, "s3", "p1"), []);
  const narrowed = formatsForPallet(withLines, "s1", "p2");
  assert.strictEqual(resolveFormatBySize(narrowed, {}).get("s1")?.id, "f2");
  assert.strictEqual(resolveFormatBySize(narrowed, { s1: "f3" }).get("s1")?.id, "f3");
  assert.strictEqual(resolveFormatBySize(narrowed, { s1: "f1" }).get("s1")?.id, "f2");
}
console.log("containerOptions: ok");
