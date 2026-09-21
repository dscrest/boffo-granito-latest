/* Runnable check — node src/lib/needProduction.check.ts (same idiom as stock.invariant.check.ts). */
import assert from "node:assert";
import { demandByDesign, lineSupplies, lineSupply, worstSupply } from "./needProduction.ts";

// The five statuses.
assert.strictEqual(lineSupply({ orderQty: 100, producedQty: 100 }, 0, 0).status, "Allocated");
assert.strictEqual(lineSupply({ orderQty: 100, producedQty: 40 }, 60, 0).status, "Stock ready");
const partial = lineSupply({ orderQty: 100, producedQty: 0 }, 30, 0);
assert.deepStrictEqual([partial.status, partial.short, partial.label], ["Partial stock", 70, "Partial stock — 70 short"]);
assert.strictEqual(lineSupply({ orderQty: 100, producedQty: 0 }, 0, 100).status, "In production");
assert.strictEqual(lineSupply({ orderQty: 100, producedQty: 0 }, 0, 99).status, "Need production");

// Two orders of ONE item share its 150 free boxes first-come (oldest SO first).
const line = (id: string, so: string, qty: number, over: object = {}) =>
  ({ id, salesOrderId: so, status: "Confirmed", designName: "TILE-A", orderQty: qty, producedQty: 0, ...over });
const orders = [line("b", "20", 120, { boxBrandId: "BR2", boxBrandLabel: "Boffo" }), line("a", "10", 80, { boxBrandId: "BR1" }), line("c", "30", 50, { status: "Draft" })];
const stockOf = () => ({ free: 150, inProduction: 0 });
const s = lineSupplies(orders, stockOf);
assert.strictEqual(s.get("a")!.status, "Stock ready", "older SO gets the stock first");
assert.deepStrictEqual([s.get("b")!.status, s.get("b")!.short], ["Partial stock", 50]); // 150 − 80 = 70 left for 120
assert.strictEqual(s.has("c"), false, "draft orders are not demand");

// To Produce: demand 200 − free 150 → produce 50, across 2 sales orders.
assert.deepStrictEqual(demandByDesign(orders, stockOf), [
  { designName: "TILE-A", openDemand: 200, free: 150, inProduction: 0, shortfall: 50, orders: 2,
    // the waiting orders' Box Brand travels with the demand, biggest first
    brands: [{ boxBrandId: "BR2", label: "Boffo", need: 120 }, { boxBrandId: "BR1", label: "", need: 80 }] },
]);
assert.strictEqual(worstSupply([...s.values()])!.status, "Partial stock");
console.log("need-production check: OK");
