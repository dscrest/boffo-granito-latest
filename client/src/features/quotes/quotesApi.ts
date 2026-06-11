/* ============================================================
   Quotes — typed Data Store wrapper over lib/dataOps.

   Maps between the UI Quote shape (client/src/data.ts) and the Data
   Store columns. Reads hydrate the full UI object (header + lines)
   by joining Customer / PaymentTerm / Design / SalesOrder client-side
   from a handful of parallel list() calls.
   ============================================================ */
import { list, remove, update, op, type DSRow } from "@/lib/dataOps";
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
   Module-level cache (stale-while-revalidate). listQuotes() refetches
   6 full tables every call; consumers (QuotesTable, QuoteDetail) paint
   the last snapshot instantly while a fresh fetch runs in the
   background — kills the multi-second blank load on revisit. */
let _cache: { quotes: Quote[]; ts: number } | null = null;
const QUOTES_TTL = 30_000;

/* Subscribers (e.g. the sidebar badge) notified whenever the cache changes,
   so live counts stay in sync with writes instead of showing seed data. */
type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  listeners.forEach((l) => l());
}
/** Subscribe to cache changes. Returns an unsubscribe fn. */
export function subscribeQuotes(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Last fetched quotes, or null if never fetched this session. */
export function cachedQuotes(): Quote[] | null {
  return _cache ? _cache.quotes : null;
}
/** True if the cache exists and is younger than the TTL. */
export function quotesAreFresh(): boolean {
  return !!_cache && Date.now() - _cache.ts < QUOTES_TTL;
}
/** Drop the cache so the next listQuotes() hits the network. */
export function invalidateQuotes(): void {
  _cache = null;
  notify();
}

/** Fetch all quotes, fully hydrated to the UI Quote shape. Caches the result. */
export async function listQuotes(): Promise<{ ok: boolean; quotes: Quote[]; error?: string }> {
  // ZCQL caps LIMIT at 300 rows/query. (Pagination TODO when any table grows past 300.)
  const [q, items, customers, terms, designs, sos] = await Promise.all([
    list("Quote", { order: "ROWID desc", limit: 300 }),
    list("QuoteItem", { limit: 300 }),
    list("Customer", { limit: 300 }),
    list("PaymentTerm", { limit: 300 }),
    list("Design", { limit: 300 }),
    list("SalesOrder", { limit: 300 }),
  ]);
  if (!q.ok) return { ok: false, quotes: [], error: q.error };

  const custName = buildMap(customers.rows, "name");
  const custCode = buildMap(customers.rows, "code");
  const termName = buildMap(terms.rows, "name");
  const designName = buildMap(designs.rows, "design_name");

  // QuoteItem rows grouped by parent quote ROWID → UI QuoteLine[].
  const linesByQuote = new Map<string, QuoteLine[]>();
  (items.rows || []).forEach((it) => {
    const qid = str(it.quote);
    const line: QuoteLine = {
      item: designName.get(str(it.design)) || str(it.design),
      qty: num(it.quantity_boxes),
      rate: num(it.rate),
      discount: num(it.discount_pct),
    };
    (linesByQuote.get(qid) || linesByQuote.set(qid, []).get(qid)!).push(line);
  });

  // SalesOrder number by source quote (for the SO column).
  const soByQuote = new Map<string, string>();
  (sos.rows || []).forEach((s) => {
    if (s.quote) soByQuote.set(str(s.quote), str(s.order_number));
  });

  const quotes: Quote[] = (q.rows || []).map((r) => {
    const id = String(r.ROWID);
    return {
      id,
      quoteNo: str(r.quote_number),
      customer: custName.get(str(r.customer)) || str(r.customer),
      partyCode: custCode.get(str(r.customer)) || "",
      address: str(r.address),
      quoteDate: str(r.quote_date),
      expiryDate: str(r.expiry_date),
      paymentTerm: termName.get(str(r.payment_term)) || str(r.payment_term),
      portOfDischarge: str(r.port_of_discharge),
      status: toStatus(str(r.status), str(r.conversion_flag)),
      currency: str(r.currency) || "EUR",
      remarks: str(r.remarks),
      salesperson: str(r.salesperson),
      referenceNo: str(r.reference_no),
      customerNotes: str(r.customer_notes),
      terms: str(r.terms),
      docDiscount: num(r.discount),
      adjustment: num(r.adjustment),
      taxType: toTaxType(r.tax_type),
      taxPct: num(r.tax_pct),
      taxAmount: num(r.tax_amount),
      lines: linesByQuote.get(id) || [],
      soNumber: soByQuote.get(id) || null,
    };
  });

  _cache = { quotes, ts: Date.now() };
  notify();
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
  remarks: string;
  address: string;
  salesperson: string;
  reference_no: string;
  customer_notes: string;
  terms: string;
  discount: number;
  adjustment: number;
  tax_type: string;
  tax_pct: number;
  lines: { item: string; qty: number; rate: number; discount: number }[];
}

/** Create a Quote header + line items (server resolves FK names → ROWID). */
export function createQuote(input: NewQuoteInput) {
  return op<{ ROWID: string; total_amount: number }>("quote-with-items", input);
}

export function updateQuote(rowid: string, patch: Record<string, unknown>) {
  return update("Quote", rowid, patch);
}

/** Update a Quote header + replace all its line items (full edit). */
export function updateQuoteWithItems(rowid: string, input: NewQuoteInput) {
  return op<{ ROWID: string; total_amount: number }>(`update-quote-with-items/${rowid}`, input);
}

export function deleteQuote(rowid: string) {
  return remove("Quote", rowid);
}

/** Convert a quote → Sales Order (Full | Partial). */
export function convertQuote(
  rowid: string,
  mode: "Full" | "Partial",
  lines: { item: string; qty: number; rate: number }[],
  extra: { order_number: string; po_number?: string; payment_term?: string },
) {
  return op<{ so_rowid: string; quote_rowid: string; conversion_flag: string }>(
    `convert-quote/${rowid}`,
    { mode, lines, ...extra },
  );
}
