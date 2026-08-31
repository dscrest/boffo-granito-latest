/* Runnable check for the batch ledger's conservation law: the boxes a batch
   produced must equal the boxes the ledger accounts for (consumed + on hand).
   No test framework — run directly with modern Node (TS types are stripped):
     node src/features/stages/batchLedger.check.ts
   ponytail: one self-check for the batch/stock path; no vitest dep introduced. */
import assert from "node:assert";
import { batchLedger } from "./batchLedger.ts";

const stockRow = (over: Record<string, unknown> = {}) =>
  ({
    designId: "D1", designName: "TILE-A", designLabel: "TILE-A 600x600", sizeCode: "60X60",
    batchNumber: "B/26-27/001", mfgDate: "2026-08-01",
    produced: 100, opening: 0, palletised: 0, loaded: 0, dispatched: 0, current: 100, over: 0,
    ...over,
  }) as never;

const line = (over: Record<string, unknown> = {}) =>
  ({
    id: "L1", salesOrderId: "SO1", soNumber: "SO/26-27/001", orderItemId: "OI1",
    designId: "D1", designLabel: "TILE-A 600x600", palletId: "P1", palletName: "Pallet A",
    palletCapacity: 800, boxes: 30, position: 0, status: "ReadyToLoad", itemCode: "PAL-1",
    customerId: "C1", customerName: "Acme", countryCode: "IN", sizeCode: "60X60",
    loadBoxId: "", batchNumber: "B/26-27/001", palletGroup: "", createdTime: "2026-08-02",
    ...over,
  }) as never;

const plan = (lines: unknown[]) =>
  ({
    id: "PL1", palNumber: "PAL/26-27/001", status: "Planning", vehicleId: "", vehicleNumber: "",
    driverName: "", mobileNumber: "", plannedDate: "", dispatchDate: "", salespersonId: "",
    salespersonName: "", salespersonPhone: "", salespersonEmail: "", remarks: "",
    lines, soNumbers: [], customerNames: [], vehicleNumbers: [], totalBoxes: 0,
    createdTime: "", modifiedTime: "",
  }) as never;

const box = (over: Record<string, unknown> = {}) =>
  ({
    id: "BX1", boxNumber: 1, vehicleId: "", vehicleNumber: "GJ01AB1234", driverName: "", mobileNumber: "",
    capacity: 0, status: "Open", dispatchDate: "", containerNumber: "", lineSeal: "",
    electronicSeal: "", loadingSupervisor: "", containerSize: "", transporter: "", lrNumber: "",
    destination: "", createdTime: "",
    ...over,
  }) as never;

const sum = (rows: { boxes: number }[]) => rows.reduce((s, r) => s + r.boxes, 0);

// 1. Nothing consumed → the whole batch is one On hand row.
{
  const rows = batchLedger([stockRow()], [], []);
  assert.strictEqual(rows.length, 1, "untouched batch → one row");
  assert.strictEqual(rows[0].stage, "On hand");
  assert.strictEqual(rows[0].boxes, 100, "on hand = produced");
}

// 2. Conservation across every stage: palletised + loaded + dispatched + on hand = produced.
{
  const rows = batchLedger(
    [stockRow()],
    [
      plan([
        line({ id: "L1", boxes: 30 }), // ReadyToLoad, no box → Palletised
        line({ id: "L2", boxes: 20, status: "Planning", loadBoxId: "BX1" }), // in an Open box → Loaded
        line({ id: "L3", boxes: 25, status: "Planning", loadBoxId: "BX2" }), // Dispatched box
        line({ id: "L4", boxes: 15, status: "Planning" }), // still queue → NOT consumed
      ]),
    ],
    [box(), box({ id: "BX2", status: "Dispatched", dispatchDate: "2026-08-20" })],
  );
  const by = (s: string) => sum(rows.filter((r) => r.stage === s));
  assert.strictEqual(by("Palletised"), 30, "ReadyToLoad with no box = Palletised");
  assert.strictEqual(by("Loaded"), 20, "line in an Open box = Loaded");
  assert.strictEqual(by("Dispatched"), 25, "line in a Dispatched box = Dispatched");
  assert.strictEqual(by("On hand"), 25, "queue lines stay on hand (100 − 30 − 20 − 25)");
  assert.strictEqual(sum(rows), 100, `Σ ledger must equal produced, got ${sum(rows)}`);
}

// 3. Opening stock counts toward the batch total, and a fully consumed batch
//    emits no On hand row (never a negative one).
{
  const rows = batchLedger(
    [stockRow({ produced: 60, opening: 40 })],
    [plan([line({ boxes: 100, status: "Planning", loadBoxId: "BX2" })])],
    [box({ id: "BX2", status: "Dispatched", dispatchDate: "2026-08-20" })],
  );
  assert.strictEqual(rows.filter((r) => r.stage === "On hand").length, 0, "fully consumed → no On hand row");
  assert.strictEqual(sum(rows), 100, "opening counts toward the batch total");
  assert.strictEqual(rows[0].batchTotal, 100, "batchTotal = produced + opening");
  assert.strictEqual(rows[0].dispatchDate, "2026-08-20", "dispatch date comes off the box");
}

console.log("batch ledger check: OK");
