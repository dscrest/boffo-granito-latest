/* Self-check: npx tsx client/src/features/stages/nextStep.test.ts */
import assert from "node:assert/strict";
import type { Order } from "@/data";
import type { PalPlanLine } from "./palPlansApi";
import { blockers, soNextStep } from "./nextStep";

const item = (p: Partial<Order>): Order =>
  ({ id: "oi1", salesOrderId: "so1", orderNumber: "SO/26-27/004", customerId: "c1", status: "Confirmed", orderQty: 100, producedQty: 0, palletizedQty: 0, loadedQty: 0, dispatchedQty: 0, ...p }) as Order;
const line = (p: Partial<PalPlanLine>): PalPlanLine => ({ id: "l", salesOrderId: "so1", status: "Planning", boxes: 10, loadBoxId: "", ...p }) as PalPlanLine;

assert.equal(soNextStep([item({ status: "Draft" })], []).step, "approve");
assert.equal(soNextStep([item({ status: "Rejected" })], []).step, "closed");
assert.equal(soNextStep([item({})], []).step, "allocate");
assert.equal(soNextStep([item({ producedQty: 40 })], []).reason, "40 allocated boxes not palletized yet. Send to Palletization");
assert.equal(soNextStep([item({ producedQty: 40 })], [line({ boxes: 40 })]).step, "palletize");
assert.equal(soNextStep([item({ producedQty: 40 })], [line({ boxes: 40, status: "Palletizing" })]).step, "palletizing");
assert.equal(soNextStep([item({ producedQty: 40, palletizedQty: 40 })], [line({ boxes: 40, status: "ReadyToLoad" })]).step, "load");
assert.equal(soNextStep([item({ producedQty: 40, palletizedQty: 40, loadedQty: 40 })], [line({ boxes: 40, status: "ReadyToLoad", loadBoxId: "b1" })]).step, "allocate", "60 still need stock");
assert.equal(soNextStep([item({ producedQty: 100, palletizedQty: 100, loadedQty: 100 })], [line({ boxes: 100, status: "ReadyToLoad", loadBoxId: "b1" })]).step, "dispatch");
assert.equal(soNextStep([item({ producedQty: 100, palletizedQty: 100, loadedQty: 100, dispatchedQty: 100 })], []).step, "done");
// A line of another order never counts.
assert.equal(soNextStep([item({ producedQty: 40 })], [line({ salesOrderId: "so9", status: "ReadyToLoad", boxes: 40 })]).step, "palletize");

// blockers: no orders → create one; a ready order → nothing blocks; otherwise one line per order.
assert.equal(blockers("load", "c1", [], []).length, 1);
assert.match(blockers("load", "c1", [], [])[0].reason, /Create a Sales Order/);
assert.deepEqual(blockers("load", "c1", [item({ producedQty: 40, palletizedQty: 40 })], [line({ boxes: 40, status: "ReadyToLoad" })]), []);
const two = blockers("load", "c1", [item({}), item({ id: "oi2", salesOrderId: "so2", orderNumber: "SO/26-27/005", status: "Draft" })], []);
assert.equal(two.length, 2);
assert.equal(two[0].label, "SO/26-27/004");
assert.equal(two[1].reason, "Awaiting approval. Approve the order first");
// Palletize context: queued stock is plannable; everything in palletization is not.
assert.deepEqual(blockers("palletize", "c1", [item({ producedQty: 40 })], [line({ boxes: 40 })]), []);
assert.equal(blockers("palletize", "c1", [item({ producedQty: 40 })], [line({ boxes: 40, status: "Palletizing" })])[0].reason, "40 boxes in palletization. Complete palletization first");
// Other customers never leak in; "" = everyone.
assert.equal(blockers("load", "c2", [item({})], []).length, 1);
assert.match(blockers("load", "c2", [item({})], [])[0].reason, /No sales orders for this customer/);
assert.equal(blockers("load", "", [item({})], [])[0].label, "SO/26-27/004");
// Only finished orders → say so instead of an empty list.
assert.match(blockers("load", "c1", [item({ producedQty: 100, palletizedQty: 100, loadedQty: 100, dispatchedQty: 100 })], [])[0].reason, /complete or closed/);

console.log("nextStep: ok");
