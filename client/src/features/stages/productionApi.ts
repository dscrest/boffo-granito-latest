/* ============================================================
   Production requests + lifecycle — typed Data Store wrapper over lib/dataOps.

   A ProductionLog row is request-first: created PendingApproval with
   `qty_requested` (no counter touched), Approved to authorize, then Produced
   (recording actual `qty_boxes` bumps OrderItem.produced + steps po→prod).
   Lines submitted together share a `request_group` so approval acts on the
   whole batch. May be tied to a Sales Order line (order_item set) or standalone
   (design only → independent make-to-stock). Reads hydrate the UI
   ProductionEntry by joining Design / Size / Finish / SalesOrder / Customer /
   OrderItem client-side. Mirrors quotesApi.
   ============================================================ */
import { listAll, list, remove, op, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { invalidateOrders } from "@/features/orders/ordersApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

function mapBy(rows: DSRow[] | undefined, field: string): Map<string, string> {
  const m = new Map<string, string>();
  (rows || []).forEach((r) => m.set(String(r.ROWID), str(r[field])));
  return m;
}

export type ProductionStatus = "PendingApproval" | "Approved" | "Produced" | "Rejected";

export interface ProductionEntry {
  id: string;
  designId: string;
  design: string; // design name
  size: string;
  finish: string;
  /** Lifecycle. Legacy rows backfilled to "Produced". */
  status: ProductionStatus;
  /** Desired boxes from the request. */
  qtyRequested: number;
  /** Shared token for every line of one Send-for-Production submission. */
  requestGroup: string;
  /** Actual boxes produced (0 until output is recorded). */
  qtyBoxes: number;
  productionDate: string;
  shift: string;
  performedBy: string;
  note: string;
  /** SO link — empty on independent production. */
  salesOrderId: string;
  orderItemId: string;
  orderNumber: string;
  poNumber: string;
  customer: string;
  /** True when no Sales Order is linked (make-to-stock). */
  independent: boolean;
  /** Order-line progress (SO-linked only; 0 for independent). */
  ordered: number;
  produced: number;
  createdTime: string;
  modifiedTime: string;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchProductionLogs);

export function subscribeProductionLogs(cb: () => void): () => void {
  return cache.subscribe(cb);
}
export function cachedProductionLogs(): ProductionEntry[] | null {
  return cache.cached()?.entries ?? null;
}
export function invalidateProductionLogs(): void {
  cache.invalidate();
}

/** All production-log entries, hydrated. Cached + deduped. */
export function listProductionLogs(): Promise<{ ok: boolean; entries: ProductionEntry[]; error?: string }> {
  return cache.load();
}

async function fetchProductionLogs(): Promise<{ ok: boolean; entries: ProductionEntry[]; error?: string }> {
  const [logs, designs, sizes, finishes, sos, customers, items] = await Promise.all([
    listAll("ProductionLog", { order: "ROWID desc" }),
    listAll("Design", { columns: ["design_name", "size", "finish"] }),
    list("Size", { limit: 300, columns: ["code"] }),
    list("Finish", { limit: 300, columns: ["name"] }),
    listAll("SalesOrder", { columns: ["order_number", "po_number", "customer"] }),
    listAll("Customer", { columns: ["name"] }),
    listAll("OrderItem", { columns: ["ordered_qty_boxes", "produced_qty_boxes"] }),
  ]);
  if (!logs.ok) return { ok: false, entries: [], error: logs.error };

  const designName = mapBy(designs.rows, "design_name");
  const sizeName = mapBy(sizes.rows, "code");
  const finishName = mapBy(finishes.rows, "name");
  const custName = mapBy(customers.rows, "name");
  const designRow = new Map<string, DSRow>();
  (designs.rows || []).forEach((d) => designRow.set(String(d.ROWID), d));
  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const oiById = new Map<string, DSRow>();
  (items.rows || []).forEach((it) => oiById.set(String(it.ROWID), it));

  const entries: ProductionEntry[] = (logs.rows || []).map((r) => {
    const designId = str(r.design);
    const d = designRow.get(designId);
    const soId = str(r.sales_order);
    const so = soById.get(soId);
    const oi = oiById.get(str(r.order_item));
    return {
      id: String(r.ROWID),
      designId,
      design: designName.get(designId) || designId || "—",
      size: d ? sizeName.get(str(d.size)) || "" : "",
      finish: d ? finishName.get(str(d.finish)) || "" : "",
      status: (str(r.status) || "Produced") as ProductionStatus,
      qtyRequested: num(r.qty_requested),
      requestGroup: str(r.request_group),
      qtyBoxes: num(r.qty_boxes),
      productionDate: str(r.production_date),
      shift: str(r.shift),
      performedBy: str(r.performed_by),
      note: str(r.note),
      salesOrderId: soId,
      orderItemId: str(r.order_item),
      orderNumber: so ? str(so.order_number) : "",
      poNumber: so ? str(so.po_number) : "",
      customer: so ? custName.get(str(so.customer)) || "" : "",
      independent: !soId,
      ordered: oi ? num(oi.ordered_qty_boxes) : 0,
      produced: oi ? num(oi.produced_qty_boxes) : 0,
      createdTime: str(r.CREATEDTIME),
      modifiedTime: str(r.MODIFIEDTIME),
    };
  });

  return { ok: true, entries };
}

/** One line of a production request. */
export interface ProductionRequestLine {
  /** OrderItem ROWID — set for an order job (server derives design + SO). */
  order_item?: string;
  /** Design ROWID — required for an independent line. */
  design?: string;
  qty_requested: number;
}
export interface ProductionRequestInput {
  lines: ProductionRequestLine[];
  production_date?: string;
  shift?: string;
  performed_by?: string;
  note?: string;
}
/** Recorded actual output on an approved line. */
export interface ProductionRecordInput {
  qty_boxes: number;
  production_date?: string;
  shift?: string;
  performed_by?: string;
  note?: string;
}

/* Requests / approvals don't move counters — only production cache is stale.
   Recording output bumps OrderItem.produced, so it invalidates orders too. */
function bustProd<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    invalidateOrders();
    return r;
  });
}

