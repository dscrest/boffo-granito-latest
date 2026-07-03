/* Quotes list — backed by the Catalyst Data Store via quotesApi.
   Hydrates on mount; New Quote / delete / convert all hit the data-ops
   function and refetch. Every write's outcome is recorded in OperationLog
   (see the /ops page). */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useHiddenColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
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

// Toggleable columns (Quote No always shown).
const QUOTE_COLUMNS: ColumnDef[] = [
  { key: "customer", label: "Customer" },
  { key: "date", label: "Date" },
  { key: "items", label: "Items" },
  { key: "total", label: "Final Total" },
  { key: "terms", label: "Terms" },
  { key: "status", label: "Status" },
  { key: "so", label: "SO" },
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
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { hidden, toggle, show } = useHiddenColumns("quotesTableColumns");
  // Paint the last cached snapshot instantly (stale-while-revalidate).
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    setNotice("Saving quote…");
    const res = await createQuote(quoteToInput(q));
    setSaving(false);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setNotice(`Quote saved (#${res.rowid}).`);
    toast.success(`Quote saved (#${res.rowid})`);
    invalidateQuotes();
    await load();
  };

  const nextSeq = quotes.length + 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return quotes.filter((r) => {
      if (tab !== "all" && !(r.status === tab || (tab === "Converted" && r.status === "PartiallyConverted")))
        return false;
      if (!q) return true;
      return `${r.quoteNo} ${r.customer}`.toLowerCase().includes(q);
    });
  }, [tab, quotes, query]);

  const pager = usePagination(filtered.length, "quotesPageSize", `${tab}|${query}`);

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
            {loading ? "Loading…" : "Raised → shared → converted to Master Order"}
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
          <button className="hbtn primary" disabled={saving} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            {saving ? "Saving…" : "New Quote"}
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

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
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search quote no, customer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ColumnPicker columns={QUOTE_COLUMNS} hidden={hidden} onToggle={toggle} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && quotes.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Quote No</th>
                {show("customer") && <th>Customer</th>}
                {show("date") && <th>Date</th>}
                {show("items") && <th className="num" style={{ textAlign: "right" }}>Items</th>}
                {show("total") && <th className="num" style={{ textAlign: "right" }}>Final Total</th>}
                {show("terms") && <th>Terms</th>}
                {show("status") && <th>Status</th>}
                {show("so") && <th>SO</th>}
              </tr>
            </thead>
            <tbody>
              {pager.slice(filtered).map((q) => {
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
                    {show("customer") && <td>{q.customer}</td>}
                    {show("date") && <td className="mono muted">{q.quoteDate || "—"}</td>}
                    {show("items") && <td className="num mono">{q.lines.length}</td>}
                    {show("total") && <td className="num mono">{q.currency} {fmt(totals.final)}</td>}
                    {show("terms") && <td className="muted">{q.paymentTerm || "—"}</td>}
                    {show("status") && (
                      <td>
                        <span className={`chip qstatus ${STATUS_CHIP[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                      </td>
                    )}
                    {show("so") && (
                      <td className="mono muted">
                        {q.soNumber && q.soId ? (
                          <button
                            className="linkish"
                            style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                            onClick={() => navigate(`/orders/${q.soId}`)}
                            title="Open Master Order"
                          >
                            {q.soNumber}
                          </button>
                        ) : (
                          q.soNumber || "—"
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    {quotes.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="quote"
                        title="No quotes yet"
                        hint="Create your first quote with New Quote"
                        action={
                          <button className="hbtn primary" onClick={() => setShowForm(true)}>
                            New Quote
                          </button>
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
        {!(loading && quotes.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
