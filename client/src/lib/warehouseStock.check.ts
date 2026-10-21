/* Runnable check for the per-warehouse reducer (CR-329). Run with modern Node:
     node src/lib/warehouseStock.check.ts
   ponytail: one self-check, no vitest dep — same idiom as batchStockDerive.check.ts. */
import assert from "node:assert";
import { deriveWarehouseStock, parsePurposes, type WarehouseIn, type WhMoveIn } from "./warehouseStock.ts";

const W1: WarehouseIn = { id: "W1", isPrimary: true, purposes: ["Production"] };
const W2: WarehouseIn = { id: "W2", isPrimary: false, purposes: ["Palletization"] };
const BAY: WarehouseIn = { id: "W3", isPrimary: false, purposes: ["Loading Bay"] };
const M = (qty: number, warehouse: string | null = null, key = "D1|B1"): WhMoveIn => ({ key, warehouse, qty });
const cellOf = (cells: ReturnType<typeof deriveWarehouseStock>, wh: string, key = "D1|B1") => cells.find((c) => c.key === key && c.warehouseId === wh);
const onHand = (cells: ReturnType<typeof deriveWarehouseStock>, wh: string, key = "D1|B1") => cellOf(cells, wh, key)?.onHand ?? 0;

/** Conservation per key: Σ onHand = Σ moves + Σ over. */
const conserve = (ws: WarehouseIn[], moves: WhMoveIn[], key = "D1|B1") => {
  const cells = deriveWarehouseStock(ws, moves).filter((c) => c.key === key);
  const sum = moves.filter((m) => m.key === key).reduce((s, m) => s + m.qty, 0);
  const over = cells.reduce((s, c) => s + c.over, 0);
  const total = cells.reduce((s, c) => s + c.onHand, 0);
  assert.strictEqual(total, sum + over, `conservation on ${key}: ${total} ≠ ${sum} + ${over}`);
};

// 1. Null supply lands in the primary; explicit supply in its warehouse.
{
  const moves = [M(100), M(30, "W2")];
  const cells = deriveWarehouseStock([W1, W2], moves);
  assert.strictEqual(onHand(cells, "W1"), 100);
  assert.strictEqual(onHand(cells, "W2"), 30);
  conserve([W1, W2], moves);
}

// 2. A transfer is a pair of explicit moves — net zero, redistributed.
{
  const moves = [M(100), M(-60, "W1"), M(60, "W2")];
  const cells = deriveWarehouseStock([W1, W2], moves);
  assert.strictEqual(onHand(cells, "W1"), 40);
  assert.strictEqual(onHand(cells, "W2"), 60);
  conserve([W1, W2], moves);
}

// 3. Null removal (a loaded container) takes from the Loading Bay first, then the largest balance, never below zero.
{
  const moves = [M(50, "W1"), M(80, "W2"), M(20, "W3"), M(-60)];
  const cells = deriveWarehouseStock([W1, W2, BAY], moves);
  assert.strictEqual(onHand(cells, "W3"), 0, "bay drained first");
  assert.strictEqual(onHand(cells, "W2"), 40, "then the largest");
  assert.strictEqual(onHand(cells, "W1"), 50);
  conserve([W1, W2, BAY], moves);
}

// 4. Removal nobody can cover → primary carries `over`; explicit over-removal flags its own cell.
{
  const moves = [M(10, "W2"), M(-25)];
  const cells = deriveWarehouseStock([W1, W2], moves);
  assert.strictEqual(onHand(cells, "W2"), 0);
  assert.strictEqual(cellOf(cells, "W1")?.over, 15);
  conserve([W1, W2], moves);
  const explicit = deriveWarehouseStock([W1, W2], [M(10, "W2"), M(-25, "W2")]);
  assert.strictEqual(cellOf(explicit, "W2")?.over, 15);
  assert.strictEqual(onHand(explicit, "W2"), 0);
}

// 5. Input order does not matter (supply, explicit, spread are ranked).
{
  const a = deriveWarehouseStock([W1, W2, BAY], [M(-60), M(20, "W3"), M(80, "W2"), M(50, "W1")]);
  const b = deriveWarehouseStock([W1, W2, BAY], [M(50, "W1"), M(80, "W2"), M(20, "W3"), M(-60)]);
  assert.deepStrictEqual(a.sort((x, y) => x.warehouseId.localeCompare(y.warehouseId)), b.sort((x, y) => x.warehouseId.localeCompare(y.warehouseId)));
}

// 6. Unknown / deleted warehouse id → primary. No warehouses → one implicit "" bucket.
{
  const cells = deriveWarehouseStock([W1, W2], [M(10, "GONE"), M(-4, "GONE")]);
  assert.strictEqual(onHand(cells, "W1"), 6);
  const none = deriveWarehouseStock([], [M(10), M(-3, "W9")]);
  assert.strictEqual(none.length, 1);
  assert.strictEqual(none[0].warehouseId, "");
  assert.strictEqual(none[0].onHand, 7);
}

// 7. Claims spread like removals but only mark `committed`, capped at on-hand.
{
  const cells = deriveWarehouseStock([W1, W2, BAY], [M(50, "W1"), M(30, "W3")], [{ key: "D1|B1", warehouse: null, qty: 45 }]);
  assert.strictEqual(cellOf(cells, "W3")?.committed, 30);
  assert.strictEqual(cellOf(cells, "W1")?.committed, 15);
  assert.strictEqual(onHand(cells, "W1"), 50, "a claim moves nothing");
  const beyond = deriveWarehouseStock([W1], [M(10, "W1")], [{ key: "D1|B1", warehouse: null, qty: 99 }]);
  assert.strictEqual(cellOf(beyond, "W1")?.committed, 10);
}

// 8. Keys stay independent; zero cells are not emitted.
{
  const cells = deriveWarehouseStock([W1, W2], [M(5, "W1"), M(-5, "W1"), M(7, "W2", "D2|")]);
  assert.strictEqual(cells.length, 1);
  assert.strictEqual(cells[0].key, "D2|");
}

// 9. Flip-primary scenario: once null rows are stamped onto the OLD primary (the
// server does that in /warehouse-primary), making W2 primary leaves W1 honest.
{
  const stamped = [M(100, "W1"), M(-60, "W1"), M(60, "W2")];
  const cells = deriveWarehouseStock([{ ...W1, isPrimary: false }, { ...W2, isPrimary: true }], stamped);
  assert.strictEqual(onHand(cells, "W1"), 40);
  assert.strictEqual(onHand(cells, "W2"), 60);
}

assert.deepStrictEqual(parsePurposes(" Production, Loading Bay ,"), ["Production", "Loading Bay"]);

console.log("warehouseStock.check: all assertions passed");
