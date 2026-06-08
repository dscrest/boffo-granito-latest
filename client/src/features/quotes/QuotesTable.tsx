/* Quotes list — backed by the Catalyst Data Store via quotesApi.
   Hydrates on mount; New Quote / delete / convert all hit the data-ops
   function and refetch. Every write's outcome is recorded in OperationLog
   (see the /ops page). */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { fmt } from "@/lib/format";
import { quoteTotals, type Quote, type QuoteStatus } from "@/data";
import { QuoteForm } from "./QuoteForm";
import { QuotePrint } from "./QuotePrint";
import { ConvertDialog } from "./ConvertDialog";
import { createQuote, deleteQuote, listQuotes, type NewQuoteInput } from "./quotesApi";

const STATUS_CHIP: Record<QuoteStatus, string> = {
  Draft: "q-draft",
  Sent: "q-sent",
  Accepted: "q-accepted",
  Rejected: "q-rejected",
  Converted: "q-converted",
  PartiallyConverted: "q-partial",
};
const STATUS_LABEL: Record<QuoteStatus, string> = {
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

const convertible = (s: QuoteStatus) => s === "Draft" || s === "Sent" || s === "Accepted" || s === "PartiallyConverted";

function quoteToInput(q: Quote): NewQuoteInput {
  return {
    customer: q.customer,
    quote_number: q.quoteNo,
    quote_date: q.quoteDate,
    payment_term: q.paymentTerm,
    port_of_discharge: q.portOfDischarge,
    status: q.status,
    currency: q.currency,
    remarks: q.remarks,
    address: q.address,
    lines: q.lines.map((l) => ({ item: l.item, qty: l.qty, rate: l.rate, discount: l.discount })),
  };
}

export function QuotesTable() {
  const [tab, setTab] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printQuote, setPrintQuote] = useState<Quote | null>(null);
  const [convertQuoteRow, setConvertQuoteRow] = useState<Quote | null>(null);

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
    await load();
  };

  const onDelete = async (q: Quote) => {
    setNotice(`Deleting ${q.quoteNo}…`);
    const res = await deleteQuote(q.id);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Delete failed");
      return;
    }
    setNotice(`${q.quoteNo} deleted.`);
    await load();
  };

  const onConverted = async () => {
    setConvertQuoteRow(null);
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
      {printQuote && <QuotePrint quote={printQuote} onClose={() => setPrintQuote(null)} />}
      {convertQuoteRow && <ConvertDialog quote={convertQuoteRow} onClose={() => setConvertQuoteRow(null)} onConverted={onConverted} />}

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

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label} <span className="muted mono" style={{ marginLeft: 4 }}>{tabCount(t.id)}</span>
          </div>
        ))}
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
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const totals = quoteTotals(q);
                return (
                  <tr key={q.id}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{q.quoteNo}</td>
                    <td>{q.customer}</td>
                    <td className="mono muted">{q.quoteDate || "—"}</td>
                    <td className="num mono">{q.lines.length}</td>
                    <td className="num mono">{q.currency} {fmt(totals.final)}</td>
                    <td className="muted">{q.paymentTerm || "—"}</td>
                    <td>
                      <span className={`chip qstatus ${STATUS_CHIP[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                    </td>
                    <td className="mono muted">{q.soNumber || "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="btn" onClick={() => setPrintQuote(q)} title="View / print">
                          <Icon name="printer" size={12} />
                        </button>
                        <button
                          className="btn"
                          disabled={!convertible(q.status)}
                          onClick={() => setConvertQuoteRow(q)}
                          title={convertible(q.status) ? "Convert to Sales Order" : "Already converted"}
                        >
                          <Icon name="arrow-r" size={12} /> SO
                        </button>
                        <button className="btn ord-rm" onClick={() => void onDelete(q)} title="Delete quote">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 18 }}>
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
