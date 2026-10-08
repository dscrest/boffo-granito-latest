/* ============================================================
   Panel Orders (Panel Craft) — typed Data Store wrapper.

   CR-302: a PanelOrder is a HEADER (customer, PNL/FY/NNN number, date,
   sales person, status) with PanelOrderLine rows — one per showcase
   Panel × qty — the Sales Order shape. Header + lines save in ONE call
   (/panel-order-save); lines are editable only while New / Received.
   Lifecycle (forward-only, server-enforced via /panel-order-status):
   NewRequest → Received → InCutting → Ready → Dispatched, plus direct
   Received → Dispatched when cut-piece stock already covers the order.
   NewRequest (label "New") is where EVERY order is born — direct or raised
   from a Quote / Sales Order ("Request Panels", CR-286; CR-294 made direct
   orders start there too). Panel Craft accepts it to Received. Status
   changes only on /panel-orders/:id (CR-287).
   Ready ADDS Σ(line pieces × line qty) to CutPieceStock; Dispatched
   DEDUCTS the same. CutPieceStock is on-hand per (design, cut size) —
   audit trail is OperationLog + StatusTransition.
   CR-312: `allocation` = cut pieces BOOKED to the order (a claim on
   on-hand, set absolute via /panel-order-allocate; Ready books its own
   output; Dispatch requires every piece booked). CR-313: `checkpoints`
   = MDF · Vinyl Printing · Cut Pieces marks via /panel-order-checkpoint.
   ============================================================ */
import { listAll, op, update, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { invalidatePanels, listPanels } from "./panelsApi";
import type { Allocation, CheckpointKey, Checkpoints, Shortage } from "./panelOrderNeeds";

export {
  allocatedByKey,
  CHECKPOINT_KEYS,
  CHECKPOINT_LABEL,
  CHECKPOINT_STATUSES,
  checkpointStatus,
  demandByKey,
  PANEL_ORDER_OPEN,
  readiness,
  requirementsFor,
  shortagesFor,
  stockKey,
  type Allocation,
  type CheckpointKey,
  type CheckpointMark,
  type Checkpoints,
  type DemandRow,
  type NeedLine,
  type NeedOpts,
  type Readiness,
  type Requirement,
  type Shortage,
} from "./panelOrderNeeds";

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
  NewRequest: "New", // CR-294: the born stage, every order
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

/** Header + lines may change (and the order may be deleted) only here — mirrors the server (CR-302). */
export const PANEL_ORDER_EDITABLE: ReadonlySet<PanelOrderStatus> = new Set<PanelOrderStatus>(["NewRequest", "Received"]);
export const PANEL_ORDER_LOCK_REASON = "Cutting has started — panels and quantities are locked";

export interface PanelOrderLineRow {
  id: string; // PanelOrderLine ROWID
  panelId: string;
  panelCode: string;
  qty: number; // panels of this type
  mdfId: string; // Mdf ROWID the panel is mounted on (CR-309); "" = not picked
}

export interface PanelOrderRow {
  id: string; // ROWID
  orderNumber: string; // PNL/FY/NNN (server-assigned)
  customerId: string;
  customerCode: string; // /parties/:code
  customerName: string;
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
  /** CR-312: cut pieces booked to this order, keyed stockKey(design, cutSize). */
  allocation: Allocation;
  /** CR-313: MDF · Vinyl Printing · Cut Pieces marks (missing = Pending). */
  checkpoints: Checkpoints;
  lines: PanelOrderLineRow[];
  panelCount: number;
  totalQty: number;
  createdTime: string;
  modifiedTime: string;
}

/** JSON text column → object ({} on blank / bad JSON) — checklist, allocation, checkpoints. */
const parseJsonCol = <T extends object>(raw: string): T => {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
};
const parseChecklist = (raw: string) => parseJsonCol<Record<string, boolean>>(raw);
const parseAllocation = (raw: string): Allocation =>
  Object.fromEntries(Object.entries(parseJsonCol<Record<string, unknown>>(raw)).map(([k, v]) => [k, num(v)]).filter(([, v]) => (v as number) > 0));

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

/** All panel orders (lines, panel codes + customer hydrated). Cached + deduped. */
export function listPanelOrders(): Promise<{ ok: boolean; orders: PanelOrderRow[]; error?: string }> {
  return cache.load();
}

async function fetchPanelOrders(): Promise<{ ok: boolean; orders: PanelOrderRow[]; error?: string }> {
  const [orders, lines, customers, panelsRes, sos, quotes] = await Promise.all([
    listAll("PanelOrder", { order: "ROWID desc" }),
    listAll("PanelOrderLine"),
    listAll("Customer", { columns: ["name", "code"] }),
    listPanels(), // cached — panel codes
    listAll("SalesOrder", { columns: ["order_number"] }), // source numbers (CR-286)
    listAll("Quote", { columns: ["quote_number"] }),
  ]);
  if (!orders.ok) return { ok: false, orders: [], error: orders.error };
  if (!lines.ok) return { ok: false, orders: [], error: lines.error };
  const cust = new Map((customers.rows || []).map((c) => [String(c.ROWID), { name: str(c.name), code: str(c.code) }]));
  const soNo = new Map((sos.rows || []).map((r) => [String(r.ROWID), str(r.order_number)]));
  const quoteNo = new Map((quotes.rows || []).map((r) => [String(r.ROWID), str(r.quote_number)]));
  const panelCode = new Map((panelsRes.ok ? panelsRes.panels : []).map((p) => [p.id, p.panelCode]));
  const linesByOrder = new Map<string, PanelOrderLineRow[]>();
  for (const l of lines.rows || []) {
    const key = str(l.panel_order);
    const row: PanelOrderLineRow = { id: String(l.ROWID), panelId: str(l.panel), panelCode: panelCode.get(str(l.panel)) || "—", qty: num(l.qty), mdfId: str(l.mdf) };
    linesByOrder.set(key, [...(linesByOrder.get(key) ?? []), row]);
  }
  const rows: PanelOrderRow[] = (orders.rows || []).map((o) => {
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
      status: asStatus(str(o.status)),
      salesOrderId: str(o.sales_order),
      salesOrderNo: soNo.get(str(o.sales_order)) || "",
      quoteId: str(o.quote),
      quoteNo: quoteNo.get(str(o.quote)) || "",
      checklist: parseChecklist(str(o.checklist)),
      allocation: parseAllocation(str(o.allocation)),
      checkpoints: parseJsonCol<Checkpoints>(str(o.checkpoints)),
      lines: ls,
      panelCount: ls.length,
      totalQty: ls.reduce((s, l) => s + l.qty, 0),
      createdTime: str(o.CREATEDTIME),
      modifiedTime: str(o.MODIFIEDTIME),
    };
  });
  return { ok: true, orders: rows };
}

