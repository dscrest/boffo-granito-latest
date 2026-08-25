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
import { listAll, list, op, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { invalidateOrders } from "@/features/orders/ordersApi";
import { invalidateBatchStock } from "@/features/stages/batchStockApi";
import { invalidatePalPlans } from "@/features/stages/palPlansApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

function mapBy(rows: DSRow[] | undefined, field: string): Map<string, string> {
  const m = new Map<string, string>();
  (rows || []).forEach((r) => m.set(String(r.ROWID), str(r[field])));
  return m;
}

export type ProductionStatus = "PendingApproval" | "Approved" | "Produced" | "Rejected";

/** Manual Kanban stage (approval retired 2026-07). Moved by drag, not by recording. */
export type ProductionStage = "New" | "InProduction" | "QC" | "Completed";

/** One dated recorded-output row (entry_type=record), child of a plan line. */
export interface ProductionRecordRow {
  id: string;
  parentId: string;
  design: string;
  size: string;
  finish: string;
  qtyBoxes: number;
  productionDate: string;
  shift: string;
  performedBy: string;
  note: string;
  /** Production batch (B/FY/NNN) this output belongs to. One batch = one shade. */
  batchNumber: string;
  /** Shade of the batch (a property recorded once with the batch). */
  shade: string;
  orderItemId: string;
  createdTime: string;
}

export interface ProductionEntry {
  id: string;
  designId: string;
  design: string; // design name
  size: string;
  finish: string;
  /** Legacy approval status (retired UI). Kept for the commented approval path. */
  status: ProductionStatus;
  /** Manual Kanban stage (denormalised across the group's lines). */
  stage: ProductionStage;
  /** Desired boxes from the request. */
  qtyRequested: number;
  /** Shared token for every line of one Send-for-Production submission. */
  requestGroup: string;
  /** Raw qty_boxes on the plan row (legacy pre-split model; 0 for new lines). */
  qtyBoxes: number;
  /** Actual produced against this line = legacy qtyBoxes + every record child. */
  producedSoFar: number;
  /** Dated output records logged against this plan line. */
  records: ProductionRecordRow[];
  productionDate: string;
  shift: string;
  performedBy: string;
  note: string;
  /** Batch/shade of the latest recorded output on this line (blank if none). */
  batchNumber: string;
  shade: string;
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
  /** Boxes of this line already palletised — a palletised line can't be deleted. */
  palletized: number;
  /** Pallet spec chosen on the SO line — the Record Output default ("" = none). */
  palletId: string;
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
/** Opening-stock rows (entry_type="opening") for batch-tracked items — surfaced
    on the item Production tab alongside recorded output. Not plan lines. */
export function cachedOpeningEntries(): ProductionRecordRow[] {
  return cache.cached()?.openingEntries ?? [];
}
export function invalidateProductionLogs(): void {
  cache.invalidate();
}
/** Duplicate pre-check. With `design` (design NAME) matches only that item's
    batches — the always-blocked case; without it, matches any item (the
    setting-controlled case). Cache-based, so best-effort — the server 409 is
    the source of truth. */
export function batchNumberExists(batch: string, design?: string): boolean {
  const b = batch.trim();
  if (!b) return false;
  const c = cache.cached();
  if (!c) return false;
  return (
    c.openingEntries.some((r) => r.batchNumber === b && (!design || r.design === design)) ||
    c.entries.some((e) => e.records.some((r) => r.batchNumber === b && (!design || r.design === design)))
  );
}

/** Mint (or fetch) a batch record's public share token — keys its scannable QR
    slip page (#/share/batch/<token> → GET /public/batch/<token>). Idempotent. */
export async function shareProductionRecord(rowid: string): Promise<string> {
  const r = await op<string>(`production-record-share/${rowid}`, {});
  if (!r.ok || !r.data) throw new Error(r.error || "Could not create the QR link");
  return r.data;
}

export interface ProductionLogResult {
  ok: boolean;
  entries: ProductionEntry[];
  openingEntries: ProductionRecordRow[];
  error?: string;
}

/** All production-log entries, hydrated. Cached + deduped. */
export function listProductionLogs(): Promise<ProductionLogResult> {
  return cache.load();
}

async function fetchProductionLogs(): Promise<ProductionLogResult> {
  const [logs, designs, sizes, finishes, sos, customers, items] = await Promise.all([
    listAll("ProductionLog", { order: "ROWID desc" }),
    listAll("Design", { columns: ["design_name", "size", "finish"] }),
    list("Size", { limit: 300, columns: ["code"] }),
    list("Finish", { limit: 300, columns: ["name"] }),
    listAll("SalesOrder", { columns: ["order_number", "po_number", "customer"] }),
    listAll("Customer", { columns: ["name"] }),
    listAll("OrderItem", { columns: ["ordered_qty_boxes", "produced_qty_boxes", "palletized_qty_boxes", "pallet"] }),
  ]);
  if (!logs.ok) return { ok: false, entries: [], openingEntries: [], error: logs.error };

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

  const rows = logs.rows || [];
  const hydrateSizeFinish = (designId: string) => {
    const d = designRow.get(designId);
    return { size: d ? sizeName.get(str(d.size)) || "" : "", finish: d ? finishName.get(str(d.finish)) || "" : "" };
  };

  // Record rows (each recorded output) are children of a plan line via parent_log.
  const recordsByParent = new Map<string, ProductionRecordRow[]>();
  for (const r of rows) {
    if (str(r.entry_type) !== "record") continue;
    const designId = str(r.design);
    const { size, finish } = hydrateSizeFinish(designId);
    const parentId = str(r.parent_log);
    const rec: ProductionRecordRow = {
      id: String(r.ROWID),
      parentId,
      design: designName.get(designId) || designId || "—",
      size,
      finish,
      qtyBoxes: num(r.qty_boxes),
      productionDate: str(r.production_date),
      shift: str(r.shift),
      performedBy: str(r.performed_by),
      note: str(r.note),
      batchNumber: str(r.batch_number),
      shade: str(r.shade),
      orderItemId: str(r.order_item),
      createdTime: str(r.CREATEDTIME),
    };
    (recordsByParent.get(parentId) ?? recordsByParent.set(parentId, []).get(parentId)!).push(rec);
  }

  // Opening-stock rows (batch-tracked items) — on-hand, but neither a record
  // child nor a plan line. Surfaced on the item Production tab.
  const openingEntries: ProductionRecordRow[] = [];
  for (const r of rows) {
    if (str(r.entry_type) !== "opening") continue;
    const designId = str(r.design);
    const { size, finish } = hydrateSizeFinish(designId);
    openingEntries.push({
      id: String(r.ROWID),
      parentId: "",
      design: designName.get(designId) || designId || "—",
      size,
      finish,
      qtyBoxes: num(r.qty_boxes),
      productionDate: str(r.production_date),
      shift: str(r.shift),
      performedBy: str(r.performed_by),
      note: str(r.note),
      batchNumber: str(r.batch_number),
      shade: str(r.shade),
      orderItemId: "",
      createdTime: str(r.CREATEDTIME),
    });
  }

  // Plan lines carry qty_requested; produced-so-far is derived from their
  // records. Record + opening rows are excluded (opening is not a plan line).
  const entries: ProductionEntry[] = rows
    .filter((r) => str(r.entry_type) !== "record" && str(r.entry_type) !== "opening")
    .map((r) => {
      const designId = str(r.design);
      const { size, finish } = hydrateSizeFinish(designId);
      const soId = str(r.sales_order);
      const so = soById.get(soId);
      const oi = oiById.get(str(r.order_item));
      const id = String(r.ROWID);
      const records = (recordsByParent.get(id) ?? []).sort((a, b) => (a.createdTime < b.createdTime ? -1 : 1));
      const producedSoFar = num(r.qty_boxes) + records.reduce((s, rec) => s + rec.qtyBoxes, 0);
      const lastRec = records[records.length - 1];
      return {
        id,
        designId,
        design: designName.get(designId) || designId || "—",
        size,
        finish,
        status: (str(r.status) || "Produced") as ProductionStatus,
        stage: (str(r.stage) || "New") as ProductionStage,
        qtyRequested: num(r.qty_requested),
        requestGroup: str(r.request_group),
        qtyBoxes: num(r.qty_boxes),
        producedSoFar,
        records,
        productionDate: str(r.production_date),
        shift: str(r.shift),
        performedBy: str(r.performed_by),
        note: str(r.note),
        batchNumber: lastRec ? lastRec.batchNumber : "",
        shade: lastRec ? lastRec.shade : "",
        salesOrderId: soId,
        orderItemId: str(r.order_item),
        orderNumber: so ? str(so.order_number) : "",
        poNumber: so ? str(so.po_number) : "",
        customer: so ? custName.get(str(so.customer)) || "" : "",
        independent: !soId,
        ordered: oi ? num(oi.ordered_qty_boxes) : 0,
        produced: oi ? num(oi.produced_qty_boxes) : 0,
        palletized: oi ? num(oi.palletized_qty_boxes) : 0,
        palletId: oi ? str(oi.pallet) : "",
        createdTime: str(r.CREATEDTIME),
        modifiedTime: str(r.MODIFIEDTIME),
      };
    });

  return { ok: true, entries, openingEntries };
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
  /** Batch number; blank → server auto-mints B/FY/NNN. One batch = one shade. */
  batch_number?: string;
  shade?: string;
  /** Pallet spec for the queue line this record creates; blank → the SO line's own. */
  pallet?: string;
}
/** One batch row of a multi-batch record (batch-tracked items). */
export interface ProductionRecordLine {
  qty_boxes: number;
  /** Blank → server auto-mints B/FY/NNN per row. */
  batch_number?: string;
  /** Batch mfg date. */
  mfg_date?: string;
  note?: string;
}
export interface ProductionRecordLinesInput {
  rows: ProductionRecordLine[];
  shift?: string;
  performed_by?: string;
  /** Pallet spec for the queue lines these records create; blank → the SO line's own. */
  pallet?: string;
}
/** One batch row of opening stock (batch-tracked items). */
export interface OpeningStockLine {
  qty_boxes: number;
  batch_number?: string;
  mfg_date?: string;
  note?: string;
}

/* Requests / approvals don't move counters — only production cache is stale.
   Recording output bumps OrderItem.produced (and auto-enqueues the boxes into
   palletization server-side), so it invalidates orders + pal plans too. */
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
    invalidatePalPlans();
    return r;
  });
}
/** Recording output / opening also changes derived batch stock. */
function bustStock<T>(p: Promise<T>): Promise<T> {
  return bust(p).then((r) => {
    invalidateBatchStock();
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

/** Record actual output on a plan line → inserts a dated record child, bumps produced. */
export function recordProduction(rowid: string, input: ProductionRecordInput) {
  return bust(op<{ produced_qty_boxes?: number; recorded?: number; batch_number?: string }>(`production-record/${encodeURIComponent(rowid)}`, input));
}

/** Record several batches at once on a plan line (batch-tracked items). Atomic:
    validates Σ qty ≤ remaining, inserts one record child per batch, bumps produced. */
export function recordProductionLines(rowid: string, input: ProductionRecordLinesInput) {
  return bustStock(op<{ recorded: number; rows: number; batch_numbers: string[] }>(`production-record-lines/${encodeURIComponent(rowid)}`, input));
}

/** Set/append a batch-tracked item's opening stock as batch rows. First save is
    open; later changes need admin + reason (enforced server-side). */
export function saveOpeningBatches(designId: string, input: { rows: OpeningStockLine[]; _reason?: string }) {
  return bustStock(op<{ inserted: number }>(`opening-stock/${encodeURIComponent(designId)}`, input));
}

/** Move a production to a Kanban stage (manual) — sets `stage` on its plan lines.
    Optional per-line `notes` (e.g. item-wise QC remarks) + an overall `note` are
    persisted on the stage transition and surface in the Activity feed. */
export function setProductionStage(
  ids: string[],
  stage: ProductionStage,
  extra?: { notes?: Record<string, string>; note?: string },
) {
  return bustProd(op<{ stage: string; lines: number }>("production-stage", { stage, ids, ...extra }));
}

/** Final completion — records the actual boxes produced per line (over- or
    under-production allowed), bumps available stock, and flips every line to
    Completed. `lines` is [{ id, qty_boxes }] per plan line. */
export function completeProduction(input: {
  lines: { id: string; qty_boxes: number }[];
  production_date?: string;
  performed_by?: string;
  note?: string;
}) {
  // bust (not bustProd): completion bumps OrderItem.produced + auto-enqueues.
  return bust(op<{ lines: number }>("production-complete", input));
}

/** Edit a plan line's requested qty / note. */
export function updateProductionLine(rowid: string, input: { qty_requested?: number; note?: string }) {
  return bustProd(op(`production-update/${encodeURIComponent(rowid)}`, input));
}

/** Delete a production line, reversing its effect: a Produced order-linked line
    gives back the OrderItem.produced bump (and steps stage prod→po if it hits
    zero). Blocked server-side when those boxes are already palletised. */
export function deleteProductionLog(rowid: string) {
  return bust(op(`production-delete/${encodeURIComponent(rowid)}`, {}));
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

/* ---- Kanban stages (replace approval statuses in the UI) ---- */
// QC hidden for now (2026-07-17): kept in the type union + META so legacy
// stage:"QC" rows still render/rollup, but dropped from the board/tabs/flow.
export const PRODUCTION_STAGE_ORDER: ProductionStage[] = ["New", "InProduction", "Completed"];
export const PRODUCTION_STAGE_META: Record<ProductionStage, { label: string; color: string }> = {
  New: { label: "New Request", color: "var(--c-amber)" },
  InProduction: { label: "In Production", color: "var(--c-blue)" },
  QC: { label: "QC", color: "var(--c-violet, var(--c-blue))" },
  Completed: { label: "Completed", color: "var(--c-green)" },
};

/** A coloured stage chip (JSX-free — callers render the returned parts). */
export function stageChip(stage: ProductionStage): { label: string; color: string } {
  return PRODUCTION_STAGE_META[stage] ?? { label: stage, color: "var(--muted)" };
}

/** Group stage — denormalised, so all lines share one; legacy mixed groups fall
    back to the least-advanced line (a group is Completed only when all lines are). */
function rollupStage(es: ProductionEntry[]): ProductionStage {
  return es.reduce<ProductionStage>(
    (min, e) =>
      PRODUCTION_STAGE_ORDER.indexOf(e.stage) < PRODUCTION_STAGE_ORDER.indexOf(min) ? e.stage : min,
    "Completed",
  );
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
  status: ProductionStatus; // rolled-up legacy status (retired UI)
  stage: ProductionStage; // manual Kanban stage across the group's lines
  records: ProductionRecordRow[]; // every dated output record in the group
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
    stage: rollupStage(es),
    records: es.flatMap((e) => e.records).sort((a, b) => (a.createdTime < b.createdTime ? -1 : 1)),
    designs,
    designSummary: designs.length <= 1 ? designs[0] || "—" : `${designs[0]} +${designs.length - 1}`,
    totalRequested: es.reduce((s, e) => s + e.qtyRequested, 0),
    totalProduced: es.reduce((s, e) => s + e.producedSoFar, 0),
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

/** The detail-route key for an entry — matches groupProductionByOrder's grouping
    so an item-wise card/row navigates to its production detail. */
export function productionDetailKey(entry: ProductionEntry): string {
  return entry.salesOrderId ? `so-${entry.salesOrderId}` : entry.requestGroup || `solo-${entry.id}`;
}

/** One row per production LINE ITEM (ProductionLog entry), each its own card on
    the item-wise board/grid. Sequential PROD id ordered by creation. */
export function groupProductionByItem(entries: ProductionEntry[]): ProductionRequestGroup[] {
  const groups = entries.map((e) => buildGroup(e.id, [e]));
  [...groups]
    .sort((a, b) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.group < b.group ? -1 : 1))
    .forEach((g, i) => {
      g.code = `PROD-${String(i + 1).padStart(3, "0")}`;
    });
  return groups;
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
