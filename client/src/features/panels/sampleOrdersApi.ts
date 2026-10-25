/* ============================================================
   Sample Orders (Panel Craft, CR-315…317) — typed Data Store wrapper.

   A SampleOrder is a customer's request for item SAMPLES — full tiles
   or cut pieces of any Item-master design — kept as its OWN order type
   next to Panel Orders (user decision 2026-10-08: separate orders, same
   Customer). Header (SMP/FY/NNN, customer, date, sales person, note,
   optional source SO / Quote) + SampleOrderLine rows (item × Full|Cut ×
   cut size × qty) save in ONE call (/sample-order-save); edit / delete
   only while New. Supply is recorded per line, partial allowed
   (CR-347: a supply is a LOAD, /panel-load-save: qty + date + vehicle); the header status is DERIVED:
   New → PartiallySupplied → Supplied (sampleOrderStatus.ts).
   Stock: a Cut line deducts cut-piece stock (ledger kind "sample");
   a Full tile is record-only (box stock has no per-piece path — the
   godown writes the opened box off on Stock Adjustments).
   ============================================================ */
import { listAll, op, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { listDesigns, type DesignImage } from "@/features/masters/designsApi";
import { listPanels } from "./panelsApi";
import { invalidateCutStock, parseLoads, type LoadRow } from "./panelOrdersApi";
import { deriveSampleStatus, SAMPLE_STATUSES, type SampleOrderStatus } from "./sampleOrderStatus";

export { deriveSampleStatus, remaining, SAMPLE_STATUSES, type SampleOrderStatus } from "./sampleOrderStatus";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export const SAMPLE_STATUS_LABEL: Record<SampleOrderStatus, string> = {
  New: "New",
  PartiallySupplied: "Partially Supplied",
  Supplied: "Supplied",
  Cancelled: "Cancelled",
};

export type SamplePieceKind = "Full" | "Cut";
export const SAMPLE_PIECE_LABEL: Record<SamplePieceKind, string> = { Full: "Full tile", Cut: "Cut piece" };

/** Header + lines may change (and the order may be deleted) only here — mirrors the server. */
export const SAMPLE_ORDER_EDITABLE: ReadonlySet<SampleOrderStatus> = new Set<SampleOrderStatus>(["New"]);
export const SAMPLE_ORDER_LOCK_REASON = "Samples have been supplied — items and quantities are locked";

export interface SampleOrderLineRow {
  id: string; // SampleOrderLine ROWID
  designId: string;
  designName: string;
  images: DesignImage[];
  pieceKind: SamplePieceKind;
  cutSizeId: string; // "" for a Full tile
  cutSizeName: string;
  qty: number; // requested
  suppliedQty: number;
  suppliedOn: string; // yyyy-MM-dd of the LAST supply, "" if none
  note: string;
}

export interface SampleOrderRow {
  id: string; // ROWID
  orderNumber: string; // SMP/FY/NNN (server-assigned)
  customerId: string;
  customerCode: string; // /parties/:code
  customerName: string;
  salesperson: string;
  orderDate: string; // yyyy-MM-dd
  status: SampleOrderStatus;
  /** Source record when raised via "Request Samples" (CR-317); "" otherwise. */
  salesOrderId: string;
  salesOrderNo: string;
  quoteId: string;
  quoteNo: string;
  note: string;
  lines: SampleOrderLineRow[];
  /** CR-347: vehicle trips (= supplies) recorded against this order, oldest first. */
  loads: LoadRow[];
  totalQty: number;
  suppliedQty: number;
  createdTime: string;
  modifiedTime: string;
}

const asStatus = (s: string, lines: SampleOrderLineRow[]): SampleOrderStatus =>
  (SAMPLE_STATUSES as readonly string[]).includes(s) ? (s as SampleOrderStatus) : deriveSampleStatus(lines);

/* ---- orders cache ---- */
const cache = createListCache(fetchSampleOrders);

/** Last fetched sample orders, or null if never fetched this session. */
export function cachedSampleOrders(): SampleOrderRow[] | null {
  return cache.cached()?.orders ?? null;
}
export function invalidateSampleOrders(): void {
  cache.invalidate();
}
/** All sample orders (lines, item names + customer hydrated). Cached + deduped. */
export function listSampleOrders(): Promise<{ ok: boolean; orders: SampleOrderRow[]; error?: string }> {
  return cache.load();
}

async function fetchSampleOrders(): Promise<{ ok: boolean; orders: SampleOrderRow[]; error?: string }> {
  const [orders, lines, customers, designsRes, panelsRes, sos, quotes, loads, loadLines] = await Promise.all([
    listAll("SampleOrder", { order: "ROWID desc" }),
    listAll("SampleOrderLine"),
    listAll("Customer", { columns: ["name", "code"] }),
    listDesigns(), // cached — item names + images
    listPanels(), // cached — cut-size names
    listAll("SalesOrder", { columns: ["order_number"] }),
    listAll("Quote", { columns: ["quote_number"] }),
    listAll("PanelLoad"), // CR-347
    listAll("PanelLoadLine"),
  ]);
  if (!orders.ok) return { ok: false, orders: [], error: orders.error };
  if (!lines.ok) return { ok: false, orders: [], error: lines.error };
  const cust = new Map((customers.rows || []).map((c) => [String(c.ROWID), { name: str(c.name), code: str(c.code) }]));
  const soNo = new Map((sos.rows || []).map((r) => [String(r.ROWID), str(r.order_number)]));
  const quoteNo = new Map((quotes.rows || []).map((r) => [String(r.ROWID), str(r.quote_number)]));
  const design = new Map((designsRes.ok ? designsRes.designs : []).map((d) => [d.id, d]));
  const cutName = new Map((panelsRes.ok ? panelsRes.cutSizes : []).map((c) => [c.id, c.label]));
  const loadsByOrder = parseLoads(loads.rows || [], loadLines.rows || [], "sample_order");
  const linesByOrder = new Map<string, SampleOrderLineRow[]>();
  for (const l of lines.rows || []) {
    const key = str(l.sample_order);
    const d = design.get(str(l.design));
    const row: SampleOrderLineRow = {
      id: String(l.ROWID),
      designId: str(l.design),
      designName: d?.uniqueName || d?.designName || "—",
      images: d?.images ?? [],
      pieceKind: str(l.piece_kind) === "Cut" ? "Cut" : "Full",
      cutSizeId: str(l.cut_piece_size),
      cutSizeName: cutName.get(str(l.cut_piece_size)) || "",
      qty: num(l.qty),
      suppliedQty: num(l.supplied_qty),
      suppliedOn: str(l.supplied_on).slice(0, 10),
      note: str(l.note),
    };
    linesByOrder.set(key, [...(linesByOrder.get(key) ?? []), row]);
  }
  const rows: SampleOrderRow[] = (orders.rows || []).map((o) => {
    const id = String(o.ROWID);
    const ls = linesByOrder.get(id) ?? [];
    const c = cust.get(str(o.customer));
    return {
      id,
      orderNumber: str(o.order_number),
      customerId: str(o.customer),
      customerCode: c?.code || "",
      customerName: c?.name || "—",
      salesperson: str(o.salesperson),
      orderDate: str(o.order_date).slice(0, 10),
      status: asStatus(str(o.status), ls),
      salesOrderId: str(o.sales_order),
      salesOrderNo: soNo.get(str(o.sales_order)) || "",
      quoteId: str(o.quote),
      quoteNo: quoteNo.get(str(o.quote)) || "",
      note: str(o.note),
      lines: ls,
      loads: loadsByOrder.get(id) ?? [],
      totalQty: ls.reduce((s, l) => s + l.qty, 0),
      suppliedQty: ls.reduce((s, l) => s + l.suppliedQty, 0),
      createdTime: str(o.CREATEDTIME),
      modifiedTime: str(o.MODIFIEDTIME),
    };
  });
  return { ok: true, orders: rows };
}

/* ---- mutations (a supply moves cut stock — bust both) ---- */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    invalidateCutStock();
    return r;
  });
}