/** Create a production request (PendingApproval). One row per line, shared group. */
export function requestProduction(input: ProductionRequestInput) {
  return bustProd(op<{ request_group: string; lines: number; ids: string[] }>("production-log", input));
}

/** Approve / reject a whole production request group. */
export function setProductionStatus(group: string, status: "Approved" | "Rejected", reason?: string) {
  return bust(op<{ request_group: string; status: string; lines: number }>(`production-status/${encodeURIComponent(group)}`, { status, reason }));
}

/** Record actual output on an approved line → bumps produced, marks Produced. */
export function recordProduction(rowid: string, input: ProductionRecordInput) {
  return bust(op<{ produced_qty_boxes?: number }>(`production-record/${encodeURIComponent(rowid)}`, input));
}

export function deleteProductionLog(rowid: string) {
  return bust(remove("ProductionLog", rowid));
}

/* ---- status presentation (shared across the production surfaces) ---- */
export const PRODUCTION_STATUS_META: Record<ProductionStatus, { label: string; color: string }> = {
  PendingApproval: { label: "Pending Approval", color: "var(--c-amber)" },
  Approved: { label: "Approved", color: "var(--c-blue)" },
  Produced: { label: "Produced", color: "var(--c-green)" },
  Rejected: { label: "Rejected", color: "var(--c-red)" },
};

/** A coloured status chip (JSX-free — callers render the returned parts). */
export function statusChip(status: ProductionStatus): { label: string; color: string } {
  return PRODUCTION_STATUS_META[status] ?? { label: status, color: "var(--muted)" };
}

/* ---- request grouping (shared by Approvals + Production page) ---- */
export interface ProductionRequestGroup {
  group: string; // request_group (route key / source of truth)
  code: string; // human-facing Production ID
  salesOrderId: string;
  orderNumber: string;
  poNumber: string;
  customer: string;
  independent: boolean; // no Sales Order (make-to-stock)
  performedBy: string;
  date: string; // production_date or created
  status: ProductionStatus; // rolled-up status across the group's lines
  designs: string[]; // unique design names in the production
  designSummary: string; // "Design A" or "Design A +2"
  totalRequested: number;
  totalProduced: number;
  ordered: number; // summed order-line target (0 for independent)
  produced: number; // summed order-line progress
  lineCount: number;
  createdTime: string;
  modifiedTime: string;
  entries: ProductionEntry[];
}

