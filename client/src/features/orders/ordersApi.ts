/* ============================================================
   Sales Orders — typed Data Store wrapper over lib/dataOps.

   Each UI "order" row = one OrderItem joined with its SalesOrder
   header, Customer, and Design (+ Size/Finish/Brand lookups), to
   match the flat Order shape in client/src/data.ts.
   ============================================================ */
import { list, remove, op, type DSRow } from "@/lib/dataOps";
import type { Order } from "@/data";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

// Data Store stores ISO country codes (no emoji). Map the ones we seed.
const ISO_FLAG: Record<string, string> = { PL: "🇵🇱", LT: "🇱🇹", RO: "🇷🇴", HR: "🇭🇷" };

function mapBy(rows: DSRow[] | undefined, field: string): Map<string, string> {
  const m = new Map<string, string>();
  (rows || []).forEach((r) => m.set(String(r.ROWID), str(r[field])));
  return m;
}

/** Fetch all sales-order line items, hydrated to the UI Order shape. */
export async function listOrders(): Promise<{ ok: boolean; orders: Order[]; error?: string }> {
  // ZCQL caps LIMIT at 300 rows/query. (Pagination TODO when any table grows past 300.)
  const [sos, items, customers, designs, sizes, finishes, brands] = await Promise.all([
    list("SalesOrder", { order: "ROWID desc", limit: 300 }),
    list("OrderItem", { limit: 300 }),
    list("Customer", { limit: 300 }),
    list("Design", { limit: 300 }),
    list("Size", { limit: 300 }),
    list("Finish", { limit: 300 }),
    list("Brand", { limit: 300 }),
  ]);
  if (!items.ok || !sos.ok) return { ok: false, orders: [], error: items.error || sos.error };

  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const custName = mapBy(customers.rows, "name");
  const custCode = mapBy(customers.rows, "code");
  const custIso = mapBy(customers.rows, "country_code");
  const designName = mapBy(designs.rows, "design_name");
  const sizeName = mapBy(sizes.rows, "name");
  const finishName = mapBy(finishes.rows, "name");
  const brandName = mapBy(brands.rows, "name");
  // Design row's own lookup FKs (size/finish/brand) → names.
  const designRow = new Map<string, DSRow>();
  (designs.rows || []).forEach((d) => designRow.set(String(d.ROWID), d));

  const orders: Order[] = (items.rows || []).map((it) => {
    const so = soById.get(str(it.sales_order));
    const custId = so ? str(so.customer) : "";
    const d = designRow.get(str(it.design));
    const iso = custIso.get(custId) || "";
    return {
      id: String(it.ROWID),
      poNumber: so ? str(so.po_number) || str(so.order_number) : "",
      partyCode: custCode.get(custId) || "",
      party: custName.get(custId) || "",
      country: iso,
      flag: ISO_FLAG[iso] || "",
      design: designName.get(str(it.design)) || str(it.design),
      size: d ? sizeName.get(str(d.size)) || "" : "",
      finish: d ? finishName.get(str(d.finish)) || "" : "",
      brand: d ? brandName.get(str(d.brand)) || "" : "",
      orderQty: num(it.ordered_qty_boxes),
      producedQty: num(it.produced_qty_boxes),
      palletizedQty: num(it.palletized_qty_boxes),
      loadedQty: num(it.loaded_qty_boxes),
      boxesPerPallet: 0,
      totalBoxes: num(it.ordered_qty_boxes),
      pallets: 0,
      stage: str(it.stage) || "po",
      orderDate: so ? str(so.order_date) : "",
      dueDate: str(it.due_date) || "—",
      invoice: null,
      priority: (str(it.priority_level) as Order["priority"]) || "normal",
      daysFromPI: 0,
    };
  });

  return { ok: true, orders };
}

export interface NewSalesOrderInput {
  customer: string;
  order_number: string;
  po_number: string;
  order_date: string;
  payment_term: string;
  port_of_discharge: string;
  status: string;
  currency: string;
  remarks: string;
  address: string;
  lines: { item: string; qty: number; rate: number; stage?: string; priority?: string; due_date?: string }[];
}

export function createSalesOrder(input: NewSalesOrderInput) {
  return op<{ ROWID: string }>("so-with-items", input);
}

export function deleteSalesOrder(rowid: string) {
  return remove("SalesOrder", rowid);
}