export interface SampleOrderLineInput {
  design: string; // Design ROWID
  piece_kind: SamplePieceKind;
  cut_piece_size?: string; // CutPieceSize ROWID — Cut only
  qty: number;
  note?: string;
}

export interface SampleOrderInput {
  customer: string; // Customer ROWID
  salesperson: string;
  order_date: string; // yyyy-MM-dd
  note?: string;
  /** Source record (CR-317) — set by "Request Samples" from an SO / Quote; create only. */
  sales_order?: string;
  quote?: string;
  lines: SampleOrderLineInput[];
}

/** Form prefill for edit / clone. */
export function sampleOrderToInput(o: SampleOrderRow): SampleOrderInput {
  return {
    customer: o.customerId,
    salesperson: o.salesperson,
    order_date: o.orderDate,
    note: o.note || undefined,
    sales_order: o.salesOrderId || undefined,
    quote: o.quoteId || undefined,
    lines: o.lines.map((l) => ({ design: l.designId, piece_kind: l.pieceKind, cut_piece_size: l.cutSizeId || undefined, qty: l.qty, note: l.note || undefined })),
  };
}

/** Create (no rowid — born New, SMP number assigned) or update header + lines in one call. */
export function saveSampleOrder(input: SampleOrderInput, rowid?: string): Promise<OpResult<{ ROWID: string; order_number: string }>> {
  return bust(op<{ ROWID: string; order_number: string }>("sample-order-save", rowid ? { ...input, rowid } : input));
}

/** Soft-delete header + lines — New only, reason mandatory (server-enforced). */
export function deleteSampleOrder(rowid: string, reason?: string): Promise<OpResult> {
  return bust(op(`sample-order-delete/${rowid}`, { reason }));
}

/** CR-368: cancel — reason mandatory for every role; only while nothing has been supplied or loaded. */
export function cancelSampleOrder(rowid: string, reason: string): Promise<OpResult> {
  return bust(op(`sample-order-cancel/${rowid}`, { reason }));
}

// CR-347: a supply IS a load — see panelLoadsApi.saveLoad (the old /sample-order-supply is gone).
