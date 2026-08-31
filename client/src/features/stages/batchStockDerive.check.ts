/* Runnable check for the batch-stock reducer — the netting logic that decides
   what /stock and the batch reports show. Run directly with modern Node:
     node src/features/stages/batchStockDerive.check.ts
   ponytail: one self-check, no vitest dep — same idiom as stock.invariant.check.ts. */
import assert from "node:assert";
import { deriveBatchStock, type ConsumeIn, type SupplyIn } from "./batchStockDerive.ts";

const S = (over: Partial<SupplyIn> = {}): SupplyIn =>
  ({ designId: "D1", batch: "", qty: 0, kind: "produced", date: "", ...over });
const C = (over: Partial<ConsumeIn> = {}): ConsumeIn =>
  ({ designId: "D1", batch: "", boxes: 0, loaded: false, dispatched: false, ...over });

const rowOf = (rows: ReturnType<typeof deriveBatchStock>, batch: string, designId = "D1") =>
  rows.find((r) => r.designId === designId && r.batch === batch);

/** The conservation law: Σ current = Σ supply − Σ absorbed loaded. */
const conserve = (rows: ReturnType<typeof deriveBatchStock>, designId = "D1") => {
  const mine = rows.filter((r) => r.designId === designId);
  const supply = mine.reduce((s, r) => s + r.opening + r.produced, 0);
  const loaded = mine.reduce((s, r) => s + r.loaded, 0);
  const over = mine.reduce((s, r) => s + r.over, 0);
  const current = mine.reduce((s, r) => s + r.current, 0);
  assert.strictEqual(current, supply - (loaded - over), `conservation: ${current} ≠ ${supply} − (${loaded} − ${over})`);
};

// 1. D1 — legacy plan-row output is supply on the "" bucket (kind "produced").
// D3 — a singular item's accounting stock is supply there too (kind "opening").
{
  const rows = deriveBatchStock(
    [S({ qty: 1200 }), S({ qty: 200, kind: "opening" })],
    [],
  );
  const r = rowOf(rows, "")!;
  assert.strictEqual(r.produced, 1200, "plan-row output counts as produced");
  assert.strictEqual(r.opening, 200, "accounting stock counts as opening");
  assert.strictEqual(r.current, 1400);
  conserve(rows);
}

// 2. Blank-batch loaded consumption nets the "" bucket — the live 620-box case
// (e.g. Onyx Gris: plan production 1200, blank plan-line loaded 70).
{
  const rows = deriveBatchStock([S({ qty: 1200 })], [C({ boxes: 70, loaded: true })]);
  const r = rowOf(rows, "")!;
  assert.strictEqual(r.current, 1130, "blank consumption reduces the unattributed bucket");
  assert.strictEqual(r.over, 0);
  conserve(rows);
}

// 3. FIFO spill — blank consumption exceeding "" supply flows into real
// batches oldest-first; per-key max(0,…) emission would have said Σ current
// = 100 here where true available is 30.
{
  const rows = deriveBatchStock(
    [S({ batch: "B2", qty: 60, date: "2026-08-20" }), S({ batch: "B1", qty: 40, date: "2026-08-01" })],
    [C({ boxes: 70, loaded: true })],
  );
  assert.strictEqual(rowOf(rows, "B1")!.loaded, 40, "oldest batch drained first");
  assert.strictEqual(rowOf(rows, "B2")!.loaded, 30, "then the next");
  assert.strictEqual(rowOf(rows, "B2")!.current, 30);
  assert.strictEqual(rows.reduce((s, r) => s + r.current, 0), 30, "Σ current = 110 − 70");
  conserve(rows);
}

// 4. Attributed consumption claims its batch BEFORE blanks spill.
{
  const rows = deriveBatchStock(
    [S({ batch: "B1", qty: 100, date: "2026-08-01" })],
    [C({ boxes: 80, loaded: true }), C({ batch: "B1", boxes: 60, loaded: true })],
  );
  const b1 = rowOf(rows, "B1")!;
  assert.strictEqual(b1.loaded, 100, "attributed 60 + spilled 40 (all B1 had left)");
  const blank = rowOf(rows, "")!;
  assert.strictEqual(blank.loaded, 40, "unabsorbable 40 lands on the unattributed row");
  assert.strictEqual(blank.over, 40, "…flagged as over, not silently dropped");
  conserve(rows);
}

// 5. D2 — consumption on a batch with no supply (typo'd batch) still emits a
// row: zero current, over set. Never reallocated into other batches.
{
  const rows = deriveBatchStock(
    [S({ batch: "B1", qty: 100 })],
    [C({ batch: "TYPO", boxes: 25, loaded: true, dispatched: true })],
  );
  const typo = rowOf(rows, "TYPO")!;
  assert.strictEqual(typo.current, 0);
  assert.strictEqual(typo.over, 25, "supply-less consumption is visible, not dropped");
  assert.strictEqual(typo.dispatched, 25);
  assert.strictEqual(rowOf(rows, "B1")!.current, 100, "ground-truth attribution never spills");
  conserve(rows);
}

// 6. Blank palletised-only (no box yet) shows on "" but does NOT reduce on-hand.
{
  const rows = deriveBatchStock([S({ batch: "B1", qty: 100, date: "2026-08-01" })], [C({ boxes: 30 })]);
  assert.strictEqual(rowOf(rows, "")!.palletised, 30);
  assert.strictEqual(rowOf(rows, "")!.loaded, 0);
  assert.strictEqual(rowOf(rows, "B1")!.current, 100, "palletised-only never nets stock");
  conserve(rows);
}

// 7. Designs never bleed into each other; mfgDate = earliest supply date.
{
  const rows = deriveBatchStock(
    [
      S({ batch: "B1", qty: 10, date: "2026-08-10" }),
      S({ batch: "B1", qty: 5, date: "2026-08-02" }),
      S({ designId: "D2", batch: "B1", qty: 7, date: "2026-08-05" }),
    ],
    [C({ designId: "D2", boxes: 100, loaded: true })],
  );
  assert.strictEqual(rowOf(rows, "B1")!.current, 15, "D1 untouched by D2's consumption");
  assert.strictEqual(rowOf(rows, "B1")!.mfgDate, "2026-08-02");
  assert.strictEqual(rowOf(rows, "B1", "D2")!.current, 0);
  assert.strictEqual(rowOf(rows, "", "D2")!.over, 93, "D2's unabsorbable 93 flagged");
  conserve(rows, "D1");
  conserve(rows, "D2");
}

console.log("batch stock derive check: OK");
