/* Tests for the pure container-fit module. Run: node --test functions/data-ops/lib/
   Fixture is the "Junglee" reference (BOFFO_Build_Plan.md §7) — values are
   computed here, NOT hardcoded into fit.js. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeFit } = require("./fit");

// Junglee reference fixture
const BOXES_PER_PALLET = 43;
const PALLETS_PER_CONTAINER = 26;
const CONTAINER_AREA_SQM = 1310.4;
const COVERAGE_PER_BOX = CONTAINER_AREA_SQM / (BOXES_PER_PALLET * PALLETS_PER_CONTAINER); // ~1.1721 m²
const AREA_PER_PALLET = BOXES_PER_PALLET * COVERAGE_PER_BOX; // ~50.4 m²

/** Build n identical full Junglee pallets, optionally with a per-pallet weight. */
function pallets(n, { weightKg = null, design = "Junglee", tier = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    batch: `${design}-${i + 1}`,
    design,
    boxes: BOXES_PER_PALLET,
    areaSqm: AREA_PER_PALLET,
    weightKg,
    tier,
  }));
}

function container(over = {}) {
  return {
    container: "C1",
    container_number: "MSKU-1",
    capPallets: PALLETS_PER_CONTAINER,
    capAreaSqm: null,
    maxWeightKg: null,
    capBoxes: null,
    status: "planned",
    etd: "2026-07-01",
    ...over,
  };
}

test("slot-binding: 26 full pallets exactly fill a 26-slot container", () => {
  const { perContainer, unassigned } = computeFit(pallets(26), [container()]);
  const c = perContainer[0];
  assert.equal(c.assigned.length, 26);
  assert.equal(unassigned.length, 0);
  assert.equal(c.binding, "slots");
  assert.equal(c.utilization.slots_pct, 100);
  assert.equal(c.utilization.area_pct, null); // area cap absent
  assert.equal(c.utilization.weight_pct, null); // weight uncalibrated
  assert.equal(c.underfilled, false);
});

test("area-binding: small area cap limits placement before slots run out", () => {
  // Cap area at 5 pallets' worth; slots allow 26.
  const cap = AREA_PER_PALLET * 5 + 0.01;
  const { perContainer, unassigned } = computeFit(pallets(26), [container({ capAreaSqm: cap })]);
  const c = perContainer[0];
  assert.equal(c.assigned.length, 5);
  assert.equal(c.binding, "area");
  assert.ok(c.utilization.area_pct > 99); // area is the full dimension
  assert.equal(unassigned.length, 21);
  assert.equal(unassigned[0].reason, "area");
});

test("weight-binding: max_weight caps placement when per-box weight is calibrated", () => {
  const palletWeight = 1000; // kg each
  const { perContainer, unassigned } = computeFit(pallets(26, { weightKg: palletWeight }), [
    container({ maxWeightKg: palletWeight * 4 }), // room for 4 by weight
  ]);
  const c = perContainer[0];
  assert.equal(c.assigned.length, 4);
  assert.equal(c.binding, "weight");
  assert.equal(c.utilization.weight_pct, 100);
  assert.equal(unassigned[0].reason, "weight");
});

test("uncalibrated weight (null) is never blocked by the weight cap", () => {
  // maxWeightKg is tiny, but weightKg is null → weight dimension ignored for these batches.
  const { perContainer, unassigned } = computeFit(pallets(10, { weightKg: null }), [
    container({ maxWeightKg: 1 }),
  ]);
  assert.equal(perContainer[0].assigned.length, 10);
  assert.equal(unassigned.length, 0);
  assert.equal(perContainer[0].utilization.weight_pct, 0); // nothing counted toward weight
});

test("mixed designs: per-batch area derivation packs heterogeneous pallets", () => {
  const big = { batch: "B1", design: "Big", boxes: 20, areaSqm: 60, weightKg: null, tier: 0 };
  const small = { batch: "S1", design: "Small", boxes: 50, areaSqm: 30, weightKg: null, tier: 0 };
  const cap = 60 + 30 + 0.01;
  const { perContainer, unassigned } = computeFit([big, small], [
    container({ capPallets: 10, capAreaSqm: cap }),
  ]);
  assert.equal(perContainer[0].assigned.length, 2); // both fit by area
  assert.equal(unassigned.length, 0);
  assert.equal(perContainer[0].binding, "area");
});

test("underfilled: a lightly loaded container flags below threshold", () => {
  const { perContainer } = computeFit(pallets(3), [container()]); // 3 of 26 slots
  assert.equal(perContainer[0].underfilled, true);
  assert.ok(perContainer[0].utilization.slots_pct < 95);
});

test("tier order: current-order (tier 0) placed before demo (tier 3)", () => {
  const mixed = [...pallets(20, { tier: 3, design: "Demo" }), ...pallets(20, { tier: 0, design: "Order" })];
  const { perContainer } = computeFit(mixed, [container()]); // 26 slots
  const placed = new Set(perContainer[0].assigned);
  // All 20 order pallets must be placed; demo only fills the remaining 6.
  for (let i = 1; i <= 20; i++) assert.ok(placed.has(`Order-${i}`), `Order-${i} should be placed`);
  assert.equal(perContainer[0].assigned.length, 26);
});

test("seed: pre-loaded slots reduce remaining space; utilization vs full cap", () => {
  // Container already holds 20 pallets (seed); only 6 of 26 slots remain.
  const { perContainer, unassigned } = computeFit(pallets(10), [
    container({ status: "loading", seed: { slots: 20, boxes: 20 * BOXES_PER_PALLET } }),
  ]);
  const c = perContainer[0];
  assert.equal(c.assigned.length, 6); // only 6 new fit
  assert.equal(c.used.slots, 26); // seed 20 + new 6
  assert.equal(c.utilization.slots_pct, 100); // against full cap of 26
  assert.equal(unassigned.length, 4);
  assert.equal(c.underfilled, false);
});

test("multi-container: overflow spills to the next container by ETD", () => {
  const { perContainer, unassigned } = computeFit(pallets(30), [
    container({ container: "C1", container_number: "A", etd: "2026-07-01" }),
    container({ container: "C2", container_number: "B", etd: "2026-07-10" }),
  ]);
  assert.equal(perContainer[0].assigned.length, 26); // earliest ETD fills first
  assert.equal(perContainer[1].assigned.length, 4);
  assert.equal(unassigned.length, 0);
});
