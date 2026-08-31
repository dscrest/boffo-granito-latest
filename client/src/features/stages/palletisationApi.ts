/* ============================================================
   Phase 4 saga callers — close-pallet / load-container / dispatch.

   Thin typed wrappers over the data-ops business routes (lib/dataOps
   `op`). Each saga validates + writes server-side and records to
   OperationLog; callers branch on `ok`. The fit-suggester lives in
   masters/containersApi.ts (it's read-only and container-centric).
   ============================================================ */
import { list, listAll, op, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { invalidateOrders } from "@/features/orders/ordersApi";
import { invalidateContainers } from "@/features/masters/containersApi";
import { invalidatePalletOrders } from "@/features/masters/palletsApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

/* ---- palletizable work list (produced not yet fully palletized) ---- */
export interface PalletizableItem {
  orderItemId: string; // OrderItem ROWID → close-pallet line.order_item
  designId: string; // Design ROWID
  designLabel: string;
  designName: string; // raw Design.design_name — the key for stock lookups (stock.ts)
  palletId: string; // OrderItem.pallet — pallet chosen at SO creation ("" when unset)
  sizeId: string; // Size ROWID via Design.size ("" when unset)
  sizeCode: string; // Size.code e.g. "300x300" (for per-line pallet-size matching)
  ordered: number; // ordered_qty_boxes (confirmed demand)
  available: number; // produced − palletized (boxes free to palletize NOW)
  produced: number;
  palletized: number;
  // ponytail: toProduce/inProduction below are UNUSED by UI (2026-08-12) and count
  // SO-confirm auto-queued rows — if you resurrect them, exclude untouched "so-…" plans
  // (see lib/stock.ts inProduction rule) or use designStock instead.
  toProduce: number; // ordered − produced − in-flight requests (boxes still to request → production)
  inProduction: number; // this design's boxes currently in production (PendingApproval/Approved) across ALL orders — display only
  inProductionOrders: { salesOrderId: string; soLabel: string; customer: string; qty: number }[]; // per-SO breakdown of inProduction
}
export interface PalletizableOrder {
  salesOrderId: string; // SalesOrder ROWID → close-pallet sales_order
  label: string; // "PO-123 · Acme"
  portOfDischarge: string; // destination for container matching ("" when unset)
  items: PalletizableItem[];
}

/**
 * OrderItems grouped by their SalesOrder.
 *
 * Default (no opts): only items with available > 0 (produced − palletized) —
 * the global "Pallet Packing" work list. With `includeOrderId`, that one order
 * is returned in full (every line item, even available ≤ 0 and regardless of
 * stage) so the form can scope to a confirmed Sales Order and surface lines
 * that still need production. In preset mode ONLY that order is returned.
 */
export function listPalletizable(opts?: { includeOrderId?: string }): Promise<{
  ok: boolean;
  orders: PalletizableOrder[];
  error?: string;
}> {
  // Preset mode is parameterized — bypass the cache; the global work
  // list (no opts) is cached + deduped like every other list.
  if (opts?.includeOrderId) return fetchPalletizable(opts);
  return palletizableCache.load();
}

const palletizableCache = createListCache(() => fetchPalletizable());

async function fetchPalletizable(opts?: { includeOrderId?: string }): Promise<{
  ok: boolean;
  orders: PalletizableOrder[];
  error?: string;
}> {
  const [items, sos, customers, designs, sizes, prod] = await Promise.all([
    listAll("OrderItem"),
    listAll("SalesOrder", { order: "ROWID desc", columns: ["po_number", "order_number", "customer", "port_of_discharge"] }),
    listAll("Customer", { columns: ["name"] }),
    listAll("Design", { columns: ["design_name", "unique_name", "size"] }),
    listAll("Size", { columns: ["code"] }),
    // Outstanding production requests (not yet produced) so "remaining to
    // produce" doesn't offer boxes already awaiting approval/output.
    listAll("ProductionLog", { columns: ["order_item", "qty_requested", "status"] }),
  ]);
  if (!items.ok || !sos.ok) return { ok: false, orders: [], error: items.error || sos.error };

  const inFlight = new Map<string, number>();
  (prod.rows || []).forEach((p) => {
    const s = str(p.status);
    if (s !== "PendingApproval" && s !== "Approved") return;
    const k = str(p.order_item);
    if (k) inFlight.set(k, (inFlight.get(k) || 0) + num(p.qty_requested));
  });

  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const custName = new Map<string, string>();
  (customers.rows || []).forEach((c) => custName.set(String(c.ROWID), str(c.name)));
  const designName = new Map<string, string>();
  const uniqueName = new Map<string, string>();
  const designSize = new Map<string, string>();
  (designs.rows || []).forEach((d) => {
    designName.set(String(d.ROWID), str(d.design_name));
    uniqueName.set(String(d.ROWID), str(d.unique_name));
    designSize.set(String(d.ROWID), str(d.size));
  });
  const sizeCodeById = new Map<string, string>();
  (sizes.rows || []).forEach((s) => sizeCodeById.set(String(s.ROWID), str(s.code)));

  // Design-wide "in production": which orders have this design in production
  // (PendingApproval/Approved) and how much, so a line can surface that a design
  // is already running elsewhere. Keyed by design → salesOrder → qty.
  const oiToDesignSo = new Map<string, { design: string; so: string }>();
  (items.rows || []).forEach((it) =>
    oiToDesignSo.set(String(it.ROWID), { design: str(it.design), so: str(it.sales_order) }),
  );
  const inProdByDesign = new Map<string, Map<string, number>>();
  (prod.rows || []).forEach((p) => {
    const s = str(p.status);
    if (s !== "PendingApproval" && s !== "Approved") return;
    const oi = oiToDesignSo.get(str(p.order_item));
    if (!oi || !oi.design) return;
    let bySo = inProdByDesign.get(oi.design);
    if (!bySo) inProdByDesign.set(oi.design, (bySo = new Map()));
    bySo.set(oi.so, (bySo.get(oi.so) || 0) + num(p.qty_requested));
  });

  const preset = opts?.includeOrderId;
  const byOrder = new Map<string, PalletizableOrder>();
  for (const it of items.rows || []) {
    const soId = str(it.sales_order);
    if (!soId) continue;
    const isPreset = preset === soId;
    const ordered = num(it.ordered_qty_boxes);
    const produced = num(it.produced_qty_boxes);
    const palletized = num(it.palletized_qty_boxes);
    const available = produced - palletized;
    // Global list: skip lines with nothing ready to palletize. Preset order:
    // keep every line so the form can show "needs production" rows too.
    if (available <= 0 && !isPreset) continue;
    if (preset && !isPreset) continue; // preset mode returns only the chosen order
    if (!byOrder.has(soId)) {
      const so = soById.get(soId);
      const po = so ? str(so.order_number) || str(so.po_number) : soId;
      const party = so ? custName.get(str(so.customer)) || "" : "";
      byOrder.set(soId, {
        salesOrderId: soId,
        label: party ? `${po} · ${party}` : po,
        portOfDischarge: so ? str(so.port_of_discharge) : "",
        items: [],
      });
    }
    const designId = str(it.design);
    const sizeId = designSize.get(designId) || "";
    const inProductionOrders = [...(inProdByDesign.get(designId)?.entries() || [])].map(([soId2, qty]) => {
      const so = soById.get(soId2);
      return {
        salesOrderId: soId2,
        soLabel: so ? str(so.order_number) || str(so.po_number) || soId2 : soId2,
        customer: so ? custName.get(str(so.customer)) || "" : "",
        qty,
      };
    });
    byOrder.get(soId)!.items.push({
      orderItemId: String(it.ROWID),
      designId,
      designLabel: uniqueName.get(designId) || designName.get(designId) || designId,
      designName: designName.get(designId) || "",
      palletId: str(it.pallet),
      sizeId,
      sizeCode: sizeCodeById.get(sizeId) || "",
      ordered,
      available,
      produced,
      palletized,
      toProduce: Math.max(0, ordered - produced - (inFlight.get(String(it.ROWID)) || 0)),
      inProduction: inProductionOrders.reduce((s, o) => s + o.qty, 0),
      inProductionOrders,
    });
  }

  return { ok: true, orders: [...byOrder.values()].filter((o) => o.items.length > 0) };
}

/* ---- loadable batches (closed PalletisedBatches not yet in a container) ---- */
export interface LoadableBatch {
  batchId: string; // PalletisedBatch ROWID → load-container batches[]
  label: string; // design name (fallback ROWID)
  boxes: number; // boxes_packed
}

/** Closed pallet batches with no ContainerLoading row — ready to load.
    Cached + deduped; sagas below invalidate. */
export function listLoadableBatches(): Promise<{
  ok: boolean;
  batches: LoadableBatch[];
  error?: string;
}> {
  return loadableCache.load();
}

const loadableCache = createListCache(fetchLoadableBatches);

async function fetchLoadableBatches(): Promise<{
  ok: boolean;
  batches: LoadableBatch[];
  error?: string;
}> {
  const [batches, loadings, designs] = await Promise.all([
    listAll("PalletisedBatch", { order: "ROWID desc" }),
    listAll("ContainerLoading", { columns: ["batch"] }),
    listAll("Design", { columns: ["design_name"] }),
  ]);
  if (!batches.ok) return { ok: false, batches: [], error: batches.error };

  const loadedSet = new Set((loadings.rows || []).map((r) => str(r.batch)));
  const designName = new Map<string, string>();
  (designs.rows || []).forEach((d) => designName.set(String(d.ROWID), str(d.design_name)));

  const rows: LoadableBatch[] = (batches.rows || [])
    .filter((b) => str(b.status) === "closed" && !loadedSet.has(String(b.ROWID)))
    .map((b) => {
      const id = String(b.ROWID);
      return { batchId: id, label: designName.get(str(b.design)) || `Batch #${id}`, boxes: num(b.boxes_packed) };
    });

  return { ok: true, batches: rows };
}

/* ---- all palletised batches (the /packing "Palletization" list) ----
   A palletised batch is the simple indicator that boxes are on a pallet in the
   warehouse; loading may follow immediately or months later. Status is derived:
   "Loaded" once a ContainerLoading row references the batch, else "Palletised". */
export interface PalletisationRow {
  id: string; // PalletisedBatch ROWID
  salesOrderId: string;
  soLabel: string; // "SO/…/NNN · Customer"
  design: string;
  pallet: string;
  boxes: number;
  date: string; // delivery_date (palletization date)
  loaded: boolean; // has a ContainerLoading row → moved on to loading
  isMixed: boolean; // combined sub-pallet leftovers across items (design = null)
  createdTime: string;
  modifiedTime: string;
}

/** Every palletised batch, newest first. Cached + deduped; sagas invalidate. */
export function listPalletisations(): Promise<{
  ok: boolean;
  rows: PalletisationRow[];
  error?: string;
}> {
  return palletisationsCache.load();
}

const palletisationsCache = createListCache(fetchPalletisations);

async function fetchPalletisations(): Promise<{
  ok: boolean;
  rows: PalletisationRow[];
  error?: string;
}> {
  const [batches, sos, customers, designs, pallets, loadings] = await Promise.all([
    listAll("PalletisedBatch", { order: "ROWID desc" }),
    listAll("SalesOrder", { columns: ["po_number", "order_number", "customer"] }),
    listAll("Customer", { columns: ["name"] }),
    listAll("Design", { columns: ["design_name", "unique_name"] }),
    listAll("Pallet", { columns: ["name"] }),
    listAll("ContainerLoading", { columns: ["batch"] }),
  ]);
  if (!batches.ok) return { ok: false, rows: [], error: batches.error };

  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const custName = new Map<string, string>();
  (customers.rows || []).forEach((c) => custName.set(String(c.ROWID), str(c.name)));
  const designName = new Map<string, string>();
  (designs.rows || []).forEach((d) => designName.set(String(d.ROWID), str(d.unique_name) || str(d.design_name)));
  const palletName = new Map<string, string>();
  (pallets.rows || []).forEach((p) => palletName.set(String(p.ROWID), str(p.name)));
  const loadedSet = new Set((loadings.rows || []).map((r) => str(r.batch)));

  const rows: PalletisationRow[] = (batches.rows || []).map((b) => {
    const soId = str(b.sales_order);
    const so = soById.get(soId);
    const po = so ? str(so.order_number) || str(so.po_number) : soId;
    const party = so ? custName.get(str(so.customer)) || "" : "";
    const isMixed = b.is_mixed === true || str(b.is_mixed) === "true";
    return {
      id: String(b.ROWID),
      salesOrderId: soId,
      soLabel: party ? `${po} · ${party}` : po,
      design: isMixed ? "Mixed pallet" : designName.get(str(b.design)) || "—",
      pallet: palletName.get(str(b.pallet)) || "—",
      boxes: num(b.boxes_packed),
      date: str(b.delivery_date) || "—",
      loaded: loadedSet.has(String(b.ROWID)),
      isMixed,
      createdTime: str(b.CREATEDTIME),
      modifiedTime: str(b.MODIFIEDTIME),
    };
  });
  return { ok: true, rows };
}

/* ---- close-pallet: produced → palletized ---- */
/* ---- palletisation batches for one Sales Order (SO detail "Palletization" tab) ---- */
export interface OrderBatchRow {
  batchId: string;
  design: string;
  pallet: string;
  boxes: number;
  date: string; // palletization date (delivery_date)
  status: string;
  batchNumber: string; // production batch (blank on a mixed pallet — see lines)
}

/** Palletised batches committed against one Sales Order — powers the SO
    detail Palletization tab (parallel to the Production tab). */
export async function listOrderBatches(
  salesOrderId: string,
): Promise<{ ok: boolean; rows: OrderBatchRow[]; error?: string }> {
  const [batches, designs, pallets] = await Promise.all([
    listAll("PalletisedBatch", { order: "ROWID desc" }),
    listAll("Design", { columns: ["design_name"] }),
    listAll("Pallet", { columns: ["name"] }),
  ]);
  if (!batches.ok) return { ok: false, rows: [], error: batches.error };
  const designName = new Map<string, string>();
  (designs.rows || []).forEach((d) => designName.set(String(d.ROWID), str(d.design_name)));
  const palletName = new Map<string, string>();
  (pallets.rows || []).forEach((p) => palletName.set(String(p.ROWID), str(p.name)));
  const rows: OrderBatchRow[] = (batches.rows || [])
    .filter((b) => str(b.sales_order) === String(salesOrderId))
    .map((b) => ({
      batchId: String(b.ROWID),
      design: designName.get(str(b.design)) || "—",
      pallet: palletName.get(str(b.pallet)) || "—",
      boxes: num(b.boxes_packed),
      date: str(b.delivery_date) || "—",
      status: str(b.status) || "—",
      batchNumber: str(b.batch_number),
    }));
  return { ok: true, rows };
}

export interface ClosePalletLine {
  order_item: string; // OrderItem ROWID
  boxes: number;
  batch_number?: string; // per-line batch (falls back to header); mixed pallets keep each line's own
}
export interface ClosePalletInput {
  sales_order: string; // SalesOrder ROWID
  pallet: string; // Pallet ROWID
  design?: string; // Design ROWID (optional)
  delivery_date?: string; // "" omitted server-side
  remarks?: string;
  performed_by?: string;
  batch_number?: string; // single-batch pallet: header batch for the slip
  lines: ClosePalletLine[];
}

/* Sagas move boxes across stage counters, so every cache built on
   OrderItem / PalletisedBatch / Container is stale after one runs. */
function bustStageCaches(): void {
  palletizableCache.invalidate();
  loadableCache.invalidate();
  palletisationsCache.invalidate();
  invalidateOrders();
  invalidateContainers();
  // close-pallet inserts a PalletisedBatch — the pallet detail's order list is stale.
  invalidatePalletOrders();
}
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    bustStageCaches();
    return r;
  });
}

