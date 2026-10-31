/* Self-check for mergeLines (CR-507) — run with:  npx tsx client/src/lib/mergeLines.test.ts */
import assert from "node:assert";
import { duplicateItems, mergeDuplicateLines } from "./mergeLines";

type L = { item: string; rate: number; qty: number; worked?: boolean; id?: string };
const key = (l: L) => `${l.item.trim().toLowerCase()}|${l.rate}`;
const opts = { mergeKey: key, qty: (l: L) => l.qty, withQty: (l: L, q: number) => ({ ...l, qty: q }), keep: (l: L) => !!l.worked };

// folds same item + same rate into the first line
assert.deepStrictEqual(
  mergeDuplicateLines<L>([{ item: "A", rate: 10, qty: 50 }, { item: "B", rate: 5, qty: 1 }, { item: "a", rate: 10, qty: 210 }], opts),
  [{ item: "A", rate: 10, qty: 260 }, { item: "B", rate: 5, qty: 1 }],
);
// a different rate keeps the lines apart
assert.strictEqual(mergeDuplicateLines<L>([{ item: "A", rate: 10, qty: 50 }, { item: "A", rate: 9, qty: 210 }], opts).length, 2);
// a plain line folds INTO the worked line, which keeps its id
assert.deepStrictEqual(
  mergeDuplicateLines<L>([{ item: "A", rate: 0, qty: 50, id: "x" }, { item: "A", rate: 0, qty: 210, id: "y", worked: true }], opts),
  [{ item: "A", rate: 0, qty: 260, id: "y", worked: true }],
);
// two worked lines never fold
assert.strictEqual(
  mergeDuplicateLines<L>([{ item: "A", rate: 0, qty: 50, id: "x", worked: true }, { item: "A", rate: 0, qty: 210, id: "y", worked: true }], opts).length,
  2,
);
// duplicateItems: repeated items + whether they will merge; blank items ignored
const d = duplicateItems<L>(
  [{ item: "A", rate: 10, qty: 1 }, { item: "a ", rate: 10, qty: 1 }, { item: "B", rate: 1, qty: 1 }, { item: "B", rate: 2, qty: 1 }, { item: "", rate: 0, qty: 1 }],
  (l) => l.item,
  key,
);
assert.deepStrictEqual(d.get("a"), { lines: 2, mergeable: true });
assert.deepStrictEqual(d.get("b"), { lines: 2, mergeable: false });
assert.strictEqual(d.size, 2);
console.log("mergeLines self-check ok");
