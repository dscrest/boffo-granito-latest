/* ============================================================
   Invoices — typed Data Store wrapper over lib/dataOps.

   One export invoice per container (Phase 5). Numbers come from the
   server's TransactionSeries ("EX-NN/YYYY-YY"); generation happens in
   the data-ops saga POST /invoice-for-container/:rowid, which sums the
   value of every loaded batch line on the container. Every write is
   recorded server-side in OperationLog.
   ============================================================ */
import { listAll, op, remove, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface InvoiceRow {
  id: string; // ROWID
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  currency: string;
  status: string; // draft | issued
  containerId: string; // Container ROWID ("" if unset)
  containerNumber: string;
  salesOrderId: string; // SalesOrder ROWID ("" when container spans many orders)
  orderNumber: string;
  customerName: string;
  createdTime: string;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchInvoices);

/** Last fetched invoices, or null if never fetched this session. */
export function cachedInvoices(): InvoiceRow[] | null {
  return cache.cached()?.invoices ?? null;
}
/** Subscribe to invoice-cache changes. Returns an unsubscribe fn. */
export function subscribeInvoices(cb: () => void): () => void {
  return cache.subscribe(cb);
}
/** Drop the cache so the next listInvoices() hits the network. */
export function invalidateInvoices(): void {
  cache.invalidate();
}

/** All invoices, container/order/customer labels hydrated. Cached + deduped. */
export function listInvoices(): Promise<{ ok: boolean; invoices: InvoiceRow[]; error?: string }> {
  return cache.load();
}

async function fetchInvoices(): Promise<{ ok: boolean; invoices: InvoiceRow[]; error?: string }> {
  const [invoices, containers, sos, customers] = await Promise.all([
    listAll("Invoice", { order: "ROWID desc" }),
    listAll("Container", { columns: ["container_number"] }),
    listAll("SalesOrder", { columns: ["order_number", "customer"] }),
    listAll("Customer", { columns: ["name"] }),
  ]);
  if (!invoices.ok) return { ok: false, invoices: [], error: invoices.error };

  const containerNo = new Map<string, string>();
  (containers.rows || []).forEach((r) => containerNo.set(String(r.ROWID), str(r.container_number)));
  const custName = new Map<string, string>();
  (customers.rows || []).forEach((r) => custName.set(String(r.ROWID), str(r.name)));
  const soRow = new Map<string, DSRow>();
  (sos.rows || []).forEach((r) => soRow.set(String(r.ROWID), r));

  const rows: InvoiceRow[] = (invoices.rows || []).map((iv) => {
    const soId = str(iv.sales_order);
    const so = soRow.get(soId);
    return {
      id: String(iv.ROWID),
      invoiceNumber: str(iv.invoice_number),
      invoiceDate: str(iv.invoice_date),
      totalAmount: num(iv.total_amount),
      currency: str(iv.currency),
      status: str(iv.status) || "issued",
      containerId: str(iv.container),
      containerNumber: containerNo.get(str(iv.container)) || "",
      salesOrderId: soId,
      orderNumber: so ? str(so.order_number) : "",
      customerName: so ? custName.get(str(so.customer)) || "" : "",
      createdTime: str(iv.CREATEDTIME),
    };
  });

  return { ok: true, invoices: rows };
}

export interface InvoiceGenResult {
  invoice_number: string;
  container: string;
  container_number: string;
  total_amount: number;
  currency: string;
  orders_on_board: number;
}

/* Mutations invalidate the cache so the next listInvoices() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

/** Generate the (single) invoice for a loaded container — server saga. */
export function generateInvoice(containerId: string, invoiceDate?: string) {
  return bust(
    op<InvoiceGenResult>(`invoice-for-container/${containerId}`, invoiceDate ? { invoice_date: invoiceDate } : {}),
  );
}

export function deleteInvoice(rowid: string) {
  return bust(remove("Invoice", rowid));
}
