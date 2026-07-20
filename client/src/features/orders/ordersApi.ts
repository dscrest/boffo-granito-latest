/* ============================================================
   Sales Orders — typed Data Store wrapper over lib/dataOps.

   Each UI "order" row = one OrderItem joined with its SalesOrder
   header, Customer, and Design (+ Size/Finish/Brand lookups), to
   match the flat Order shape in client/src/data.ts.
   ============================================================ */
import { list, listAll, remove, update, op, type DSRow, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import type { Order, TaxType } from "@/data";

const toTaxType = (v: unknown): TaxType =>
  v === "TDS" || v === "TCS" ? v : "None";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

// Data Store stores ISO country codes (no emoji). Map the ones we seed.
const ISO_FLAG: Record<string, string> = { PL: "🇵🇱", LT: "🇱🇹", RO: "🇷🇴", HR: "🇭🇷" };

function mapBy(rows: DSRow[] | undefined, field: string): Map<string, string> {
  const m = new Map<string, string>();
  (rows || []).forEach((r) => m.set(String(r.ROWID), str(r[field])));
  return m;
}

/* Stale-while-revalidate cache (lib/cache): repeat visits inside the TTL
   paint instantly without refetching 7 tables; concurrent mounts share
   one fetch. Mutations (here and in palletisation sagas) invalidate. */
const cache = createListCache(fetchOrders);

/** Last fetched orders, or null if never fetched this session. */
export function cachedOrders(): Order[] | null {
  return cache.cached()?.orders ?? null;
}
/** Subscribe to order-cache changes. Returns an unsubscribe fn. */
export function subscribeOrders(cb: () => void): () => void {
  return cache.subscribe(cb);
}
/** Drop the cache so the next listOrders() hits the network. */
export function invalidateOrders(): void {
  cache.invalidate();
}

/** All sales-order line items, hydrated to the UI Order shape. Cached + deduped. */
export function listOrders(): Promise<{ ok: boolean; orders: Order[]; error?: string }> {
  return cache.load();
}

async function fetchOrders(): Promise<{ ok: boolean; orders: Order[]; error?: string }> {
  // listAll pages past ZCQL's 300-row cap; lookups project only the
  // columns this join actually reads (ROWID is always included).
  const [sos, items, customers, designs, sizes, finishes, brands, salesPersons, paymentTerms] = await Promise.all([
    listAll("SalesOrder", { order: "ROWID desc" }),
    listAll("OrderItem"),
    listAll("Customer", { columns: ["name", "code", "country_code"] }),
    listAll("Design", { columns: ["design_name", "unique_name", "size", "finish", "brand"] }),
    list("Size", { limit: 300, columns: ["code"] }),
    list("Finish", { limit: 300, columns: ["name"] }),
    list("Brand", { limit: 300, columns: ["name"] }),
    list("SalesPerson", { limit: 300, columns: ["name"] }),
    list("PaymentTerm", { limit: 300, columns: ["name"] }),
  ]);
  if (!items.ok || !sos.ok) return { ok: false, orders: [], error: items.error || sos.error };

  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const custName = mapBy(customers.rows, "name");
  const custCode = mapBy(customers.rows, "code");
  const custIso = mapBy(customers.rows, "country_code");
  const designName = mapBy(designs.rows, "design_name");
  const designUnique = mapBy(designs.rows, "unique_name");
  const sizeName = mapBy(sizes.rows, "code");
  const finishName = mapBy(finishes.rows, "name");
  const brandName = mapBy(brands.rows, "name");
  const salesPersonName = mapBy(salesPersons.rows, "name");
  const paymentTermName = mapBy(paymentTerms.rows, "name");
  // Design row's own lookup FKs (size/finish/brand) → names.
  const designRow = new Map<string, DSRow>();
  (designs.rows || []).forEach((d) => designRow.set(String(d.ROWID), d));

  const orders: Order[] = (items.rows || []).map((it) => {
    const so = soById.get(str(it.sales_order));
    const custId = so ? str(so.customer) : "";
    const d = designRow.get(str(it.design));
    const iso = custIso.get(custId) || "";
    const rate = num(it.rate);
    const subTotal = num(it.sub_total);
    const sizeStr = d ? sizeName.get(str(d.size)) || "" : "";
    const orderQty = num(it.ordered_qty_boxes);
    // Boxes/pallet by size (mirrors prototype: wide 200x1200 fits 38, else 32).
    const boxesPerPallet = sizeStr === "200x1200" ? 38 : 32;
    // ordered_qty_boxes IS the box count — no unit conversion.
    const totalBoxes = orderQty;
    return {
      id: String(it.ROWID),
      salesOrderId: str(it.sales_order),
      orderNumber: so ? str(so.order_number) : "",
      poNumber: so ? str(so.po_number) : "",
      partyCode: custCode.get(custId) || "",
      party: custName.get(custId) || "",
      country: iso,
      flag: ISO_FLAG[iso] || "",
      // Resolve the design FK to its full unique label (name · size · finish —
      // same as the picker) so the SO reads properly; fall back to the plain
      // name, then "—" for a removed/unresolved FK (bug 16).
      design: designUnique.get(str(it.design)) || designName.get(str(it.design)) || "—",
      size: sizeStr,
      finish: d ? finishName.get(str(d.finish)) || "" : "",
      brand: d ? brandName.get(str(d.brand)) || "" : "",
      orderQty,
      producedQty: num(it.produced_qty_boxes),
      palletizedQty: num(it.palletized_qty_boxes),
      loadedQty: num(it.loaded_qty_boxes),
      boxesPerPallet,
      totalBoxes,
      pallets: Math.ceil(totalBoxes / boxesPerPallet),
      stage: str(it.stage) || "po",
      status: so ? str(so.status) || "Confirmed" : "Confirmed",
      orderDate: so ? str(so.order_date) : "",
      dueDate: str(it.due_date) || "—",
      invoice: null,
      priority: (str(it.priority_level) as Order["priority"]) || "normal",
      daysFromPI: 0,
      rate,
      discount: num(it.discount_pct),
      subTotal,
      description: str(it.description),
      // Header fields the edit form must round-trip (update-so-with-items
      // replaces the header wholesale — anything missing here would wipe).
      paymentTerm: so ? paymentTermName.get(str(so.payment_term)) || "" : "",
      currency: so ? str(so.currency) || "INR" : "INR",
      exchangeRate: so ? num(so.exchange_rate) || 1 : 1,
      remarks: so ? str(so.remarks) : "",
      portOfDischarge: so ? str(so.port_of_discharge) : "",
      salesperson: so ? salesPersonName.get(str(so.sales_person)) || "" : "",
      boxBranding: so ? str(so.box_branding) : "",
      shipmentDate: so ? str(so.shipment_date) : "",
      customerNotes: so ? str(so.customer_notes) : "",
      terms: so ? str(so.terms) : "",
      totalAmount: so ? num(so.total_amount) : 0,
      docDiscount: so ? num(so.discount) : 0,
      adjustment: so ? num(so.adjustment) : 0,
      taxType: so ? toTaxType(so.tax_type) : "None",
      taxPct: so ? num(so.tax_pct) : 0,
      taxAmount: so ? num(so.tax_amount) : 0,
      createdTime: so ? str(so.CREATEDTIME) : "",
      modifiedTime: so ? str(so.MODIFIEDTIME) : "",
      rejectReason: so ? str(so.reject_reason) : "",
    };
  });

  return { ok: true, orders };
}

export interface NewSalesOrderInput {
  customer: string;
  order_number: string;
  po_number: string;
  order_date: string;
  shipment_date: string;
  payment_term: string;
  port_of_discharge: string;
  currency: string;
  exchange_rate?: number;
  remarks: string;
  address: string;
  salesperson: string;
  box_branding: string;
  customer_notes: string;
  terms: string;
  discount: number;
  adjustment: number;
  tax_type: string;
  tax_pct: number;
  lines: { item: string; qty: number; rate: number; discount?: number; description?: string; stage?: string; priority?: string; due_date?: string }[];
}

/* SO status chips reuse the quote-status palette (no new CSS). Shared by
   the grid, detail and approvals pages. */
export const SO_STATUS_CHIP: Record<string, string> = {
  Draft: "q-draft",
  PendingApproval: "q-pending",
  Confirmed: "q-accepted",
  InProgress: "q-sent",
  Cancelled: "q-rejected",
  Rejected: "q-rejected",
};
export const SO_STATUS_LABEL: Record<string, string> = {
  PendingApproval: "Pending Approval",
  // Stored value stays "Confirmed"; it reads as "Approved" everywhere (user
  // mandate 2026-07-20: post-approval label is "Approved", not "Confirmed").
  Confirmed: "Approved",
  InProgress: "In Progress",
};
export const soStatusLabel = (s: string) => SO_STATUS_LABEL[s] || s;

/* Mutations invalidate the cache so the next listOrders() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createSalesOrder(input: NewSalesOrderInput) {
  return bust(op<{ ROWID: string; order_number: string }>("so-with-items", input));
}

/** Update header + replace line items (mirror of updateQuoteWithItems).
    Server 409s once any work is recorded; PendingApproval/Confirmed → Draft. */
export function updateSalesOrderWithItems(salesOrderId: string, input: NewSalesOrderInput) {
  return bust(op<{ ROWID: string }>(`update-so-with-items/${salesOrderId}`, input));
}

export function deleteSalesOrder(rowid: string) {
  return bust(remove("SalesOrder", rowid));
}

/** Delete a single order line. Any production still linked to the line is
    DISASSOCIATED (made Independent — its sales_order/order_item FKs are nulled
    and an activity entry is logged), NOT deleted, then the SO total is
    recomputed over the remaining lines. Server refuses to delete the order's
    last line (an SO must keep ≥1 line item). */
export function deleteOrderItem(orderItemId: string) {
  return bust(op<{ rowid: string; disassociated: number }>(`delete-order-item/${orderItemId}`, {}));
}

/** Change SO status through the server-side state machine (/so-status —
    validates the transition, requires approval rights for verdicts, logs a
    StatusTransition row, and notifies the salesperson). */
export function setOrderStatus(salesOrderId: string, status: string, reason?: string) {
  return bust(op<{ ROWID: string; status: string }>(`so-status/${salesOrderId}`, { status, reason }));
}

/** Manual stage advance — only the judgment transitions (po→prod→qc→packing).
    packing→loading→final are set server-side when work is recorded
    (close-pallet / load-container / dispatch sagas), so a manual set there
    would let stage contradict the quantities. */
export const NEXT_STAGE: Record<string, string> = { po: "prod", prod: "qc", qc: "packing" };

export async function advanceStage(orderItemId: string, currentStage: string): Promise<OpResult> {
  const next = NEXT_STAGE[currentStage];
  if (!next) return { ok: false, error: "This stage advances by recording work" };
  const res = await update("OrderItem", orderItemId, { stage: next });
  if (res.ok) {
    cache.invalidate();
    void cache.load(); // refetch + notify every subscribed screen
  }
  return res;
}