export function closePallet(input: ClosePalletInput) {
  return bust(op<{ ROWID: string; boxes_packed: number; lines: number }>("close-pallet", input));
}

/* ---- mixed pallet: full pallets + leftover-remainder combining ----
   An item's boxes ÷ its pallet capacity gives whole pallets + a leftover that
   doesn't fill a pallet. Leftovers across items auto-combine into a REAL mixed
   pallet (is_mixed), each line keeping its own batch. */
export interface LeftoverItem {
  orderItemId: string;
  salesOrderId: string;
  designId?: string;
  batchNumber?: string;
  qty: number; // boxes to palletise for this item
  boxesPerPallet: number; // this item's pallet capacity
}
export interface PalletSplit {
  item: LeftoverItem;
  fullPallets: number;
  remainder: number; // boxes that don't fill a whole pallet (the "mix")
}

/** Split each item into whole pallets + a leftover remainder. Pure. */
export function splitFullAndRemainder(items: LeftoverItem[]): PalletSplit[] {
  return items.map((it) => {
    const per = it.boxesPerPallet > 0 ? it.boxesPerPallet : 0;
    const fullPallets = per > 0 ? Math.floor(it.qty / per) : 0;
    const remainder = per > 0 ? it.qty % per : it.qty; // no capacity → all "leftover"
    return { item: it, fullPallets, remainder };
  });
}

