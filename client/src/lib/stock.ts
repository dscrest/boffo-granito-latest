/* ============================================================
   Live stock derivation for a design/item — one source of truth shared by the
   Item detail, Reports and the transaction line-item rows.

   Everything is computed on the fly. Opening stock is persisted two ways:
   singular items keep a single Design.accounting_stock number; batch-tracked
   items carry it as ProductionLog entry_type="opening" rows (summed per design
   by batchStockApi). Use openingStockFor() to read the right one per item.
     available     = opening + adjusted + produced − loaded   (adjusted = signed stock adjustments, CR-308)
     inProduction  = boxes on an OPEN production order not yet produced
                     (New/InProduction ProductionLog lines, per line remaining).
                     Crucially NOT "ordered − produced" on SO lines — merely
                     raising a Sales Order must not inflate in-production (bug 7.2).
                     SO-confirm auto-queued jobs (request_group "so-…") are that
                     same demand in row form: they count only once TOUCHED
                     (output recorded or dragged out of New). Manual "PR-…"
                     requests count from creation.
     inLoading     = palletised boxes waiting to be loaded.
     awaitingPalletization = boxes an order line owns (produced / allocated)
                     that are not on a pallet yet (CR-298).
   ============================================================ */
import type { Order } from "@/data";
import type { ProductionEntry } from "@/features/stages/productionApi";

/** The opening-stock number to feed designStock() for one item. Batch-tracked
    items sum their entry_type="opening" rows (openingByDesign, keyed on the
    Design ROWID from batchStockApi — CR-341); singular items use accounting_stock.
    Reading only one source per item is the guard against double-counting opening. */
export function openingStockFor(
  design: { isBatched?: boolean; id: string; accountingStock: number | null } | null | undefined,
  openingByDesign?: Map<string, number>,
): number {
  if (!design) return 0;
  return design.isBatched
    ? openingByDesign?.get(design.id) ?? 0
    : design.accountingStock ?? 0;
}

/** Per-order slice of a design's in-production total (for the drill-down popup). */
export interface InProductionOrder {
  salesOrderId: string;
  soLabel: string;
  customer: string;
  qty: number;
}

export interface DesignStock {
  ordered: number; // summed order-line target (open SOs for this design)
  inProduction: number; // committed to production, not yet produced
  inProductionOrders: InProductionOrder[]; // that total, broken down per SO
  inLoading: number; // palletised, awaiting loading
  awaitingPalletization: number; // owned by an order line, not yet palletised (CR-298)
  available: number; // opening + produced − loaded (physically on hand)
  free: number; // available − boxes order items already own but have not loaded (CR-199)
}

/** Derive stock numbers for one item. Pass the full `orders`/`prodLogs`
    lists — filtering by Design ROWID happens here. */
export function designStock(
  designId: string,
  opts: { openingStock?: number; adjusted?: number; allocated?: number; sampleClaimed?: number; orders: Order[]; prodLogs: ProductionEntry[] },
): DesignStock {
  // CR-488: `sampleClaimed` = boxes booked by open sample orders — still on hand, no longer free.
  const { openingStock = 0, adjusted = 0, allocated = 0, sampleClaimed = 0, orders, prodLogs } = opts;
  // CR-341: key on the Design ROWID. The plain design_name is shared by every size · finish
  // of a design, so keying on it merged their stock (and disagreed with AllocateStockModal).
  const ords = orders.filter((o) => o.designId === designId);
  const logs = prodLogs.filter((e) => e.designId === designId);

  const soProduced = ords.reduce((s, o) => s + o.producedQty, 0);
  const loadedTot = ords.reduce((s, o) => s + o.loadedQty, 0);
  // Make-to-stock output has no SO line, so add it straight off the log.
  const stockProduced = logs.reduce((s, e) => (e.independent ? s + e.producedSoFar : s), 0);
  // An allocation moves stock boxes onto an SO line: they now sit in soProduced
  // AND in the stock output (or opening) they came from — count them once.
  const producedTot = soProduced + stockProduced - allocated;

  // In production = every open production line's remaining (requested − produced
  // so far). Completed lines net to 0; requires a real ProductionLog entry, so a
  // fresh SO with no production request contributes nothing. Broken down per SO
  // (independent make-to-stock lines group under one "Make-to-stock" entry) so
  // the drill-down popup shows which orders are running this design.
  const bySo = new Map<string, InProductionOrder>();
  for (const e of logs) {
    if (e.stage === "Completed" || e.status === "Rejected") continue;
    // SO-confirm auto-queued job nobody has touched (still New, nothing recorded)
    // is demand, not production — counting it lets an order cover itself (bug 7.2).
    if (e.requestGroup?.startsWith("so-") && e.stage === "New" && e.producedSoFar === 0) continue;
    const qty = Math.max(0, e.qtyRequested - e.producedSoFar);
    if (qty <= 0) continue;
    const key = e.salesOrderId || "independent";
    const cur = bySo.get(key);
    if (cur) cur.qty += qty;
    else
      bySo.set(key, {
        salesOrderId: e.salesOrderId || "",
        soLabel: e.orderNumber || e.poNumber || (e.independent ? "Make-to-stock" : e.salesOrderId || "—"),
        customer: e.customer || "",
        qty,
      });
  }
  const inProductionOrders = [...bySo.values()];
  const inProduction = inProductionOrders.reduce((s, o) => s + o.qty, 0);

  return {
    ordered: ords.reduce((s, o) => s + o.orderQty, 0),
    inProduction,
    inProductionOrders,
    inLoading: ords.reduce((s, o) => s + Math.max(0, o.palletizedQty - o.loadedQty), 0),
    awaitingPalletization: ords.reduce((s, o) => s + Math.max(0, o.producedQty - o.palletizedQty), 0),
    available: openingStock + adjusted + producedTot - loadedTot,
    free: Math.max(0, openingStock + adjusted + producedTot - loadedTot - ords.reduce((s, o) => s + Math.max(0, o.producedQty - o.loadedQty), 0) - sampleClaimed),
  };
}
