/* ============================================================
   Batch-wise stock — one row per (item · batch) with the boxes still on
   hand. Powers the Inventory ▸ Stock Details grid, the item detail Stock
   tab and the batch-wise stock report.

   Stock is not stored per batch; this file only FETCHES and decorates —
   all netting lives in the pure reducer (batchStockDerive.ts, which carries
   its own runnable check). Supply and consumption fed to it:

   SUPPLY
     record rows            → produced, on the row's batch ("" when legacy)
     plan-row qty_boxes     → produced, on "" (pre-split-model recorded output)
     opening rows           → opening, on the row's batch
     adjust rows            → adjusted (SIGNED), on the row's batch — CR-308
     accounting_stock       → opening, on "" (singular items only)

   CONSUMPTION — the same ground truth recountOrderItems uses:
     LIVE    PalletizationPlanLine + its LoadBox: ReadyToLoad-or-boxed =
             palletised, in-a-box = loaded, box Dispatched = dispatched.
             Blank-batch lines are legitimate (manual plans, palletise-before-
             produce residue from autoEnqueue and /send-to-loading) — the
             reducer nets them FIFO instead of dropping them.
     LEGACY  a PalletisedBatch with a ContainerLoading row (historic data;
             the UI entry points are retired). Summed alongside live, no
             dedupe — the flows are disjoint in time.

   Per design, Σ current ≈ designStock().available (lib/stock.ts) — the
   conservation law batchStockDerive.check.ts asserts.
   ============================================================ */