export interface MixedPalletLine {
  order_item: string;
  boxes: number;
  batch_number?: string;
}
export interface MixedPallet {
  lines: MixedPalletLine[];
  boxes: number;
}

/** Bin-pack the leftovers into mixed pallet(s) of the given capacity. Pure.
    A leftover larger than capacity spills into the next mixed pallet. */
export function packRemaindersIntoMixed(splits: PalletSplit[], capacity: number): MixedPallet[] {
  const cap = capacity > 0 ? capacity : Infinity;
  const pallets: MixedPallet[] = [];
  let cur: MixedPallet = { lines: [], boxes: 0 };
  for (const s of splits) {
    let left = s.remainder;
    while (left > 0) {
      const take = Math.min(left, cap - cur.boxes);
      cur.lines.push({ order_item: s.item.orderItemId, boxes: take, batch_number: s.item.batchNumber });
      cur.boxes += take;
      left -= take;
      if (cur.boxes >= cap) { pallets.push(cur); cur = { lines: [], boxes: 0 }; }
    }
  }
  if (cur.boxes > 0) pallets.push(cur);
  return pallets;
}

export interface CombineLeftoversInput {
  sales_order: string; // anchor SO for the mixed batch header
  pallet: string; // the mixed pallet type (Pallet ROWID)
  performed_by?: string;
  lines: MixedPalletLine[]; // leftover lines (may span designs/orders)
}

