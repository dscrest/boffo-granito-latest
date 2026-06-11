/* ============================================================
   Container-fit optimizer — PURE module (no Catalyst / Data Store).

   computeFit() packs palletised batches into containers against up to
   four co-equal HARD constraints, all enforced simultaneously:
     1. pallet slots   (Container.capacity_pallets)
     2. total area     (Container.capacity_area_sqm)   — m²
     3. total weight   (Container.max_weight_kg)        — kg  (Q1 deferred)
     4. total boxes    (Container.capacity_boxes)       — legacy v1 cap

   Any cap that is null/0/absent is treated as UNCONSTRAINED for that
   dimension. A batch whose weightKg is null (per-box weight not yet
   calibrated — Q1) is treated as weight-unconstrained: it is never
   blocked by the weight cap, and it does not contribute to weight
   utilization. This lets the weight machinery ship now and "switch on"
   the moment Design.box_weight_kg + Container.max_weight_kg are filled.

   Heterogeneous / mixed pallet types fall out for free: weight and area
   are derived PER BATCH from that batch's own design+pallet by the
   caller, so a container can mix sizes/designs with no special case.

   Greedy First-Fit-Decreasing (v1, documented simplification — see
   BOFFO_Build_Plan.md §7.4). The caller supplies batches already tagged
   with a `tier` (0 = current order, 1 = same-customer confirmed,
   2 = same-customer new/estimate, 3 = demo); tier ordering is honoured
   so cross-order fill (§7.5) only needs to populate tiers, not re-pack.

   This module computes a SUGGESTION only — it never mutates anything.
   ============================================================ */

"use strict";

const DIMS = ["weight", "area", "slots", "boxes"]; // binding tie-break priority

/**
 * @typedef {Object} FitBatch
 * @property {string} batch      ROWID of the PalletisedBatch
 * @property {string} [design]   design label (for grouping/display)
 * @property {number} boxes      boxes_packed
 * @property {number} areaSqm    derived: boxes × design.coverage_sqm
 * @property {number|null} weightKg derived: boxes × design.box_weight_kg + pallet.empty_pallet_weight_kg; null if uncalibrated
 * @property {number} [tier]     0 current | 1 same-cust confirmed | 2 same-cust new | 3 demo (default 0)
 * @property {string} [customer] customer label (for §7.5 grouping)
 */

/**
 * @typedef {Object} FitContainer
 * @property {string} container         ROWID
 * @property {string} container_number
 * @property {number|null} capPallets   capacity_pallets (0/null = unconstrained)
 * @property {number|null} capAreaSqm   capacity_area_sqm (0/null = unconstrained)
 * @property {number|null} maxWeightKg  max_weight_kg (0/null = unconstrained)
 * @property {number|null} capBoxes     capacity_boxes (0/null = unconstrained)
 * @property {string} [etd]
 * @property {string} [status]
 * @property {{slots?:number,area?:number,weight?:number,boxes?:number}} [seed]
 *   pre-existing load already in this container (e.g. a 'loading' container's
 *   committed ContainerLoading rows). `used` is initialised from it so new
 *   batches pack into the REMAINING space and utilization is reported against
 *   the FULL capacity. `assigned` lists only the NEW suggestions, not the seed.
 */

const pos = (v) => (typeof v === "number" && v > 0 ? v : null); // 0/NaN/null → null (unconstrained)
const round2 = (n) => Math.round(n * 100) / 100;

/** Container ordering: 'loading' (partially full) before 'planned', each by ETD asc (blank ETD last). */
function containerSort(a, b) {
  const rank = (s) => (s === "loading" ? 0 : s === "planned" ? 1 : 2);
  const r = rank(a.status) - rank(b.status);
  if (r) return r;
  const ae = a.etd || "9999-12-31";
  const be = b.etd || "9999-12-31";
  return ae < be ? -1 : ae > be ? 1 : 0;
}