/** Group status — approval flips a request batch, but output is recorded per
    line, so a production can hold Approved + Produced lines mid-run. */
function rollupStatus(es: ProductionEntry[]): ProductionStatus {
  if (es.every((e) => e.status === "Rejected")) return "Rejected";
  if (es.some((e) => e.status === "PendingApproval")) return "PendingApproval";
  if (es.some((e) => e.status === "Approved")) return "Approved";
  return "Produced";
}

/** Build one production row from its constituent ProductionLog lines. */
function buildGroup(group: string, es: ProductionEntry[]): ProductionRequestGroup {
  const f = es[0];
  const designs = [...new Set(es.map((e) => e.design).filter(Boolean))];
  // Order progress is a per-order-line snapshot — dedupe by order_item so
  // multiple production batches against the same line don't double-count.
  const oi = new Map<string, { ordered: number; produced: number }>();
  es.forEach((e) => e.orderItemId && oi.set(e.orderItemId, { ordered: e.ordered, produced: e.produced }));
  const created = es.reduce((m, e) => (e.createdTime && (!m || e.createdTime < m) ? e.createdTime : m), "");
  const latest = es.reduce((a, b) => (b.createdTime > a.createdTime ? b : a), f);
  return {
    group,
    code: "",
    salesOrderId: f.salesOrderId,
    orderNumber: f.orderNumber,
    poNumber: f.poNumber,
    customer: f.customer,
    independent: f.independent,
    performedBy: latest.performedBy,
    date: latest.productionDate || latest.createdTime,
    status: rollupStatus(es),
    designs,
    designSummary: designs.length <= 1 ? designs[0] || "—" : `${designs[0]} +${designs.length - 1}`,
    totalRequested: es.reduce((s, e) => s + e.qtyRequested, 0),
    totalProduced: es.reduce((s, e) => s + e.qtyBoxes, 0),
    ordered: [...oi.values()].reduce((s, v) => s + v.ordered, 0),
    produced: [...oi.values()].reduce((s, v) => s + v.produced, 0),
    lineCount: es.length,
    createdTime: created,
    modifiedTime: es.reduce((m, e) => (e.modifiedTime > m ? e.modifiedTime : m), ""),
    entries: es,
  };
}

/** Collapse ProductionLog entries into one row per request batch (request_group).
    Used by Approvals, where a batch is the unit that gets approved/rejected. */
export function groupProductionRequests(entries: ProductionEntry[]): ProductionRequestGroup[] {
  const by = new Map<string, ProductionEntry[]>();
  for (const e of entries) {
    const key = e.requestGroup || `solo-${e.id}`;
    (by.get(key) ?? by.set(key, []).get(key)!).push(e);
  }
  return [...by.entries()].map(([group, es]) => buildGroup(group, es));
}

/** Collapse ProductionLog entries into one row per Sales Order (independent
    make-to-stock lines fall back to their request batch). This is the whole-
    order view shown on the Production list + detail — assigns a short,
    sequential PRD id ordered by when each order's production started.
    ponytail: display-only sequential id (renumbers if a production is deleted);
    a persistent PRD number would need a server-assigned column like SO numbers. */
export function groupProductionByOrder(entries: ProductionEntry[]): ProductionRequestGroup[] {
  const by = new Map<string, ProductionEntry[]>();
  for (const e of entries) {
    const key = e.salesOrderId ? `so-${e.salesOrderId}` : e.requestGroup || `solo-${e.id}`;
    (by.get(key) ?? by.set(key, []).get(key)!).push(e);
  }
  const groups = [...by.entries()].map(([group, es]) => buildGroup(group, es));
  [...groups]
    .sort((a, b) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.group < b.group ? -1 : 1))
    .forEach((g, i) => {
      g.code = `PRD-${String(i + 1).padStart(3, "0")}`;
    });
  return groups;
}