/** Create ONE real mixed pallet (is_mixed) from combined leftover lines. */
export function combineLeftovers(input: CombineLeftoversInput) {
  return bust(op<{ ROWID: string; boxes_packed: number; lines: number }>("combine-leftovers", input));
}

/* ---- production-log: OrderItemEvent + produced bump (+ stage po→prod) ---- */
export interface ProductionLogInput {
  order_item: string; // OrderItem ROWID
  qty_boxes: number;
  production_date?: string;
  shift?: string;
  performed_by?: string;
  note?: string;
}

export function logProduction(input: ProductionLogInput) {
  return bust(op<{ produced_qty_boxes: number; stage: string }>("production-log", input));
}

/* ---- load-container: palletized → loaded ---- */
export interface LoadContainerInput {
  container: string; // Container ROWID
  batches: string[]; // PalletisedBatch ROWIDs (closed, not yet loaded)
  loaded_by?: string;
}

export function loadContainer(input: LoadContainerInput) {
  return bust(
    op<{ container: string; loaded_batches: number; loading_ids: string[] }>("load-container", input),
  );
}

/* ---- dispatch: loaded → dispatched (whole container) ---- */
export function dispatchContainer(containerId: string, performed_by?: string) {
  return bust(op<{ container: string; batches: number }>(`dispatch/${containerId}`, { performed_by }));
}