/** Batch ordering: tier asc, then group by design, then boxes desc (FFD — larger first). */
function batchSort(a, b) {
  const t = (a.tier || 0) - (b.tier || 0);
  if (t) return t;
  const d = String(a.design || "").localeCompare(String(b.design || ""));
  if (d) return d;
  return (b.boxes || 0) - (a.boxes || 0);
}

/**
 * Pack batches into containers under all active constraints.
 * @param {FitBatch[]} batches
 * @param {FitContainer[]} containers
 * @param {{underfillPct?: number}} [opts]
 * @returns {{perContainer: object[], unassigned: object[]}}
 */
function computeFit(batches, containers, opts = {}) {
  const underfillPct = opts.underfillPct ?? 95;

  const pending = [...(batches || [])].sort(batchSort);
  const placedIds = new Set();
  // Track why each still-unplaced batch failed on the containers it was tried against.
  const blockReason = new Map();

  const perContainer = [...(containers || [])].sort(containerSort).map((c) => {
    const cap = {
      slots: pos(c.capPallets),
      area: pos(c.capAreaSqm),
      weight: pos(c.maxWeightKg),
      boxes: pos(c.capBoxes),
    };
    const s = c.seed || {};
    const used = {
      slots: Number(s.slots) || 0,
      area: Number(s.area) || 0,
      weight: Number(s.weight) || 0,
      boxes: Number(s.boxes) || 0,
    };
    const assigned = [];

    for (const b of pending) {
      if (placedIds.has(b.batch)) continue;
      const add = {
        slots: 1,
        area: Number(b.areaSqm) || 0,
        weight: b.weightKg == null ? null : Number(b.weightKg) || 0,
        boxes: Number(b.boxes) || 0,
      };

      // Find the first constraint this batch would breach in this container.
      let breach = null;
      for (const d of DIMS) {
        if (cap[d] == null) continue; // dimension unconstrained
        if (d === "weight" && add.weight == null) continue; // uncalibrated weight → skip
        if (used[d] + add[d] > cap[d] + 1e-9) {
          breach = d;
          break;
        }
      }

      if (breach) {
        if (!placedIds.has(b.batch)) blockReason.set(b.batch, breach);
        continue;
      }

      used.slots += add.slots;
      used.area += add.area;
      if (add.weight != null) used.weight += add.weight;
      used.boxes += add.boxes;
      assigned.push(b.batch);
      placedIds.add(b.batch);
      blockReason.delete(b.batch);
    }

    // Utilization per active dimension (null when that cap is absent).
    const utilization = {};
    for (const d of DIMS) {
      utilization[`${d}_pct`] = cap[d] == null ? null : round2((used[d] / cap[d]) * 100);
    }

    // Binding constraint = active dim with highest utilization (tie-break by DIMS order).
    let binding = null;
    let bindingPct = -1;
    for (const d of DIMS) {
      if (cap[d] == null) continue;
      const p = utilization[`${d}_pct`];
      if (p > bindingPct) {
        bindingPct = p;
        binding = d;
      }
    }

    // Underfilled = holds cargo AND every active dimension is below the threshold.
    const activeDims = DIMS.filter((d) => cap[d] != null);
    const underfilled =
      assigned.length > 0 &&
      activeDims.length > 0 &&
      activeDims.every((d) => utilization[`${d}_pct`] < underfillPct);

    return {
      container: c.container,
      container_number: c.container_number,
      capacity: cap,
      used: { slots: used.slots, area: round2(used.area), weight: round2(used.weight), boxes: used.boxes },
      utilization,
      binding,
      underfilled,
      assigned,
    };
  });

  const unassigned = pending
    .filter((b) => !placedIds.has(b.batch))
    .map((b) => ({ batch: b.batch, design: b.design, boxes: b.boxes, reason: blockReason.get(b.batch) || "no_space" }));

  return { perContainer, unassigned };
}

module.exports = { computeFit };
