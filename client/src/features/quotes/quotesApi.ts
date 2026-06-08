/* ============================================================
   Quotes — typed Data Store wrapper over lib/dataOps.

   Maps between the UI Quote shape (client/src/data.ts) and the Data
   Store columns. Reads hydrate the full UI object (header + lines)
   by joining Customer / PaymentTerm / Design / SalesOrder client-side
   from a handful of parallel list() calls.
   ============================================================ */
import { list, remove, update, op, type DSRow } from "@/lib/dataOps";
import type { Quote, QuoteLine, QuoteStatus } from "@/data";

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

/** Fetch all quotes, fully hydrated to the UI Quote shape. */
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
      paymentTerm: termName.get(str(r.payment_term)) || str(r.payment_term),
      portOfDischarge: str(r.port_of_discharge),
      status: toStatus(str(r.status), str(r.conversion_flag)),
      currency: str(r.currency) || "EUR",
      remarks: str(r.remarks),
      lines: linesByQuote.get(id) || [],
      soNumber: soByQuote.get(id) || null,
    };
  });

  return { ok: true, quotes };
}

export interface NewQuoteInput {
  customer: string;
  quote_number: string;
  quote_date: string;
  payment_term: string;
  port_of_discharge: string;
  status: string;
  currency: string;
  remarks: string;
  address: string;
  lines: { item: string; qty: number; rate: number; discount: number }[];
}

/** Create a Quote header + line items (server resolves FK names → ROWID). */
export function createQuote(input: NewQuoteInput) {
  return op<{ ROWID: string; total_amount: number }>("quote-with-items", input);
}

export function updateQuote(rowid: string, patch: Record<string, unknown>) {
  return update("Quote", rowid, patch);
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