/* ---- cut-piece stock cache ---- */

/** One CutPieceStock row = one cut-piece ITEM (CR-306): the pair, its weight, what is on hand.
    Names hydrate in the page from the design/cut-size caches. */
export interface CutStockRow {
  id: string; // ROWID
  designId: string;
  cutSizeId: string;
  qty: number;
  weightKg: number | null; // kg per piece; null = not set yet
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
/** Last fetched weight map keyed stockKey(design, cutSize) — panelWeight's input (CR-309). */
export function cachedCutWeights(): Map<string, number | null> | null {
  return stockCache.cached()?.weights ?? null;
}
export function invalidateCutStock(): void {
  stockCache.invalidate();
}
type CutStockResult = { ok: boolean; stock: Map<string, number>; weights: Map<string, number | null>; rows: CutStockRow[]; error?: string };
export function listCutStock(): Promise<CutStockResult> {
  return stockCache.load();
}

async function fetchCutStock(): Promise<CutStockResult> {
  const res = await listAll("CutPieceStock");
  if (!res.ok) return { ok: false, stock: new Map(), weights: new Map(), rows: [], error: res.error };
  const stock = new Map<string, number>();
  const weights = new Map<string, number | null>();
  const rows: CutStockRow[] = [];
  for (const r of res.rows || []) {
    const key = `${str(r.design)}|${str(r.cut_piece_size)}`;
    const w = r.weight_kg == null || r.weight_kg === "" ? null : Number(r.weight_kg);
    const weightKg = w != null && isFinite(w) ? w : null;
    stock.set(key, num(r.qty));
    weights.set(key, weightKg);
    rows.push({
      id: String(r.ROWID),
      designId: str(r.design),
      cutSizeId: str(r.cut_piece_size),
      qty: num(r.qty),
      weightKg,
      modifiedTime: str(r.MODIFIEDTIME),
    });
  }
  return { ok: true, stock, weights, rows };
}

/* ---- cut-stock ledger (CR-307) — dated movements behind the on-hand figure ---- */
export type CutEntryKind = "receipt" | "adjustment" | "order_ready" | "order_dispatch" | "sample";
export const CUT_ENTRY_KIND_LABEL: Record<CutEntryKind, string> = {
  receipt: "Stock added",
  adjustment: "Adjustment",
  order_ready: "Cutting output",
  order_dispatch: "Dispatched",
  sample: "Sample supplied", // CR-316
};
export interface CutStockEntryRow {
  id: string;
  designId: string;
  cutSizeId: string;
  qty: number; // signed
  entryDate: string; // yyyy-MM-dd
  kind: CutEntryKind;
  reason: string;
  note: string;
  refTable: string;
  refRowid: string;
  performedBy: string;
  createdTime: string;
}
/** Every ledger row, newest first. Not cached — read on the pages that show history. */
export async function listCutStockEntries(): Promise<{ ok: boolean; rows: CutStockEntryRow[]; error?: string }> {
  const res = await listAll("CutStockEntry", { order: "ROWID desc" });
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  const rows = (res.rows || []).map((r) => ({
    id: String(r.ROWID),
    designId: str(r.design),
    cutSizeId: str(r.cut_piece_size),
    qty: num(r.qty),
    entryDate: str(r.entry_date).slice(0, 10),
    kind: (str(r.kind) || "receipt") as CutEntryKind,
    reason: str(r.reason),
    note: str(r.note),
    refTable: str(r.ref_table),
    refRowid: str(r.ref_rowid),
    performedBy: str(r.performed_by),
    createdTime: str(r.CREATEDTIME),
  }));
  return { ok: true, rows };
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

export interface PanelOrderLineInput {
  panel: string; // Panel ROWID
  qty: number;
  mdf?: string; // Mdf ROWID (CR-309)
}

export interface PanelOrderInput {
  customer: string; // Customer ROWID
  salesperson: string;
  order_date: string; // yyyy-MM-dd
  /** Source record (CR-286) — set by "Request Panels" from an SO / Quote; create only, shown as the Source column. */
  sales_order?: string;
  quote?: string;
  lines: PanelOrderLineInput[];
}

/** Form prefill for edit / clone (CR-302). */
export function panelOrderToInput(o: PanelOrderRow): PanelOrderInput {
  return {
    customer: o.customerId,
    salesperson: o.salesperson,
    order_date: o.orderDate,
    sales_order: o.salesOrderId || undefined,
    quote: o.quoteId || undefined,
    lines: o.lines.map((l) => ({ panel: l.panelId, qty: l.qty, mdf: l.mdfId || undefined })),
  };
}

/** Create (no rowid — born New, PNL number assigned) or update header + lines in one call. */
export function savePanelOrder(input: PanelOrderInput, rowid?: string): Promise<OpResult<{ ROWID: string; order_number: string }>> {
  return bust(op<{ ROWID: string; order_number: string }>("panel-order-save", rowid ? { ...input, rowid } : input));
}

/** Persist the manual Available ticks (CR-288) — plain column, generic PATCH. */
export function saveChecklist(rowid: string, checklist: Record<string, boolean>): Promise<OpResult> {
  return bust(update("PanelOrder", rowid, { checklist: JSON.stringify(checklist) }));
}

/** Soft-delete header + lines — New / Received only, reason mandatory (server-enforced). */
export function deletePanelOrder(rowid: string, reason?: string): Promise<OpResult> {
  return bust(op(`panel-order-delete/${rowid}`, { reason }));
}

/** Stage flip via the status machine (adds stock on Ready, deducts on Dispatched). */
export function setPanelOrderStatus(rowid: string, status: PanelOrderStatus) {
  return bust(op<{ ROWID: string; status: string }>(`panel-order-status/${rowid}`, { status }));
}

/** CR-312: set the order's booking — absolute pcs per stockKey (lower = release, 0 = none). Server checks need + free. */
export function allocatePanelOrder(rowid: string, allocation: Allocation) {
  return bust(op<{ ROWID: string; allocation: Allocation }>(`panel-order-allocate/${rowid}`, { allocation }));
}

/** CR-313: mark one production checkpoint; the server stamps who / when. */
export function setCheckpoint(rowid: string, key: CheckpointKey, status: string) {
  return bust(op<{ ROWID: string; checkpoints: Checkpoints }>(`panel-order-checkpoint/${rowid}`, { key, status }));
}

/* ---- cut-piece items + stock movements (CR-306…308) ---- */
export interface CutStockEntryLine {
  design: string;
  cut_piece_size: string;
  qty: number; // receipt: > 0; adjustment: signed, ≠ 0
  note?: string;
}
/** One dated bulk movement: Add Stock (receipt) or Adjust Stock (adjustment, reason required). */
export function postCutStockEntry(input: { entry_date: string; kind: "receipt" | "adjustment"; reason?: string; note?: string; lines: CutStockEntryLine[] }) {
  return bust(op<{ lines: number }>("cut-stock-entry", input));
}
/** Define / re-weigh a cut-piece item. A blank cut_piece_size = the item's full size. */
export function saveCutPiece(input: { design: string; cut_piece_size?: string; weight_kg?: number | null }) {
  invalidatePanels(); // a full-size CutPieceSize may have been minted
  return bust(op<{ ROWID: string; cut_piece_size: string }>("cut-piece-save", input));
}
/** Remove a cut-piece item (server: qty must be 0, no panel uses it). */
export function deleteCutPiece(design: string, cut_piece_size: string, reason?: string) {
  return bust(op("cut-piece-delete", { design, cut_piece_size, reason }));
}
