/* Quotes list — backed by the Catalyst Data Store via quotesApi.
   Hydrates on mount; New Quote / delete / convert all hit the data-ops
   function and refetch. Every write's outcome is recorded in OperationLog
   (see the /ops page). */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { fmt } from "@/lib/format";
import { quoteTotals, type Quote, type QuoteStatus } from "@/data";
import { QuoteForm } from "./QuoteForm";
import { cachedQuotes, createQuote, invalidateQuotes, listQuotes, type NewQuoteInput } from "./quotesApi";

export const STATUS_CHIP: Record<QuoteStatus, string> = {
  Draft: "q-draft",
  Sent: "q-sent",
  Accepted: "q-accepted",
  Rejected: "q-rejected",
  Converted: "q-converted",
  PartiallyConverted: "q-partial",
};
export const STATUS_LABEL: Record<QuoteStatus, string> = {
  Draft: "Draft",
  Sent: "Sent",
  Accepted: "Accepted",
  Rejected: "Rejected",
  Converted: "Converted",
  PartiallyConverted: "Partial",
};

const TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "Draft", label: "Draft" },
  { id: "Sent", label: "Sent" },
  { id: "Accepted", label: "Accepted" },
  { id: "Converted", label: "Converted" },
];

export const convertible = (s: QuoteStatus) =>
  s === "Draft" || s === "Sent" || s === "Accepted" || s === "PartiallyConverted";

export function quoteToInput(q: Quote): NewQuoteInput {
  return {
    customer: q.customer,
    quote_number: q.quoteNo,
    quote_date: q.quoteDate,
    expiry_date: q.expiryDate || "",
    payment_term: q.paymentTerm,
    port_of_discharge: q.portOfDischarge,
    status: q.status,
    currency: q.currency,
    remarks: q.remarks,
    address: q.address,
    salesperson: q.salesperson || "",
    reference_no: q.referenceNo || "",
    customer_notes: q.customerNotes || "",
    terms: q.terms || "",
    discount: q.docDiscount || 0,
    adjustment: q.adjustment || 0,
    tax_type: q.taxType || "None",
    tax_pct: q.taxPct || 0,
    lines: q.lines.map((l) => ({ item: l.item, qty: l.qty, rate: l.rate, discount: l.discount })),
  };
}

export function QuotesTable() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [showForm, setShowForm] = useState(false);
  // Paint the last cached snapshot instantly (stale-while-revalidate).
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listQuotes();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load quotes");
      return;
    }
    setError(null);
    setQuotes(res.quotes);
  };

  useEffect(() => {
    void load();
  }, []);

  const onSave = async (q: Quote) => {
    setShowForm(false);
    setNotice("Saving quote…");
    const res = await createQuote(quoteToInput(q));
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      return;
    }
    setNotice(`Quote saved (#${res.rowid}).`);
    invalidateQuotes();
    await load();
  };

  const nextSeq = quotes.length + 1;

  const filtered = useMemo(() => {
    if (tab === "all") return quotes;
    return quotes.filter((q) => q.status === tab || (tab === "Converted" && q.status === "PartiallyConverted"));
  }, [tab, quotes]);

  const tabCount = (id: string) =>
    id === "all"
      ? quotes.length
      : quotes.filter((q) => q.status === id || (id === "Converted" && q.status === "PartiallyConverted")).length;

  return (
    <div>
      {showForm && <QuoteForm nextSeq={nextSeq} onSave={onSave} onClose={() => setShowForm(false)} />}

      <div className="page-head">
        <div>
          <div className="title">Quotes</div>
          <div className="sub">
            {loading ? "Loading…" : `${filtered.length} of ${quotes.length} quotes`} · raised → shared → converted to Sales Order
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New Quote
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}>
          {error} — check the <a href="#/ops">Operations log</a>.
        </div>
      )}

      <div className="fbar" style={{ marginBottom: 12 }}>
        <label className="form-field" style={{ width: 240 }}>
          <span className="lbl">Filter by status</span>
          <select value={tab} onChange={(e) => setTab(e.target.value)}>
            {TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({tabCount(t.id)})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Quote No</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="num" style={{ textAlign: "right" }}>Items</th>
                <th className="num" style={{ textAlign: "right" }}>Final Total</th>
                <th>Terms</th>
                <th>Status</th>
                <th>SO</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const totals = quoteTotals(q);
                return (
                  <tr key={q.id}>
                    <td className="mono">
                      <button
                        className="linkish"
                        style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                        onClick={() => navigate(`/quotes/${q.id}`)}
                        title="Open details"
                      >
                        {q.quoteNo}
                      </button>
                    </td>
                    <td>{q.customer}</td>
                    <td className="mono muted">{q.quoteDate || "—"}</td>
                    <td className="num mono">{q.lines.length}</td>
                    <td className="num mono">{q.currency} {fmt(totals.final)}</td>
                    <td className="muted">{q.paymentTerm || "—"}</td>
                    <td>
                      <span className={`chip qstatus ${STATUS_CHIP[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                    </td>
                    <td className="mono muted">{q.soNumber || "—"}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 18 }}>
                    No quotes yet. Click <b>New Quote</b> to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
