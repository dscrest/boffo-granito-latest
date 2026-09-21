/* ============================================================
   Need production / Stock ready (CR-200, production-first). SO confirm no
   longer creates production jobs — instead every open order line gets a
   DERIVED supply status, and /prod's "To Produce" view sums the shortfall
   per item. No stored column: it is a pure function of the order lines and
   designStock()'s `free` / `inProduction`.
   Lines of one item share that item's free stock FIRST-COME (oldest sales
   order first), so two orders never both read "Stock ready" off the same
   boxes. Zero React imports — needProduction.check.ts runs it under Node.
   ============================================================ */

export type SupplyStatus = "Allocated" | "Stock ready" | "Partial stock" | "In production" | "Need production";

export interface LineSupply {
  status: SupplyStatus;
  /** Chip text — `status`, plus " — N short" when boxes are missing (codeOf strips the tail). */
  label: string;
  color: string;
  need: number; // boxes of the line not yet allocated
  short: number; // boxes neither free stock nor anything allocated covers
}

export interface DemandLine {
  id: string; // OrderItem ROWID
  salesOrderId?: string;
  status?: string; // SalesOrder.status
  designName: string;
  orderQty: number;
  producedQty: number;
  /** SalesOrder.box_brand — the carton the waiting order wants. */
  boxBrandId?: string;
  /** Its name, already resolved by the orders join — no second Brand fetch needed. */
  boxBrandLabel?: string;
}

export interface DemandRow {
  designName: string;
  openDemand: number; // Σ ordered − allocated over open orders
  free: number;
  inProduction: number;
  shortfall: number; // max(0, openDemand − free − inProduction) — what to produce
  orders: number; // distinct sales orders waiting on this item
  /** Open demand split by the orders' Box Brand, biggest first ("" = none set) —
      tells the factory which carton to pack in; [0] prefills Record Output. */
  brands: { boxBrandId: string; label: string; need: number }[];
}

// Completed (CR-230) closes demand too — incl. a partial order short-closed by hand.
const CLOSED = ["Draft", "PendingApproval", "Cancelled", "Rejected", "Completed"];
const isOpen = (o: DemandLine) => !CLOSED.includes(o.status || "");

/** One line's status against the stock still up for grabs. */
export function lineSupply(o: { orderQty: number; producedQty: number }, free: number, inProduction: number): LineSupply {
  const need = Math.max(0, o.orderQty - o.producedQty);
  if (need === 0) return { status: "Allocated", label: "Allocated", color: "var(--c-green)", need, short: 0 };
  if (free >= need) return { status: "Stock ready", label: "Stock ready", color: "var(--c-green)", need, short: 0 };
  const short = need - Math.max(0, free);
  if (free > 0) return { status: "Partial stock", label: `Partial stock — ${short} short`, color: "var(--c-amber)", need, short };
  if (inProduction >= short) return { status: "In production", label: `In production — ${short} short`, color: "var(--c-amber)", need, short };
  return { status: "Need production", label: `Need production — ${short} short`, color: "var(--c-red)", need, short };
}

/** Status per order line (keyed by OrderItem id), sharing each item's free
    stock and in-production pool first-come by sales order. */
export function lineSupplies(
  orders: DemandLine[],
  stockOf: (designName: string) => { free: number; inProduction: number },
): Map<string, LineSupply> {
  const pool = new Map<string, { free: number; inProduction: number }>();
  const out = new Map<string, LineSupply>();
  const sorted = orders.filter(isOpen).slice().sort((a, b) => Number(a.salesOrderId || 0) - Number(b.salesOrderId || 0));
  for (const o of sorted) {
    const p = pool.get(o.designName) ?? pool.set(o.designName, { ...stockOf(o.designName) }).get(o.designName)!;
    const s = lineSupply(o, p.free, p.inProduction);
    out.set(o.id, s);
    const fromFree = Math.min(s.need, Math.max(0, p.free));
    p.free -= fromFree;
    p.inProduction = Math.max(0, p.inProduction - (s.need - fromFree));
  }
  return out;
}

/** /prod "To Produce": one row per item with open demand. */
export function demandByDesign(
  orders: DemandLine[],
  stockOf: (designName: string) => { free: number; inProduction: number },
): DemandRow[] {
  const by = new Map<string, { demand: number; sos: Set<string>; brands: Map<string, number> }>();
  const brandLabel = new Map<string, string>();
  for (const o of orders.filter(isOpen)) {
    const need = Math.max(0, o.orderQty - o.producedQty);
    if (need <= 0) continue;
    const cur = by.get(o.designName) ?? by.set(o.designName, { demand: 0, sos: new Set(), brands: new Map() }).get(o.designName)!;
    cur.demand += need;
    cur.brands.set(o.boxBrandId || "", (cur.brands.get(o.boxBrandId || "") || 0) + need);
    if (o.boxBrandId && o.boxBrandLabel) brandLabel.set(o.boxBrandId, o.boxBrandLabel);
    if (o.salesOrderId) cur.sos.add(o.salesOrderId);
  }
  return [...by.entries()].map(([designName, v]) => {
    const st = stockOf(designName);
    return {
      designName,
      openDemand: v.demand,
      free: st.free,
      inProduction: st.inProduction,
      shortfall: Math.max(0, v.demand - st.free - st.inProduction),
      orders: v.sos.size,
      brands: [...v.brands.entries()].map(([boxBrandId, need]) => ({ boxBrandId, label: brandLabel.get(boxBrandId) || "", need })).sort((a, b) => b.need - a.need),
    };
  });
}

/** Worst line status of an order — for a header chip. */
export function worstSupply(list: LineSupply[]): LineSupply | null {
  const rank: SupplyStatus[] = ["Need production", "In production", "Partial stock", "Stock ready", "Allocated"];
  return list.slice().sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status))[0] ?? null;
}