import { listAll, type DSRow, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { listPalPlans, subscribePalPlans } from "./palPlansApi";
import { deriveBatchStock, freeOf, reservedByBatch, type ClaimIn, type ConsumeIn, type LoadedIn, type SupplyIn } from "./batchStockDerive";
import { deriveWarehouseStock, parsePurposes, type WarehouseIn, type WhCell, type WhMoveIn } from "@/lib/warehouseStock";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface BatchStockRow {
  designId: string;
  designName: string; // Design.design_name — the stock key
  designLabel: string; // Design.unique_name (fallback design_name)
  sizeCode: string; // Size.code via Design.size
  batchNumber: string; // "" → the Unattributed bucket, shown "—"
  mfgDate: string; // earliest production_date of the batch ("" = unknown)
  opening: number;
  produced: number;
  adjusted: number; // Σ signed stock adjustments (CR-308)
  palletised: number; // committed to a pallet (incl. loaded)
  loaded: number; // in a load box / legacy container
  dispatched: number;
  current: number; // max(0, opening + produced + adjusted − loaded)
  over: number; // consumption this row's supply could not cover — anomaly
  reserved: number; // claimed by order items (order-linked output + allocations), not yet loaded
  free: number; // max(0, current − reserved) — what Allocate Stock may still hand out (CR-199)
}

const cache = createListCache(fetchBatchStock);

// Loading/dispatch moves the consumption side, and that lives in the palPlans
// cache — so batch stock follows it rather than each caller busting both.
subscribePalPlans(() => cache.invalidate());

export function cachedBatchStock(): BatchStockRow[] | null {
  return cache.cached()?.rows ?? null;
}
/** Σ opening-stock boxes per Design ROWID (CR-341) — feeds designStock via openingStockFor.
    Sourced ONLY from entry_type='opening' rows: openingStockFor consumes this
    exclusively for batched items and reads accounting_stock itself for singular
    ones, so folding accounting_stock in here would double count. */
export function cachedOpeningByDesign(): Map<string, number> {
  return cache.cached()?.openingByDesign ?? new Map();
}
/** Σ signed adjustment boxes per Design ROWID (CR-308/339) — designStock's `adjusted`
    term. Kept SEPARATE from openingByDesign: singular items read opening from
    accounting_stock and would lose adjustments folded in there. */
export function cachedAdjustedByDesign(): Map<string, number> {
  return cache.cached()?.adjustedByDesign ?? new Map();
}
/** Per (item · batch · warehouse) on-hand / committed (CR-329) — keys are `designId|batch`. */
export function cachedWarehouseStock(): WhCell[] {
  return cache.cached()?.byWarehouse ?? [];
}
export const warehouseStockKey = (designId: string, batch: string) => `${designId}|${batch}`;
export function invalidateBatchStock(): void {
  cache.invalidate();
}

export interface BatchStockResult {
  ok: boolean;
  rows: BatchStockRow[];
  openingByDesign: Map<string, number>;
  adjustedByDesign: Map<string, number>;
  /** CR-329: the same stock split per warehouse (deriveWarehouseStock). */
  byWarehouse: WhCell[];
  error?: string;
}

/** All batch stock rows, hydrated. Cached + deduped. */
export function listBatchStock(): Promise<BatchStockResult> {
  return cache.load();
}

async function fetchBatchStock(): Promise<BatchStockResult> {
  const [logs, designs, sizes, palPlans, pbatches, plines, loadings, items, warehouses] = await Promise.all([
    listAll("ProductionLog", { columns: ["entry_type", "design", "qty_boxes", "batch_number", "production_date", "order_item", "warehouse"] }),
    listAll("Design", { columns: ["design_name", "unique_name", "size", "is_batched", "accounting_stock"] }),
    listAll("Size", { columns: ["code"] }),
    listPalPlans(),
    listAll("PalletisedBatch", { columns: ["design", "boxes_packed", "batch_number", "is_mixed", "status"] }),
    listAll("PalletisedBatchLine", { columns: ["batch", "order_item", "boxes", "batch_number"] }),
    listAll("ContainerLoading", { columns: ["batch"] }),
    listAll("OrderItem", { columns: ["design"] }),
    listAll("Warehouse", { columns: ["is_primary", "purposes"] }),
  ]);
  const fail = (error: string): BatchStockResult => ({ ok: false, rows: [], openingByDesign: new Map(), adjustedByDesign: new Map(), byWarehouse: [], error });
  if (!logs.ok || !designs.ok) return fail(logs.error || designs.error || "Failed to load stock sources");
  const truncated = [logs, designs, sizes, pbatches, plines, loadings, items].some((r: OpResult) => r.truncated);
  if (truncated) return fail("Too many rows to load — batch stock would be incomplete. Contact support.");

  // Design ROWID → { name, label, sizeId, batched, accounting }
  const dName = new Map<string, string>();
  const dLabel = new Map<string, string>();
  const dSize = new Map<string, string>();
  (designs.rows || []).forEach((d) => {
    const id = String(d.ROWID);
    dName.set(id, str(d.design_name));
    dLabel.set(id, str(d.unique_name) || str(d.design_name));
    dSize.set(id, str(d.size));
  });
  const sizeCode = new Map<string, string>();
  (sizes.rows || []).forEach((s) => sizeCode.set(String(s.ROWID), str(s.code)));
  const oiDesign = new Map<string, string>(); // OrderItem ROWID → Design ROWID
  (items.rows || []).forEach((it) => oiDesign.set(String(it.ROWID), str(it.design)));

  // ---- Supply --------------------------------------------------
  const supply: SupplyIn[] = [];
  // Claims = boxes an order item already owns: order-linked output (record /
  // legacy plan rows) and stock allocations (entry_type "alloc" — a claim only,
  // never supply, so allocating does not inflate on-hand).
  const claims: ClaimIn[] = [];
  const openingByDesign = new Map<string, number>();
  const adjustedByDesign = new Map<string, number>();
  // CR-329: the same supply, per warehouse (null = primary); consumption is added below from the derived rows.
  const whMoves: WhMoveIn[] = [];
  const whOf = (r: DSRow) => (str(r.warehouse) ? str(r.warehouse) : null);
  for (const r of logs.rows || []) {
    const type = str(r.entry_type);
    const designId = str(r.design);
    const qty = num(r.qty_boxes);
    if (!designId) continue;
    const date = str(r.production_date).slice(0, 10);
    // CR-330: a transfer leg is net zero per batch — only the warehouse split sees it.
    if (type === "transfer") {
      if (qty) whMoves.push({ key: `${designId}|${str(r.batch_number)}`, warehouse: whOf(r), qty });
      continue;
    }
    // CR-308: adjustments are SIGNED — handled before the qty guard below.
    if (type === "adjust") {
      if (qty === 0) continue;
      supply.push({ designId, batch: str(r.batch_number), qty, kind: "adjust", date });
      whMoves.push({ key: `${designId}|${str(r.batch_number)}`, warehouse: whOf(r), qty });
      adjustedByDesign.set(designId, (adjustedByDesign.get(designId) || 0) + qty);
      continue;
    }
    if (qty <= 0) continue;
    const oi = str(r.order_item);
    if (oi && (type === "record" || type === "alloc" || type === "plan"))
      claims.push({ designId, batch: type === "plan" ? "" : str(r.batch_number), orderItemId: oi, qty });
    if (type === "record") {
      supply.push({ designId, batch: str(r.batch_number), qty, kind: "produced", date });
      whMoves.push({ key: `${designId}|${str(r.batch_number)}`, warehouse: whOf(r), qty });
    } else if (type === "opening") {
      supply.push({ designId, batch: str(r.batch_number), qty, kind: "opening", date });
      whMoves.push({ key: `${designId}|${str(r.batch_number)}`, warehouse: whOf(r), qty });
      openingByDesign.set(designId, (openingByDesign.get(designId) || 0) + qty);
    } else if (type === "plan") {
      // Pre-split-model output recorded directly on the plan row — real
      // produced boxes with no batch attribution.
      supply.push({ designId, batch: "", qty, kind: "produced", date: "" });
      whMoves.push({ key: `${designId}|`, warehouse: null, qty });
    }
  }
  for (const d of designs.rows || []) {
    const batched = d.is_batched === true || str(d.is_batched) === "true";
    const acc = num(d.accounting_stock);
    if (!batched && acc > 0) {
      supply.push({ designId: String(d.ROWID), batch: "", qty: acc, kind: "opening", date: "" });
      whMoves.push({ key: `${String(d.ROWID)}|`, warehouse: null, qty: acc });
    }
  }

  // ---- Consumption ---------------------------------------------
  const consumption: ConsumeIn[] = [];
  // ponytail: legacy single-design containers carry no order item, so their
  // loads never release a claim — historic, fully-dispatched data only.
  const loadedByOi: LoadedIn[] = [];
  // LIVE — plan lines carry the batch; the LoadBox carries the status.
  if (palPlans.ok) {
    const boxById = new Map(palPlans.boxes.map((b) => [b.id, b]));
    for (const p of palPlans.plans) {
      for (const l of p.lines) {
        const box = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
        if (l.status !== "ReadyToLoad" && !box) continue; // still queue
        consumption.push({
          designId: l.designId,
          batch: l.batchNumber,
          boxes: l.boxes,
          loaded: !!box,
          dispatched: box?.status === "Dispatched",
        });
        if (box && l.orderItemId) loadedByOi.push({ orderItemId: l.orderItemId, batch: l.batchNumber, boxes: l.boxes });
      }
    }
  }
  // LEGACY — palletised batches that have a ContainerLoading row.
  const loadedSet = new Set((loadings.rows || []).map((r) => str(r.batch)));
  const linesByBatch = new Map<string, DSRow[]>();
  (plines.rows || []).forEach((l) => {
    const b = str(l.batch);
    (linesByBatch.get(b) ?? linesByBatch.set(b, []).get(b)!).push(l);
  });
  for (const b of pbatches.rows || []) {
    const id = String(b.ROWID);
    if (!loadedSet.has(id)) continue;
    const dispatched = str(b.status) === "dispatched";
    // A design-less header IS a mixed pallet: rows predating the is_mixed flag
    // carry design null instead — resolve their design per line, like modern
    // mixed pallets (line order_item → OrderItem.design).
    const isMixed = b.is_mixed === true || str(b.is_mixed) === "true" || !str(b.design);
    if (!isMixed) {
      consumption.push({ designId: str(b.design), batch: str(b.batch_number), boxes: num(b.boxes_packed), loaded: true, dispatched });
    } else {
      for (const l of linesByBatch.get(id) || []) {
        const designId = oiDesign.get(str(l.order_item)) || "";
        if (!designId) continue; // no design to attribute to — data anomaly
        consumption.push({ designId, batch: str(l.batch_number), boxes: num(l.boxes), loaded: true, dispatched });
        loadedByOi.push({ orderItemId: str(l.order_item), batch: str(l.batch_number), boxes: num(l.boxes) });
      }
    }
  }

  const reserved = reservedByBatch(claims, loadedByOi);
  const derived = deriveBatchStock(supply, consumption);
  // CR-329: what each batch LOST (loaded, FIFO-absorbed by the reducer) leaves
  // from whichever warehouse holds it — Loading Bay first; reserved boxes show
  // as committed the same way. Σ per batch over warehouses = current.
  const whClaims: { key: string; warehouse: null; qty: number }[] = [];
  for (const r of derived) {
    const key = `${r.designId}|${r.batch}`;
    const absorbed = r.opening + r.produced + r.adjusted - r.current;
    if (absorbed > 0) whMoves.push({ key, warehouse: null, qty: -absorbed });
    const committed = r.current - freeOf(r, reserved);
    if (committed > 0) whClaims.push({ key, warehouse: null, qty: committed });
  }
  const whList: WarehouseIn[] = (warehouses.rows || []).map((w) => ({
    id: String(w.ROWID),
    isPrimary: w.is_primary === true || str(w.is_primary) === "true",
    purposes: parsePurposes(str(w.purposes)),
  }));
  const byWarehouse = deriveWarehouseStock(whList, whMoves, whClaims);
  const rows: BatchStockRow[] = derived.map((r) => ({
    designId: r.designId,
    designName: dName.get(r.designId) || r.designId,
    designLabel: dLabel.get(r.designId) || dName.get(r.designId) || r.designId,
    sizeCode: sizeCode.get(dSize.get(r.designId) || "") || "",
    batchNumber: r.batch,
    mfgDate: r.mfgDate,
    opening: r.opening,
    produced: r.produced,
    adjusted: r.adjusted,
    palletised: r.palletised,
    loaded: r.loaded,
    dispatched: r.dispatched,
    current: r.current,
    over: r.over,
    reserved: r.current - freeOf(r, reserved),
    free: freeOf(r, reserved),
  }));
  return { ok: true, rows, openingByDesign, adjustedByDesign, byWarehouse };
}
