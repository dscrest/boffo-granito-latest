/* Runnable check for the opening-stock double-count guard (batch-tracked items).
   No test framework — run directly with modern Node (TS types are stripped):
     node src/lib/stock.invariant.check.ts
   Fails loudly (assert) if opening leaks into produced/in-production, or if a
   batched item's accounting_stock is counted alongside its opening rows.
   ponytail: one self-check for the money/stock path; no vitest dep introduced. */
import assert from "node:assert";
import { designStock, openingStockFor } from "./stock.ts";

// One make-to-stock line, M produced, Completed (so it's not "in production").
const M = 40;
const N = 100; // opening boxes carried in as batches
const prodLogs = [
  {
    design: "TILE-A",
    independent: true,
    producedSoFar: M,
    qtyRequested: M,
    stage: "Completed",
    status: "Produced",
    salesOrderId: "",
    orderNumber: "",
    poNumber: "",
    customer: "",
  },
] as any;

const openingByDesign = new Map([["TILE-A", N]]);
const batched = { isBatched: true, designName: "TILE-A", accountingStock: 999 }; // 999 must be ignored
const singular = { isBatched: false, designName: "TILE-A", accountingStock: 7 };

// openingStockFor picks exactly ONE source.
assert.strictEqual(openingStockFor(batched, openingByDesign), N, "batched → opening rows only (accounting_stock ignored)");
assert.strictEqual(openingStockFor(singular, openingByDesign), 7, "singular → accounting_stock");
assert.strictEqual(openingStockFor(null, openingByDesign), 0, "no design → 0");

// available = opening + produced − loaded, counted once each.
const s = designStock("TILE-A", { openingStock: openingStockFor(batched, openingByDesign), orders: [], prodLogs });
assert.strictEqual(s.available, N + M, `available should be ${N + M} (opening once + produced once), got ${s.available}`);
assert.strictEqual(s.inProduction, 0, "opening/completed output must not count as in-production");

// SO-confirm auto-queued jobs (request_group "so-…") count only once TOUCHED —
// an untouched New/0-produced auto row is demand, not production (bug 7.2).
const line = (over: Record<string, unknown>) => ({
  design: "TILE-A", independent: false, producedSoFar: 0, qtyRequested: 500,
  stage: "New", status: "Approved", requestGroup: "so-123", salesOrderId: "123",
  orderNumber: "", poNumber: "", customer: "", ...over,
});
const ip = (logs: unknown[]) => designStock("TILE-A", { orders: [], prodLogs: logs as any }).inProduction;
assert.strictEqual(ip([line({})]), 0, "untouched auto-queued job must not count as in-production");
assert.strictEqual(ip([line({ producedSoFar: 100 })]), 400, "auto job with output recorded counts its remaining");
assert.strictEqual(ip([line({ stage: "InProduction" })]), 500, "auto job dragged out of New counts");
assert.strictEqual(ip([line({ requestGroup: "PR-1-x" })]), 500, "manual PR- request counts from creation");

// CR-199 allocation: 30 stock boxes allocated to an SO line appear in BOTH the
// line's producedQty and the independent output — `allocated` nets the double
// count, so on-hand is unchanged while free drops by the allocation.
{
  const so = [{ designName: "TILE-A", design: "TILE-A", orderQty: 50, producedQty: 30, loadedQty: 0, palletizedQty: 0 }] as any;
  const a = designStock("TILE-A", { openingStock: N, allocated: 30, orders: so, prodLogs });
  assert.strictEqual(a.available, N + M, "allocating must not change on-hand");
  assert.strictEqual(a.free, N + M - 30, "free drops by the allocated boxes");
  so[0].loadedQty = 30; // allocation shipped: on-hand and the claim both fall
  const l = designStock("TILE-A", { openingStock: N, allocated: 30, orders: so, prodLogs });
  assert.strictEqual(l.available, N + M - 30);
  assert.strictEqual(l.free, N + M - 30, "a loaded allocation is not reserved twice");
}

console.log("stock invariant check: OK (available =", s.available, ", inProduction =", s.inProduction, ")");
