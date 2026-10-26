/* Self-check for stockEntrySheetEdit — run with:  npx tsx client/src/features/common/stockEntrySheetEdit.test.ts */
import assert from "node:assert";
import { blankAdjustRow, blankRow, parseEntryPaste, parseSignedQty, resolveAdjustLines, resolveEntrySheet, type AdjustHeader, type AdjustRow, type EntryRow } from "./stockEntrySheetEdit";

const row = (over: Partial<EntryRow>): EntryRow => ({ ...blankRow(), ...over });
const adj = (over: Partial<AdjustRow>): AdjustRow => ({ ...blankAdjustRow({ warehouse: "w1" }), ...over });
const H: AdjustHeader = { mode: "quantity", date: "2026-10-25", reason: "Breakage", note: "", from: "", to: "" };

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

// CR-457 adjustment form: signed qty text; header date / reason on every line; totals split; every row counts.
{
  assert.deepStrictEqual(["10", "+10", "-5", "−5"].map(parseSignedQty), [10, 10, -5, -5]);
  assert.ok(["", "5-", "abc", "1.5"].every((s) => Number.isNaN(parseSignedQty(s))), "anything but an optionally signed integer is NaN");
  const a = adj({ design: "d1", second: "B1", qty: "4" });
  const b = adj({ design: "d1", second: "b1", qty: "-6", warehouse: "w2" });
  const c = adj({ design: "d2", qty: "+2" });
  const { lines, errors, hdrErrors, totalIn, totalOut } = resolveAdjustLines([a, b, c], H, { secondRequired: false, warehouseRequired: true });
  assert.deepStrictEqual(lines.map((l) => l.qty), [4, -6, 2]);
  assert.strictEqual(totalIn, 6);
  assert.strictEqual(totalOut, 6);
  assert.strictEqual(errors.size + hdrErrors.size, 0, "same pair at two locations is fine");
  assert.ok(lines.every((l) => l.date === "2026-10-25" && l.reason === "Breakage"), "header date + reason stamped on every line");
  const dup = adj({ design: "d1", second: "b1", qty: "1" });
  const r2 = resolveAdjustLines([a, dup], H, { secondRequired: false, warehouseRequired: true });
  assert.ok(r2.errors.get(a.key)!.has("design") && r2.errors.get(dup.key)!.has("design"), "same item · batch · location twice flagged on both");
  const bad = adj({ design: "", second: "", qty: "0", warehouse: "" });
  const r3 = resolveAdjustLines([bad, adj({ design: "d1", second: "c1", qty: "abc" })], { ...H, date: "25/10/2026", reason: " " }, { secondRequired: true, warehouseRequired: true });
  assert.deepStrictEqual([...r3.errors.get(bad.key)!].sort(), ["design", "qty", "second", "warehouse"]);
  assert.deepStrictEqual([...r3.errors.get(r3.lines[1].key)!], ["qty"]);
  assert.deepStrictEqual([...r3.hdrErrors].sort(), ["date", "reason"], "quantity mode never asks for From / To");
  assert.strictEqual(r3.lines.length, 2, "no blank-row skipping on the form");
  const r4 = resolveAdjustLines([adj({ design: "d1", qty: "1", warehouse: "" })], H, { secondRequired: false, warehouseRequired: false });
  assert.strictEqual(r4.errors.size, 0, "location optional while warehouses are dormant; blank batch fine on the box shape");
}

// CR-459 regression: an undefined seed (no ?design=) leaves design "" — never undefined (the cut page splits it).
assert.strictEqual(blankAdjustRow({ design: undefined }).design, "");
assert.strictEqual(blankAdjustRow().warehouse, "");

// CR-458 Location Transfer: positive lines at From; From ≠ To; rows need no location of their own.
{
  const T: AdjustHeader = { ...H, mode: "transfer", from: "w1", to: "w2" };
  const a = adj({ design: "d1", second: "c1", qty: "5", warehouse: "" });
  const r1 = resolveAdjustLines([a], T, { secondRequired: true, warehouseRequired: true });
  assert.strictEqual(r1.errors.size + r1.hdrErrors.size, 0, "row location not required in transfer mode");
  assert.deepStrictEqual([r1.lines[0].qty, r1.lines[0].warehouse, r1.totalOut, r1.totalIn], [5, "w1", 5, 0]);
  const r2 = resolveAdjustLines([adj({ design: "d1", second: "c1", qty: "-5" })], T, { secondRequired: true, warehouseRequired: true });
  assert.deepStrictEqual([...r2.errors.values()][0] && [...[...r2.errors.values()][0]], ["qty"], "a transfer never moves a negative qty");
  assert.deepStrictEqual([...resolveAdjustLines([a], { ...T, to: "w1" }, { secondRequired: true, warehouseRequired: true }).hdrErrors], ["to"]);
  assert.deepStrictEqual([...resolveAdjustLines([a], { ...T, from: "" }, { secondRequired: true, warehouseRequired: true }).hdrErrors], ["from"]);
  const dupR = resolveAdjustLines([a, adj({ design: "d1", second: "c1", qty: "2", warehouse: "w9" })], T, { secondRequired: true, warehouseRequired: true });
  assert.strictEqual(dupR.errors.size, 2, "same item · size twice is a duplicate whatever the rows' own location says");
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
