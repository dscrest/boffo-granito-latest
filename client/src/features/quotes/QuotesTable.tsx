/* Quotes list — backed by the Catalyst Data Store via quotesApi.
   Hydrates on mount; New Quote / delete / convert all hit the data-ops
   function and refetch. Every write's outcome is recorded in OperationLog
   (see the /ops page). */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { fmt, fmtDateTime } from "@/lib/format";
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

// Toggleable + reorderable columns (Quote No pinned outside the map).
// Data-driven grid pattern (see DesignMaster): each ColumnDef carries its
// own cell renderer; thead/tbody map over useColumns().visible.
const linkStyle = { color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" } as const;

function quoteColumns(navigate: (to: string) => void): ColumnDef<Quote>[] {
  return [
    { key: "customer", label: "Customer", render: (q) => q.customer },
    { key: "date", label: "Date", className: "mono muted", render: (q) => q.quoteDate || "—" },
    { key: "items", label: "Items", className: "num mono", style: { textAlign: "right" }, render: (q) => q.lines.length },
    {
      key: "total",
      label: "Final Total",
      className: "num mono",
      style: { textAlign: "right" },
      render: (q) => <>{q.currency} {fmt(quoteTotals(q).final)}</>,
    },
    { key: "terms", label: "Terms", className: "muted", render: (q) => q.paymentTerm || "—" },
    {
      key: "status",
      label: "Status",
      render: (q) => <span className={`chip qstatus ${STATUS_CHIP[q.status]}`}>{STATUS_LABEL[q.status]}</span>,
    },
    {
      key: "so",
      label: "SO",
      className: "mono muted",
      render: (q) =>
        q.soNumber && q.soId ? (
          <button
            className="linkish"
            style={linkStyle}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/orders/${q.soId}`);
            }}
            title="Open Master Order"
          >
            {q.soNumber}
          </button>
        ) : (
          q.soNumber || "—"
        ),
    },
    { key: "created", label: "Created", className: "muted mono", render: (q) => fmtDateTime(q.createdTime) },
    { key: "modified", label: "Modified", className: "muted mono", render: (q) => fmtDateTime(q.modifiedTime) },
  ];
}

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
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [showForm, setShowForm] = useState(false);
  // Customer name to preset in a fresh QuoteForm (deep-link from the
  // customer detail's "Create Quotation"); cleared when the form closes.
  const [presetCustomer, setPresetCustomer] = useState("");

  // Deep-link /quotes?new=<customer name> opens the form pre-filled;
  // the param is consumed once so back/refresh never reopens it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const preset = searchParams.get("new");
    if (preset !== null) {
      setPresetCustomer(preset);
      setShowForm(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const COLS = useMemo(() => quoteColumns(navigate), [navigate]);
  const { ordered, visible, hidden, toggle, move } = useColumns("quotesTableColumns", COLS, ["created", "modified"]);
  // Paint the last cached snapshot instantly (stale-while-revalidate).
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
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
    setPresetCustomer("");
    setSaving(true);
    const res = await createQuote(quoteToInput(q));
    setSaving(false);
    if (!res.ok) {
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(`Quote saved (#${res.rowid})`);
    invalidateQuotes();
    await load();
  };

  const nextSeq = quotes.length + 1;

  // Advanced search fields (magnifier button) — options DB-sourced from rows.
  const filterFields = useMemo<FilterField<Quote>[]>(() => {
    const opts = (get: (r: Quote) => string) => [...new Set(quotes.map(get).filter(Boolean))].sort();
    return [
      { key: "quoteNo", label: "Quote No", type: "text", get: (r) => r.quoteNo },
      { key: "customer", label: "Customer", type: "multiselect", options: opts((r) => r.customer), get: (r) => r.customer },
      { key: "status", label: "Status", type: "multiselect", options: opts((r) => r.status), get: (r) => r.status },
      { key: "total", label: "Final Total", type: "numrange", get: (r) => quoteTotals(r).final },
      { key: "date", label: "Quote Date Between", type: "daterange", get: (r) => r.quoteDate },
      { key: "created", label: "Created Between", type: "daterange", get: (r) => r.createdTime || "" },
    ];
  }, [quotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = quotes.filter((r) => {
      if (tab !== "all" && !(r.status === tab || (tab === "Converted" && r.status === "PartiallyConverted")))
        return false;
      if (!q) return true;
      return `${r.quoteNo} ${r.customer}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, quotes, query, criteria, filterFields]);

  const pager = usePagination(filtered.length, "quotesPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);

  const tabCount = (id: string) =>
    id === "all"
      ? quotes.length
      : quotes.filter((q) => q.status === id || (id === "Converted" && q.status === "PartiallyConverted")).length;

  return (
    <div>
      {showForm && (
        <QuoteForm
          nextSeq={nextSeq}
          presetCustomer={presetCustomer || undefined}
          onSave={onSave}
          onClose={() => {
            setShowForm(false);
            setPresetCustomer("");
          }}
        />
      )}

      <div className="page-head">
        <div>
          <div className="title">Quotes</div>
        </div>
        <div className="right">
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
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Search quote no, customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <AdvancedFilterButton title="Quotes" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
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
                {visible.map((c) => (
                  <th key={c.key} style={c.style}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.slice(filtered).map((q) => (
                <tr
                  key={q.id}
                  tabIndex={0}
                  onClick={() => navigate(`/quotes/${q.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/quotes/${q.id}`);
                  }}
                  style={{ cursor: "pointer" }}
                  title="View quote"
                >
                  <td className="mono">{q.quoteNo}</td>
                  {visible.map((c) => (
                    <td key={c.key} className={c.className} style={c.style}>
                      {c.render!(q)}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 1}>
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
