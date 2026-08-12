/* ============================================================
   Live stock derivation for a design/item — one source of truth shared by the
   Item detail, Reports and the transaction line-item rows.

   Everything is computed on the fly. Opening stock is persisted two ways:
   singular items keep a single Design.accounting_stock number; batch-tracked
   items carry it as ProductionLog entry_type="opening" rows (summed per design
   by batchStockApi). Use openingStockFor() to read the right one per item.
     available     = opening + produced − loaded
     inProduction  = boxes on an OPEN production order not yet produced
                     (New/InProduction ProductionLog lines, per line remaining).
                     Crucially NOT "ordered − produced" on SO lines — merely
                     raising a Sales Order must not inflate in-production (bug 7.2).
                     SO-confirm auto-queued jobs (request_group "so-…") are that
                     same demand in row form: they count only once TOUCHED
                     (output recorded or dragged out of New). Manual "PR-…"
                     requests count from creation.
     inLoading     = palletised boxes waiting to be loaded.
   ============================================================ */
import type { Order } from "@/data";
import type { ProductionEntry } from "@/features/stages/productionApi";

/** The opening-stock number to feed designStock() for one item. Batch-tracked
    items sum their entry_type="opening" rows (openingByDesign, keyed on
    design_name from batchStockApi); singular items use accounting_stock. Reading
    only one source per item is the guard against double-counting opening. */
export function openingStockFor(
  design: { isBatched?: boolean; designName: string; accountingStock: number | null } | null | undefined,
  openingByDesign?: Map<string, number>,
): number {
  if (!design) return 0;
  return design.isBatched
    ? openingByDesign?.get(design.designName) ?? 0
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
  available: number; // opening + produced − loaded
}

/** Derive stock numbers for one design. Pass the full `orders`/`prodLogs`
    lists — filtering by design name happens here. */
export function designStock(
  designName: string,
  opts: { openingStock?: number; orders: Order[]; prodLogs: ProductionEntry[] },
): DesignStock {
  const { openingStock = 0, orders, prodLogs } = opts;
  // Key on the plain design_name — the shared stock key. Order.design is the
  // full unique label (name · size · finish) for display, so match on
  // Order.designName (plain), which lines up with ProductionEntry.design.
  const ords = orders.filter((o) => (o.designName || o.design) === designName);
  const logs = prodLogs.filter((e) => e.design === designName);

  const soProduced = ords.reduce((s, o) => s + o.producedQty, 0);
  const loadedTot = ords.reduce((s, o) => s + o.loadedQty, 0);
  // Make-to-stock output has no SO line, so add it straight off the log.
  const stockProduced = logs.reduce((s, e) => (e.independent ? s + e.producedSoFar : s), 0);
  const producedTot = soProduced + stockProduced;

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
    available: openingStock + producedTot - loadedTot,
  };
}
