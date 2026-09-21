/* Self-check for productionLogSheetEdit — run with:  npx tsx client/src/features/stages/productionLogSheetEdit.test.ts
   Plain asserts, no framework (same style as productionSheetEdit.test.ts). */
import assert from "node:assert";
import { blankRow, designIndex, parsePaste, resolveLogSheet, type LogRow } from "./productionLogSheetEdit";

const row = (over: Partial<LogRow>): LogRow => ({ ...blankRow(), ...over });

// Blank rows are skipped; a blank date falls back to the sheet date.
{
  const { lines, errors, totalBoxes } = resolveLogSheet([row({}), row({ design: "11", qty: "40" }), row({ design: "12", qty: "5", date: "2026-09-20" }), row({})], "2026-09-21");
  assert.equal(lines.length, 2);
  assert.equal(errors.size, 0);
  assert.equal(totalBoxes, 45);
  assert.deepEqual(lines.map((l) => l.date), ["2026-09-21", "2026-09-20"]);
}

// Qty without an item, item without a qty, pasted text that matched nothing.
{
  const a = row({ qty: "10" });
  const b = row({ design: "11" });
  const c = row({ unmatched: "NO SUCH ITEM", qty: "3" });
  const { errors } = resolveLogSheet([a, b, c], "2026-09-21");
  assert.deepEqual([...errors.get(a.key)!], ["design"]);
  assert.deepEqual([...errors.get(b.key)!], ["qty"]);
  assert.deepEqual([...errors.get(c.key)!], ["design"]);
}

// Same item + same typed batch twice → both rows flagged; blank batches and other items are fine.
{
  const a = row({ design: "11", qty: "1", batch: "B-7" });
  const b = row({ design: "11", qty: "1", batch: "b-7 " });
  const c = row({ design: "12", qty: "1", batch: "B-7" });
  const d = row({ design: "11", qty: "1" });
  const e = row({ design: "11", qty: "1" });
  const { errors } = resolveLogSheet([a, b, c, d, e], "2026-09-21");
  assert.deepEqual([...errors.keys()].sort(), [a.key, b.key].sort());
}

// Excel paste: fills left to right from the focused column; day-first dates; unknown item kept as text.
{
  const designByKey = designIndex([{ id: "11", sku: "SKU-1", uniqueName: "Alpha 600x1200", designName: "Alpha" }]);
  const lookups = { designByKey, brandByName: new Map([["boffo", "91"]]) };
  const out = parsePaste("sku-1\tB-1\t20/09/2026\t1,200\tBoffo\thello\r\nGhost\t\t\t5\n", "design", lookups);
  assert.deepEqual(out[0], { design: "11", unmatched: "", batch: "B-1", date: "2026-09-20", qty: "1200", brand: "91", note: "hello" });
  assert.deepEqual(out[1], { design: "", unmatched: "Ghost", batch: "", date: "", qty: "5" });
  // Pasting a qty column only.
  assert.deepEqual(parsePaste("10\n20", "qty", lookups), [{ qty: "10" }, { qty: "20" }]);
}

console.log("productionLogSheet ok");
