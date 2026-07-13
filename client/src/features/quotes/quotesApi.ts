/* ============================================================
   Quotes — typed Data Store wrapper over lib/dataOps.

   Maps between the UI Quote shape (client/src/data.ts) and the Data
   Store columns. Reads hydrate the full UI object (header + lines)
   by joining Customer / PaymentTerm / Design / SalesOrder client-side
   from a handful of parallel list() calls.
   ============================================================ */
import { list, listAll, remove, update, op, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import type { Quote, QuoteLine, QuoteStatus, TaxType } from "@/data";

const toTaxType = (v: unknown): TaxType =>
  v === "TDS" || v === "TCS" ? v : "None";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

function buildMap(rows: DSRow[] | undefined, label: string): Map<string, string> {
  const m = new Map<string, string>();
  (rows || []).forEach((r) => m.set(String(r.ROWID), str(r[label])));
  return m;
}

function toStatus(s: string, flag: string): QuoteStatus {
  if (flag === "Full") return "Converted";
  if (flag === "Partial") return "PartiallyConverted";
  const allowed: QuoteStatus[] = ["Draft", "Sent", "Accepted", "Rejected", "Converted", "PartiallyConverted"];
  return (allowed as string[]).includes(s) ? (s as QuoteStatus) : "Draft";
}

/* ---------------------------------------------------------------
   Stale-while-revalidate cache (lib/cache). Consumers (QuotesTable,
   QuoteDetail, sidebar badge) paint the last snapshot instantly;
   loads inside the TTL skip the network, concurrent loads share one
   fetch. Mutations below auto-invalidate. */
const cache = createListCache(fetchQuotes);

/** Subscribe to cache changes (e.g. the sidebar badge). Returns an unsubscribe fn. */
export function subscribeQuotes(cb: () => void): () => void {
  return cache.subscribe(cb);
}

/** Last fetched quotes, or null if never fetched this session. */
export function cachedQuotes(): Quote[] | null {
  return cache.cached()?.quotes ?? null;
}
/** True if the cache exists and is younger than the TTL. */
export function quotesAreFresh(): boolean {
  return cache.isFresh();
}
/** Drop the cache so the next listQuotes() hits the network. */
export function invalidateQuotes(): void {
  cache.invalidate();
}

/** All quotes, hydrated to the UI Quote shape. Cached + deduped (lib/cache). */
export function listQuotes(): Promise<{ ok: boolean; quotes: Quote[]; error?: string }> {
  return cache.load();
}

async function fetchQuotes(): Promise<{ ok: boolean; quotes: Quote[]; error?: string }> {
  // listAll pages past ZCQL's 300-row cap; lookups project only the
  // columns this join actually reads (ROWID is always included).
  const [q, items, customers, terms, designs, sos, salesPersons] = await Promise.all([
    listAll("Quote", { order: "ROWID desc" }),
    listAll("QuoteItem"),
    listAll("Customer", { columns: ["name", "code"] }),
    list("PaymentTerm", { limit: 300, columns: ["name"] }),
    listAll("Design", { columns: ["design_name"] }),
    listAll("SalesOrder", { columns: ["quote", "order_number", "order_date", "total_amount", "status"] }),
    list("SalesPerson", { limit: 300, columns: ["name"] }),
  ]);
  if (!q.ok) return { ok: false, quotes: [], error: q.error };

  const custName = buildMap(customers.rows, "name");
  const custCode = buildMap(customers.rows, "code");
  const termName = buildMap(terms.rows, "name");
  const designName = buildMap(designs.rows, "design_name");
  const salesPersonName = buildMap(salesPersons.rows, "name");

  // QuoteItem rows grouped by parent quote ROWID → UI QuoteLine[].
  const linesByQuote = new Map<string, QuoteLine[]>();
  (items.rows || []).forEach((it) => {
    const qid = str(it.quote);
    const line: QuoteLine = {
      item: designName.get(str(it.design)) || str(it.design),
      qty: num(it.quantity_boxes),
      rate: num(it.rate),
      discount: num(it.discount_pct),
      description: str(it.description),
    };
    (linesByQuote.get(qid) || linesByQuote.set(qid, []).get(qid)!).push(line);
  });

  // ALL SalesOrders per source quote (partial conversions can create several);
  // sos[0] feeds the legacy soNumber/soId fields, the full list feeds the Orders tab.
  const soByQuote = new Map<string, NonNullable<Quote["sos"]>>();
  (sos.rows || []).forEach((s) => {
    if (!s.quote) return;
    const ref = {
      id: String(s.ROWID),
      number: str(s.order_number),
      date: str(s.order_date),
      status: str(s.status),
      total: num(s.total_amount),
    };
    (soByQuote.get(str(s.quote)) || soByQuote.set(str(s.quote), []).get(str(s.quote))!).push(ref);
  });

  const quotes: Quote[] = (q.rows || []).map((r) => {
    const id = String(r.ROWID);
    return {
      id,
      quoteNo: str(r.quote_number),
      customer: custName.get(str(r.customer)) || str(r.customer),
      partyCode: custCode.get(str(r.customer)) || "",
      address: str(r.address),
      shippingAddress: str(r.shipping_address),
      quoteDate: str(r.quote_date),
      expiryDate: str(r.expiry_date),
      paymentTerm: termName.get(str(r.payment_term)) || str(r.payment_term),
      portOfDischarge: str(r.port_of_discharge),
      status: toStatus(str(r.status), str(r.conversion_flag)),
      currency: str(r.currency) || "INR",
      exchangeRate: num(r.exchange_rate) || 1,
      remarks: str(r.remarks),
      salesperson: salesPersonName.get(str(r.sales_person)) || "",
      referenceNo: str(r.reference_no),
      customerNotes: str(r.customer_notes),
      terms: str(r.terms),
      docDiscount: num(r.discount),
      adjustment: num(r.adjustment),
      taxType: toTaxType(r.tax_type),
      taxPct: num(r.tax_pct),
      taxAmount: num(r.tax_amount),
      lines: linesByQuote.get(id) || [],
      soNumber: soByQuote.get(id)?.[0]?.number || null,
      soId: soByQuote.get(id)?.[0]?.id || null,
      sos: soByQuote.get(id) || [],
      shareToken: str(r.share_token),
      createdTime: str(r.CREATEDTIME),
      modifiedTime: str(r.MODIFIEDTIME),
    };
  });

  return { ok: true, quotes };
}

export interface NewQuoteInput {
  customer: string;
  quote_number: string;
  quote_date: string;
  expiry_date: string;
  payment_term: string;
  port_of_discharge: string;
  status: string;
  currency: string;
  /** INR per 1 unit of `currency`; INR = 1. */
  exchange_rate: number;
  remarks: string;
  address: string;
  shipping_address: string;
  salesperson: string;
  reference_no: string;
  customer_notes: string;
  terms: string;
  discount: number;
  adjustment: number;
  tax_type: string;
  tax_pct: number;
  lines: { item: string; qty: number; rate: number; discount: number; description?: string }[];
}

/* Mutations invalidate the cache so the next listQuotes() refetches.
   (Callers' explicit invalidateQuotes() remains harmless/idempotent.) */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

/** Create a Quote header + line items (server resolves FK names → ROWID). */
export function createQuote(input: NewQuoteInput) {
  return bust(op<{ ROWID: string; total_amount: number }>("quote-with-items", input));
}

export function updateQuote(rowid: string, patch: Record<string, unknown>) {
  return bust(update("Quote", rowid, patch));
}

/** Update a Quote header + replace all its line items (full edit). */
export function updateQuoteWithItems(rowid: string, input: NewQuoteInput) {
  return bust(op<{ ROWID: string; total_amount: number }>(`update-quote-with-items/${rowid}`, input));
}

export function deleteQuote(rowid: string) {
  return bust(remove("Quote", rowid));
}

/** Return the quote's share token, minting + persisting one on first use. */
export async function ensureShareToken(quote: Quote): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (quote.shareToken) return { ok: true, token: quote.shareToken };
  const token = crypto.randomUUID().replace(/-/g, "");
  const res = await bust(update("Quote", quote.id, { share_token: token }));
  return res.ok ? { ok: true, token } : { ok: false, error: res.error };
}

/** Convert a quote → Sales Order (Full | Partial). */
export function convertQuote(
  rowid: string,
  mode: "Full" | "Partial",
  lines: { item: string; qty: number; rate: number; description?: string }[],
  // order_number omitted → data-ops assigns the next SO number server-side.
  extra: { order_number?: string; po_number?: string; payment_term?: string; box_branding?: string },
) {
  return bust(
    op<{ so_rowid: string; quote_rowid: string; conversion_flag: string; order_number: string }>(
      `convert-quote/${rowid}`,
      { mode, lines, ...extra },
    ),
  );
}
