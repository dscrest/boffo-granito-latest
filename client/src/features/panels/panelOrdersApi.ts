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
import { listDesigns, type DesignImage } from "@/features/masters/designsApi";
import type { Allocation, CheckpointKey, Checkpoints, LoadIn, LoadLineIn, Material, Shortage } from "./panelOrderNeeds";
import { deriveWarehouseStock, type WarehouseIn, type WhCell, type WhMoveIn } from "@/lib/warehouseStock";

export {
  allocatedByKey,
  CHECKPOINT_KEYS,
  CHECKPOINT_LABEL,
  CHECKPOINT_STATUSES,
  checkpointStatus,
  demandByKey,
  lineMaterials,
  lineWeightSplit,
  loadingStatus,
  LOADING_STATUSES,
  loadProgress,
  MATERIAL_LABEL,
  PANEL_ORDER_OPEN,
  panelWeightSplit,
  pendingNeedLines,
  pendingText,
  readiness,
  requirementsFor,
  shortagesFor,
  stockKey,
  type Allocation,
  type CheckpointKey,
  type CheckpointMark,
  type Checkpoints,
  type DemandRow,
  type LoadIn,
  type LoadLineIn,
  type LoadingStatus,
  type Material,
  type NeedLine,
  type NeedOpts,
  type ProgressRow,
  type Readiness,
  type Requirement,
  type Shortage,
} from "./panelOrderNeeds";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export const PANEL_ORDER_STATUSES = ["NewRequest", "Received", "InCutting", "Ready", "Dispatched"] as const;
export type PanelOrderStatus = (typeof PANEL_ORDER_STATUSES)[number];

/** Mirrors the server PANEL_ORDER_TRANSITIONS (forward-only). CR-347: Dispatched is never a
    button — the last load (/panel-load-save) flips it. */
export const PANEL_ORDER_TRANSITIONS: Record<PanelOrderStatus, PanelOrderStatus[]> = {
  NewRequest: ["Received"],
  Received: ["InCutting"],
  InCutting: ["Ready"],
  Ready: [],
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
  panelId: string; // "" = a loose cut-piece line (CR-346)
  panelCode: string; // "Cut piece" on a cut-piece line
  qty: number; // panels of this type / pieces
  mdfId: string; // Mdf ROWID the panel is mounted on (CR-309); "" = not picked
  /** CR-346: loose cut-piece line — design + cut size. */
  designId: string;
  cutSizeId: string;
  designName: string;
  cutSizeName: string;
}

/** CR-347: one vehicle trip for this order (PanelLoad + its lines). */
export interface LoadRow extends LoadIn {
  loadNumber: string; // LD/FY/NNN — shared by every order on the trip
  date: string; // yyyy-MM-dd
  vehicle: string;
  driverName: string; // CR-351
  driverMobile: string;
  note: string;
  photos: DesignImage[];
  by: string;
  createdTime: string;
}

