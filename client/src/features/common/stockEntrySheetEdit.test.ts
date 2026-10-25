/* Self-check for stockEntrySheetEdit — run with:  npx tsx client/src/features/common/stockEntrySheetEdit.test.ts */
import assert from "node:assert";
import { blankRow, parseEntryPaste, resolveEntrySheet, type EntryRow } from "./stockEntrySheetEdit";

const row = (over: Partial<EntryRow>): EntryRow => ({ ...blankRow(), ...over });

// Receipt: positive lines, blank rows skipped, cut size required.
{
  const { lines, errors, totalIn } = resolveEntrySheet(
    [row({ design: "d1", second: "c1", qty: "10" }), row({}), row({ design: "d1", qty: "3" }), row({ design: "", second: "c1", qty: "0" })],
    { signed: false, secondRequired: true },
  );
  assert.strictEqual(lines.length, 3, "blank row skipped, bad rows still listed");
  assert.strictEqual(totalIn, 13);
  assert.deepStrictEqual([...errors.get(lines[1].key)!], ["second"], "missing cut size flagged");
  assert.deepStrictEqual([...errors.get(lines[2].key)!].sort(), ["design", "qty"]);
}

// Adjustment: `dir` signs the qty; totals split in/out; duplicate pair flagged on both rows.
{
  const a = row({ design: "d1", second: "B1", dir: "out", qty: "4" });
  const b = row({ design: "d1", second: "b1", dir: "in", qty: "6" });
  const { lines, errors, totalIn, totalOut } = resolveEntrySheet([a, b, row({ design: "d2", qty: "2", dir: "out" })], { signed: true, secondRequired: false });
  assert.deepStrictEqual(lines.map((l) => l.qty), [-4, 6, -2]);
  assert.strictEqual(totalIn, 6);
  assert.strictEqual(totalOut, 6);
  assert.ok(errors.get(a.key)!.has("design") && errors.get(b.key)!.has("design"), "same item + batch twice (case-insensitive) flagged");
  assert.strictEqual(errors.has(lines[2].key), false, "blank batch is fine on the box sheet");
}

// Paste: item text → id, cut size by name, "-5" flips direction, unknown item kept as placeholder.
{
  const lookups = { designByKey: new Map([["onyx grey", { id: "d1" }]]), secondByName: new Map([["600x600", "c1"]]) };
  const p = parseEntryPaste("Onyx Grey\t600x600\tremove\t5\tbroken\nNope\t600x600\t\t-2", "design", lookups);
  assert.deepStrictEqual(p[0], { design: "d1", unmatched: "", second: "c1", dir: "out", qty: "5", note: "broken" });
  assert.strictEqual(p[1].unmatched, "Nope");
  assert.strictEqual(p[1].dir, "out", "a negative qty means remove");
  assert.strictEqual(p[1].qty, "2");
  // Box sheet: the second column is a batch number, kept as typed.
  assert.deepStrictEqual(parseEntryPaste("B/2026-10/003\tremove\t7", "second", { designByKey: new Map() })[0], { second: "B/2026-10/003", dir: "out", qty: "7" });
}

// CR-438: the same pair at two Locations is NOT a duplicate; the line carries the row's Location; paste maps it.
{
  const a = row({ design: "d1", second: "c1", qty: "2", warehouse: "w1" });
  const b = row({ design: "d1", second: "c1", qty: "3", warehouse: "w2" });
  const c = row({ design: "d1", second: "c1", qty: "1" });
  const { lines, errors } = resolveEntrySheet([a, b, c], { signed: false, secondRequired: true });
  assert.strictEqual(errors.size, 0, "one pair at two bays (and once at the bar's) is fine");
  assert.deepStrictEqual(lines.map((l) => l.warehouse), ["w1", "w2", ""]);
  const p = parseEntryPaste("main ▸ a1\nnowhere", "warehouse", { designByKey: new Map(), warehouseByName: new Map([["main ▸ a1", "w1"], ["a1", "w1"]]) });
  assert.deepStrictEqual(p, [{ warehouse: "w1" }, { warehouse: "" }]);
}

console.log("stockEntrySheetEdit: all checks passed");
