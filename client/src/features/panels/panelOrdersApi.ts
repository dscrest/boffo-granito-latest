/* ============================================================
   Panel Orders (Panel Craft) — typed Data Store wrapper.

   A PanelOrder is one customer's order for one showcase Panel × qty.
   Lifecycle (forward-only, server-enforced via /panel-order-status):
   NewRequest → Received → InCutting → Ready → Dispatched, plus direct
   Received → Dispatched when cut-piece stock already covers the order.
   NewRequest (CR-286) = raised from a Quote / Sales Order ("Request
   Panels"); Panel Craft accepts it to Received. Direct orders are born
   Received. Status changes only on /panel-orders/:id (CR-287).
   Ready ADDS the job's cut pieces to CutPieceStock; Dispatched DEDUCTS
   them. CutPieceStock is on-hand per (design, cut size) — audit trail
   is OperationLog + StatusTransition.
   ============================================================ */
import { insert, listAll, op, remove, update, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { listPanels, type PanelRow } from "./panelsApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export const PANEL_ORDER_STATUSES = ["NewRequest", "Received", "InCutting", "Ready", "Dispatched"] as const;
export type PanelOrderStatus = (typeof PANEL_ORDER_STATUSES)[number];

/** Mirrors the server PANEL_ORDER_TRANSITIONS (forward-only). */
export const PANEL_ORDER_TRANSITIONS: Record<PanelOrderStatus, PanelOrderStatus[]> = {
  NewRequest: ["Received"],
  Received: ["InCutting", "Dispatched"],
  InCutting: ["Ready"],
  Ready: ["Dispatched"],
  Dispatched: [],
};

export const PANEL_ORDER_STATUS_LABEL: Record<PanelOrderStatus, string> = {
  NewRequest: "New Request",
  Received: "Received",
  InCutting: "In Cutting",
  Ready: "Ready",
  Dispatched: "Dispatched",
};

/** Button label for moving INTO a status (detail-page header, CR-287). */
export const PANEL_ORDER_ACTION_LABEL: Record<PanelOrderStatus, string> = {
  NewRequest: "",
  Received: "Accept",
  InCutting: "Start Cutting",
  Ready: "Ready",
  Dispatched: "Dispatch",
};

export interface PanelOrderRow {
  id: string; // ROWID
  panelId: string;
  panelCode: string;
  customerId: string;
  customerName: string;
  qty: number; // panels ordered
  salesperson: string;
  orderDate: string; // yyyy-MM-dd
  status: PanelOrderStatus;
  /** Source record when raised via "Request Panels" (CR-286); "" otherwise. */
  salesOrderId: string;
  salesOrderNo: string;
  quoteId: string;
  quoteNo: string;
  /** Manual "Available" ticks on the requirements checklist, keyed stockKey(design, cutSize) (CR-288). */
  checklist: Record<string, boolean>;
  createdTime: string;
  modifiedTime: string;
}

const parseChecklist = (raw: string): Record<string, boolean> => {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

const asStatus = (s: string): PanelOrderStatus =>
  (PANEL_ORDER_STATUSES as readonly string[]).includes(s) ? (s as PanelOrderStatus) : "Received";

/* ---- orders cache ---- */
const cache = createListCache(fetchPanelOrders);

/** Last fetched panel orders, or null if never fetched this session. */
export function cachedPanelOrders(): PanelOrderRow[] | null {
  return cache.cached()?.orders ?? null;
}
/** Drop the cache so the next listPanelOrders() hits the network. */
export function invalidatePanelOrders(): void {
  cache.invalidate();
}

/** All panel orders (panel code + customer name hydrated). Cached + deduped. */
export function listPanelOrders(): Promise<{ ok: boolean; orders: PanelOrderRow[]; error?: string }> {
  return cache.load();
}

async function fetchPanelOrders(): Promise<{ ok: boolean; orders: PanelOrderRow[]; error?: string }> {
  const [orders, customers, panelsRes, sos, quotes] = await Promise.all([
    listAll("PanelOrder", { order: "ROWID desc" }),
    listAll("Customer", { columns: ["name"] }),
    listPanels(), // cached — panel codes
    listAll("SalesOrder", { columns: ["order_number"] }), // source numbers (CR-286)
    listAll("Quote", { columns: ["quote_number"] }),
  ]);
  if (!orders.ok) return { ok: false, orders: [], error: orders.error };
  const custName = new Map((customers.rows || []).map((c) => [String(c.ROWID), str(c.name)]));
  const soNo = new Map((sos.rows || []).map((r) => [String(r.ROWID), str(r.order_number)]));
  const quoteNo = new Map((quotes.rows || []).map((r) => [String(r.ROWID), str(r.quote_number)]));
  const panelCode = new Map((panelsRes.ok ? panelsRes.panels : []).map((p) => [p.id, p.panelCode]));
  const rows: PanelOrderRow[] = (orders.rows || []).map((o) => ({
    id: String(o.ROWID),
    panelId: str(o.panel),
    panelCode: panelCode.get(str(o.panel)) || "—",
    customerId: str(o.customer),
    customerName: custName.get(str(o.customer)) || "—",
    qty: num(o.qty),
    salesperson: str(o.salesperson),
    orderDate: str(o.order_date).slice(0, 10),
    status: asStatus(str(o.status)),
    salesOrderId: str(o.sales_order),
    salesOrderNo: soNo.get(str(o.sales_order)) || "",
    quoteId: str(o.quote),
    quoteNo: quoteNo.get(str(o.quote)) || "",
    checklist: parseChecklist(str(o.checklist)),
    createdTime: str(o.CREATEDTIME),
    modifiedTime: str(o.MODIFIEDTIME),
  }));
  return { ok: true, orders: rows };
}

/* ---- cut-piece stock cache ---- */

export const stockKey = (designId: string, cutSizeId: string) => `${designId}|${cutSizeId}`;

/** One CutPieceStock row (names hydrate in the page from the design/cut-size caches). */
export interface CutStockRow {
  id: string; // ROWID
  designId: string;
  cutSizeId: string;
  qty: number;
  modifiedTime: string;
}

const stockCache = createListCache(fetchCutStock);

/** Last fetched on-hand map keyed stockKey(design, cutSize), or null. */
export function cachedCutStock(): Map<string, number> | null {
  return stockCache.cached()?.stock ?? null;
}
/** Last fetched stock rows (for the /cut-stock grid), or null. */
export function cachedCutStockRows(): CutStockRow[] | null {
  return stockCache.cached()?.rows ?? null;
}
export function invalidateCutStock(): void {
  stockCache.invalidate();
}
export function listCutStock(): Promise<{ ok: boolean; stock: Map<string, number>; rows: CutStockRow[]; error?: string }> {
  return stockCache.load();
}

async function fetchCutStock(): Promise<{ ok: boolean; stock: Map<string, number>; rows: CutStockRow[]; error?: string }> {
  const res = await listAll("CutPieceStock");
  if (!res.ok) return { ok: false, stock: new Map(), rows: [], error: res.error };
  const stock = new Map<string, number>();
  const rows: CutStockRow[] = [];
  for (const r of res.rows || []) {
    stock.set(stockKey(str(r.design), str(r.cut_piece_size)), num(r.qty));
    rows.push({
      id: String(r.ROWID),
      designId: str(r.design),
      cutSizeId: str(r.cut_piece_size),
      qty: num(r.qty),
      modifiedTime: str(r.MODIFIEDTIME),
    });
  }
  return { ok: true, stock, rows };
}

/* ---- stock check (pure) ---- */

/** One requirements-checklist row: a panel line × order qty against on-hand (CR-288). */
export interface Requirement {
  key: string; // stockKey(design, cutSize) — also the checklist tick key
  designId: string;
  cutSizeId: string;
  designName: string;
  cutSizeName: string;
  need: number;
  have: number;
  short: boolean;
}
export type Shortage = Requirement;

/** Every cut-piece requirement of this order (need = line qty × order qty) vs stock. */
export function requirementsFor(order: PanelOrderRow, panel: PanelRow | undefined, stock: Map<string, number>): Requirement[] {
  if (!panel) return [];
  return panel.lines.map((l) => {
    const key = stockKey(l.designId, l.cutSizeId);
    const need = l.qty * order.qty;
    const have = stock.get(key) ?? 0;
    return { key, designId: l.designId, cutSizeId: l.cutSizeId, designName: l.designName, cutSizeName: l.cutSizeName, need, have, short: need > have };
  });
}

/** Cut pieces this order still lacks — [] means stock fully covers it. */
export function shortagesFor(order: PanelOrderRow, panel: PanelRow | undefined, stock: Map<string, number>): Shortage[] {
  return requirementsFor(order, panel, stock).filter((r) => r.short);
}

/** "Short: Design · size — have 2 of 6; …" — the one wording for every missing-items hint (CR-288). */
export function shortageText(short: Shortage[]): string {
  return short.length ? `Short: ${short.map((s) => `${s.designName} · ${s.cutSizeName} — have ${s.have} of ${s.need}`).join("; ")}` : "";
}

/* ---- mutations (invalidate both caches — status flips move stock) ---- */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    stockCache.invalidate();
    return r;
  });
}

