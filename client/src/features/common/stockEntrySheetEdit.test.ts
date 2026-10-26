/* Self-check for stockEntrySheetEdit — run with:  npx tsx client/src/features/common/stockEntrySheetEdit.test.ts */
import assert from "node:assert";
import { blankAdjustRow, blankRow, parseEntryPaste, resolveAdjustLines, resolveEntrySheet, type AdjustRow, type EntryRow } from "./stockEntrySheetEdit";

const row = (over: Partial<EntryRow>): EntryRow => ({ ...blankRow(), ...over });
const adj = (over: Partial<AdjustRow>): AdjustRow => ({ ...blankAdjustRow({ date: "2026-10-25", warehouse: "w1", reason: "Breakage" }), ...over });

// Receipt: positive lines, blank rows skipped, cut size required.
{
  const { lines, errors, total } = resolveEntrySheet(
    [row({ design: "d1", second: "c1", qty: "10" }), row({}), row({ design: "d1", qty: "3" }), row({ design: "", second: "c1", qty: "0" })],
    { secondRequired: true },
  );
  assert.strictEqual(lines.length, 3, "blank row skipped, bad rows still listed");
  assert.strictEqual(total, 13);
  assert.deepStrictEqual([...errors.get(lines[1].key)!], ["second"], "missing cut size flagged");
  assert.deepStrictEqual([...errors.get(lines[2].key)!].sort(), ["design", "qty"]);
}

// CR-446 adjustment form: Remove signs the qty; totals split; every row counts; date / reason / location required.
{
  const a = adj({ design: "d1", second: "B1", qty: "4" });
  const b = adj({ design: "d1", second: "b1", out: false, qty: "6", reason: "Count correction" });
  const c = adj({ design: "d2", qty: "2" });
  const { lines, errors, totalIn, totalOut } = resolveAdjustLines([a, b, c], { secondRequired: false, warehouseRequired: true });
  assert.deepStrictEqual(lines.map((l) => l.qty), [-4, 6, -2]);
  assert.strictEqual(totalIn, 6);
  assert.strictEqual(totalOut, 6);
  assert.strictEqual(errors.size, 0, "same pair with a different reason is a legitimate second line");
  assert.deepStrictEqual(lines.map((l) => l.reason), ["Breakage", "Count correction", "Breakage"]);
  const dup = adj({ design: "d1", second: "b1", qty: "1" });
  const r2 = resolveAdjustLines([a, dup], { secondRequired: false, warehouseRequired: true });
  assert.ok(r2.errors.get(a.key)!.has("design") && r2.errors.get(dup.key)!.has("design"), "same item · batch · location · date · reason twice flagged on both");
  const bad = adj({ design: "", second: "", qty: "0", date: "25/10/2026", reason: " ", warehouse: "" });
  const r3 = resolveAdjustLines([bad], { secondRequired: true, warehouseRequired: true });
  assert.deepStrictEqual([...r3.errors.get(bad.key)!].sort(), ["date", "design", "qty", "reason", "second", "warehouse"]);
  assert.strictEqual(r3.lines.length, 1, "no blank-row skipping on the form");
  const r4 = resolveAdjustLines([adj({ design: "d1", qty: "1", warehouse: "" })], { secondRequired: false, warehouseRequired: false });
  assert.strictEqual(r4.errors.size, 0, "location optional while warehouses are dormant; blank batch fine on the box shape");
}

// Paste: item text → id, cut size by name, unknown item kept as placeholder.
{
  const lookups = { designByKey: new Map([["onyx grey", { id: "d1" }]]), secondByName: new Map([["600x600", "c1"]]) };
  const p = parseEntryPaste("Onyx Grey\t600x600\t5\tbroken\nNope\t600x600\t2", "design", lookups);
  assert.deepStrictEqual(p[0], { design: "d1", unmatched: "", second: "c1", qty: "5", note: "broken" });
  assert.strictEqual(p[1].unmatched, "Nope");
  assert.strictEqual(p[1].qty, "2");
  // Box sheet: the second column is a batch number, kept as typed.
  assert.deepStrictEqual(parseEntryPaste("B/2026-10/003\t7", "second", { designByKey: new Map() })[0], { second: "B/2026-10/003", qty: "7" });
}

// CR-438: the same pair at two Locations is NOT a duplicate; the line carries the row's Location; paste maps it.
{
  const a = row({ design: "d1", second: "c1", qty: "2", warehouse: "w1" });
  const b = row({ design: "d1", second: "c1", qty: "3", warehouse: "w2" });
  const c = row({ design: "d1", second: "c1", qty: "1" });
  const { lines, errors } = resolveEntrySheet([a, b, c], { secondRequired: true });
  assert.strictEqual(errors.size, 0, "one pair at two bays (and once at the bar's) is fine");
  assert.deepStrictEqual(lines.map((l) => l.warehouse), ["w1", "w2", ""]);
  const p = parseEntryPaste("main ▸ a1\nnowhere", "warehouse", { designByKey: new Map(), warehouseByName: new Map([["main ▸ a1", "w1"], ["a1", "w1"]]) });
  assert.deepStrictEqual(p, [{ warehouse: "w1" }, { warehouse: "" }]);
}

console.log("stockEntrySheetEdit: all checks passed");