const MATERIALS: readonly Material[] = ["Panel", "Mdf", "Item"];
/** Group PanelLoad + PanelLoadLine rows per order (col = panel_order | sample_order). */
export function parseLoads(loadRows: Record<string, unknown>[], lineRows: Record<string, unknown>[], col: "panel_order" | "sample_order"): Map<string, LoadRow[]> {
  const linesByLoad = new Map<string, LoadLineIn[]>();
  for (const l of lineRows) {
    const key = str(l.panel_load);
    const material = (MATERIALS as readonly string[]).includes(str(l.material)) ? (str(l.material) as Material) : "Item";
    const w = l.weight_kg == null || l.weight_kg === "" ? null : Number(l.weight_kg);
    const row: LoadLineIn = { lineId: str(l.order_line), material, qty: num(l.qty), weightKg: w != null && isFinite(w) ? w : null };
    linesByLoad.set(key, [...(linesByLoad.get(key) ?? []), row]);
  }
  const out = new Map<string, LoadRow[]>();
  for (const r of loadRows) {
    const orderId = str(r[col]);
    if (!orderId) continue;
    let photos: DesignImage[] = [];
    try {
      const v = JSON.parse(str(r.photos) || "[]");
      if (Array.isArray(v)) photos = v.filter((p) => p && p.id).map((p) => ({ id: String(p.id), name: String(p.name || "") }));
    } catch {
      photos = [];
    }
    const row: LoadRow = {
      id: String(r.ROWID),
      loadNumber: str(r.order_number),
      date: str(r.load_date).slice(0, 10),
      vehicle: str(r.vehicle_number),
      driverName: str(r.driver_name),
      driverMobile: str(r.driver_mobile),
      note: str(r.note),
      photos,
      by: str(r.performed_by),
      createdTime: str(r.CREATEDTIME),
      lines: linesByLoad.get(String(r.ROWID)) ?? [],
    };
    out.set(orderId, [...(out.get(orderId) ?? []), row]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdTime < b.createdTime ? -1 : 1));
  return out;
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
  /** CR-347: vehicle trips recorded against this order, oldest first. */
  loads: LoadRow[];
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
  const [orders, lines, customers, panelsRes, sos, quotes, designsRes, loads, loadLines] = await Promise.all([
    listAll("PanelOrder", { order: "ROWID desc" }),
    listAll("PanelOrderLine"),
    listAll("Customer", { columns: ["name", "code"] }),
    listPanels(), // cached — panel codes + cut-size names
    listAll("SalesOrder", { columns: ["order_number"] }), // source numbers (CR-286)
    listAll("Quote", { columns: ["quote_number"] }),
    listDesigns(), // cached — cut-piece line names (CR-346)
    listAll("PanelLoad"), // CR-347
    listAll("PanelLoadLine"),
  ]);
  if (!orders.ok) return { ok: false, orders: [], error: orders.error };
  if (!lines.ok) return { ok: false, orders: [], error: lines.error };
  const cust = new Map((customers.rows || []).map((c) => [String(c.ROWID), { name: str(c.name), code: str(c.code) }]));
  const soNo = new Map((sos.rows || []).map((r) => [String(r.ROWID), str(r.order_number)]));
  const quoteNo = new Map((quotes.rows || []).map((r) => [String(r.ROWID), str(r.quote_number)]));
  const panelCode = new Map((panelsRes.ok ? panelsRes.panels : []).map((p) => [p.id, p.panelCode]));
  const cutName = new Map((panelsRes.ok ? panelsRes.cutSizes : []).map((c) => [c.id, c.label]));
  const design = new Map((designsRes.ok ? designsRes.designs : []).map((d) => [d.id, d]));
  const loadsByOrder = parseLoads(loads.rows || [], loadLines.rows || [], "panel_order");
  const linesByOrder = new Map<string, PanelOrderLineRow[]>();
  for (const l of lines.rows || []) {
    const key = str(l.panel_order);
    const d = design.get(str(l.design));
    const row: PanelOrderLineRow = {
      id: String(l.ROWID),
      panelId: str(l.panel),
      panelCode: str(l.panel) ? panelCode.get(str(l.panel)) || "—" : "Cut piece",
      qty: num(l.qty),
      mdfId: str(l.mdf),
      designId: str(l.design),
      cutSizeId: str(l.cut_piece_size),
      designName: d?.uniqueName || d?.designName || "",
      cutSizeName: cutName.get(str(l.cut_piece_size)) || "",
    };
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
      loads: loadsByOrder.get(id) ?? [],
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
export type CutEntryKind = "receipt" | "adjustment" | "order_ready" | "order_dispatch" | "order_load" | "sample" | "transfer";
export const CUT_ENTRY_KIND_LABEL: Record<CutEntryKind, string> = {
  receipt: "Stock added",
  adjustment: "Adjustment",
  order_ready: "Cutting output",
  order_dispatch: "Dispatched",
  order_load: "Loaded", // CR-347: left with a vehicle trip (ref = PanelLoad)
  sample: "Sample supplied", // CR-316
  transfer: "Transferred", // CR-330: one leg of a Transfer Order (doc_number = TRF code)
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
  warehouseId: string; // CR-329: "" = the primary
  docNumber: string; // CR-330: TRF code on transfer legs
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
    warehouseId: str(r.warehouse),
    docNumber: str(r.doc_number),
  }));
  return { ok: true, rows };
}

/** CR-329: cut-piece stock per (design|cutSize, warehouse). The ledger rows carry
    the warehouse; whatever on-hand predates the ledger is null supply (→ primary);
    bookings (allocatedByKey) spread as committed. Pure — callers pass what they loaded. */
export function cutWarehouseCells(
  warehouses: WarehouseIn[],
  entries: CutStockEntryRow[],
  stockRows: CutStockRow[],
  booked: Map<string, number> = new Map(),
): WhCell[] {
  const moves: WhMoveIn[] = entries.map((e) => ({ key: `${e.designId}|${e.cutSizeId}`, warehouse: e.warehouseId || null, qty: e.qty }));
  const ledger = new Map<string, number>();
  for (const m of moves) ledger.set(m.key, (ledger.get(m.key) ?? 0) + m.qty);
  for (const r of stockRows) {
    const key = `${r.designId}|${r.cutSizeId}`;
    const residual = r.qty - (ledger.get(key) ?? 0);
    if (residual) moves.push({ key, warehouse: null, qty: residual });
  }
  const claims = [...booked].map(([key, qty]) => ({ key, warehouse: null, qty }));
  return deriveWarehouseStock(warehouses, moves, claims);
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
  panel?: string; // Panel ROWID — blank on a cut-piece line (CR-346)
  qty: number;
  mdf?: string; // Mdf ROWID (CR-309)
  /** CR-346: loose cut-piece line. */
  design?: string;
  cut_piece_size?: string;
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
    lines: o.lines.map((l) =>
      l.panelId ? { panel: l.panelId, qty: l.qty, mdf: l.mdfId || undefined } : { design: l.designId, cut_piece_size: l.cutSizeId, qty: l.qty },
    ),
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
  qty: number; // receipt / transfer: > 0; adjustment: signed, ≠ 0
  note?: string;
}
/** One dated bulk movement: Add Stock (receipt), Adjust Stock (adjustment, reason required)
    or a Transfer Order between warehouses (transfer: from/to + reason, CR-330). */
export function postCutStockEntry(input: {
  entry_date: string;
  kind: "receipt" | "adjustment" | "transfer";
  reason?: string;
  note?: string;
  /** CR-329: where the pieces were counted (receipt / adjustment); blank → primary. */
  warehouse?: string;
  from_warehouse?: string;
  to_warehouse?: string;
  lines: CutStockEntryLine[];
}) {
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