export interface PanelOrderInput {
  panel: string; // Panel ROWID
  customer: string; // Customer ROWID
  qty: number;
  salesperson: string;
  order_date: string; // yyyy-MM-dd
  /** Source record (CR-286) — set by "Request Panels" from an SO / Quote; the order is then born NewRequest. */
  sales_order?: string;
  quote?: string;
}

export function createPanelOrder(input: PanelOrderInput): Promise<OpResult> {
  const fromSale = !!(input.sales_order || input.quote);
  const payload: Record<string, unknown> = { ...input, status: fromSale ? "NewRequest" : "Received" };
  if (!input.order_date) delete payload.order_date; // date cols reject ""
  if (!input.sales_order) delete payload.sales_order; // bigint cols reject ""
  if (!input.quote) delete payload.quote;
  return bust(insert("PanelOrder", payload));
}

/** Persist the manual Available ticks (CR-288) — plain column, generic PATCH. */
export function saveChecklist(rowid: string, checklist: Record<string, boolean>): Promise<OpResult> {
  return bust(update("PanelOrder", rowid, { checklist: JSON.stringify(checklist) }));
}

export function deletePanelOrder(rowid: string, reason?: string): Promise<OpResult> {
  return bust(remove("PanelOrder", rowid, reason));
}

/** Stage flip via the status machine (adds stock on Ready, deducts on Dispatched). */
export function setPanelOrderStatus(rowid: string, status: PanelOrderStatus) {
  return bust(op<{ ROWID: string; status: string }>(`panel-order-status/${rowid}`, { status }));
}

/** Manual on-hand entry — sets the absolute stock for (design, cut size). */
export function setCutPieceStock(design: string, cutSize: string, qty: number) {
  return bust(op<{ qty: number }>("cut-stock-adjust", { design, cut_piece_size: cutSize, qty }));
}
