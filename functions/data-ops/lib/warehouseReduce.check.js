/* Check that the server's warehouseReduce (index.js) is a faithful twin of the
   client reducer (client/src/lib/warehouseStock.ts) — same scenarios as
   warehouseStock.check.ts. Run: node functions/data-ops/lib/warehouseReduce.check.js
   ponytail: index.js exports nothing (it boots an Express app), so the function
   is lifted out of the source text and evaluated on its own. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const start = src.indexOf("function warehouseReduce(");
assert.ok(start > 0, "warehouseReduce not found in index.js");
const end = src.indexOf("\n}\n", start);
const warehouseReduce = new Function(`${src.slice(start, end + 2)}; return warehouseReduce;`)();

const meta = (list) => ({ list, primary: (list.find((w) => w.isPrimary) || list[0] || { id: "" }).id, byId: new Map(list.map((w) => [w.id, w])) });
const W1 = { id: "W1", isPrimary: true, bay: false };
const W2 = { id: "W2", isPrimary: false, bay: false };
const BAY = { id: "W3", isPrimary: false, bay: true };
const M = (qty, warehouse = null, key = "B1") => ({ key, warehouse, qty });
const at = (cells, wh, key = "B1") => cells.get(`${key}|${wh}`) || 0;

// 1. null supply → primary; explicit → its warehouse
{
  const c = warehouseReduce(meta([W1, W2]), [M(100), M(30, "W2")]);
  assert.equal(at(c, "W1"), 100);
  assert.equal(at(c, "W2"), 30);
}
// 2. transfer pair
{
  const c = warehouseReduce(meta([W1, W2]), [M(100), M(-60, "W1"), M(60, "W2")]);
  assert.equal(at(c, "W1"), 40);
  assert.equal(at(c, "W2"), 60);
}
// 3. spread: Loading Bay first, then largest, never below zero
{
  const c = warehouseReduce(meta([W1, W2, BAY]), [M(50, "W1"), M(80, "W2"), M(20, "W3"), M(-60)]);
  assert.equal(at(c, "W3"), 0);
  assert.equal(at(c, "W2"), 40);
  assert.equal(at(c, "W1"), 50);
}
// 4. over-removal clamps at zero (the server reads the floor, the client shows `over`)
{
  const c = warehouseReduce(meta([W1, W2]), [M(10, "W2"), M(-25)]);
  assert.equal(at(c, "W2"), 0);
  assert.equal(at(c, "W1"), 0);
  const e = warehouseReduce(meta([W1, W2]), [M(10, "W2"), M(-25, "W2")]);
  assert.equal(at(e, "W2"), 0);
}
// 5. order-independent
{
  const a = warehouseReduce(meta([W1, W2, BAY]), [M(-60), M(20, "W3"), M(80, "W2"), M(50, "W1")]);
  const b = warehouseReduce(meta([W1, W2, BAY]), [M(50, "W1"), M(80, "W2"), M(20, "W3"), M(-60)]);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
}
// 6. unknown warehouse → primary; no warehouses → "" bucket
{
  const c = warehouseReduce(meta([W1, W2]), [M(10, "GONE"), M(-4, "GONE")]);
  assert.equal(at(c, "W1"), 6);
  const n = warehouseReduce(meta([]), [M(10), M(-3, "W9")]);
  assert.equal(at(n, ""), 7);
}
// 8. keys independent
{
  const c = warehouseReduce(meta([W1, W2]), [M(5, "W1"), M(-5, "W1"), M(7, "W2", "B2")]);
  assert.equal(at(c, "W1"), 0);
  assert.equal(at(c, "W2", "B2"), 7);
}
console.log("warehouseReduce.check: server twin matches the client reducer");
