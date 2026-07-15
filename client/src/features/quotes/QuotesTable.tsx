/* Quotes list — backed by the Catalyst Data Store via quotesApi.
   Hydrates on mount; New Quote / delete / convert all hit the data-ops
   function and refetch. Every write's outcome is recorded in OperationLog
   (see the /ops page). */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { can } from "@/lib/auth";
import { exportCsv } from "@/lib/csv";
import { fmt, fmtDateTime } from "@/lib/format";
import { quoteTotals, type Quote, type QuoteStatus } from "@/data";
import { QuoteForm } from "./QuoteForm";
import { cachedQuotes, createQuote, deleteQuote, invalidateQuotes, listQuotes, setQuoteStatus, type NewQuoteInput } from "./quotesApi";

export const STATUS_CHIP: Record<QuoteStatus, string> = {
  Draft: "q-draft",
  PendingApproval: "q-pending",
  Approved: "q-approved",
  Sent: "q-sent",
  Accepted: "q-accepted",
  Rejected: "q-rejected",
  Converted: "q-converted",
  PartiallyConverted: "q-partial",
};
export const STATUS_LABEL: Record<QuoteStatus, string> = {
  Draft: "Draft",
  PendingApproval: "Pending Approval",
  Approved: "Approved",
  Sent: "Sent",
  Accepted: "Accepted",
  Rejected: "Rejected",
  Converted: "Converted",
  PartiallyConverted: "Partial",
};

const TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "Draft", label: "Draft" },
  { id: "PendingApproval", label: "Pending Approval" },
  { id: "Sent", label: "Sent" },
  { id: "Accepted", label: "Accepted" },
  { id: "Converted", label: "Converted" },
];

// Toggleable + reorderable columns (Quote No pinned outside the map).
// Data-driven grid pattern (see DesignMaster): each ColumnDef carries its
// own cell renderer; thead/tbody map over useColumns().visible.
function quoteColumns(): ColumnDef<Quote>[] {
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
      render: (q) => (
        <span className={`chip qstatus ${STATUS_CHIP[q.status]}`} title={q.status === "Rejected" && q.rejectReason ? `Rejected: ${q.rejectReason}` : undefined}>
          {STATUS_LABEL[q.status]}
        </span>
      ),
    },
    {
      key: "so",
      label: "SO",
      className: "mono muted",
      render: (q) =>
        q.soNumber && q.soId ? (
          <Link
            className="linkish"
            to={`/orders/${q.soId}`}
            onClick={(e) => e.stopPropagation()}
            title="Open Sales Order"
          >
            {q.soNumber}
          </Link>
        ) : (
          q.soNumber || "—"
        ),
    },
    { key: "created", label: "Created", className: "muted mono", render: (q) => fmtDateTime(q.createdTime) },
    { key: "modified", label: "Modified", className: "muted mono", render: (q) => fmtDateTime(q.modifiedTime) },
  ];
}

// Sortable value per column key (header-click sorting — grid standard).
function quoteSortVal(q: Quote, k: string): string | number {
  switch (k) {
    case "quoteNo": return q.quoteNo;
    case "customer": return q.customer;
    case "date": return q.quoteDate || "";
    case "items": return q.lines.length;
    case "total": return quoteTotals(q).final;
    case "terms": return q.paymentTerm || "";
    case "status": return STATUS_LABEL[q.status];
    case "so": return q.soNumber || "";
    case "created": return q.createdTime || "";
    case "modified": return q.modifiedTime || "";
    default: return "";
  }
}

// Draft is no longer convertible — quotes must pass approval + customer
// acceptance flow before becoming Sales Orders.
export const convertible = (s: QuoteStatus) =>
  s === "Sent" || s === "Accepted" || s === "PartiallyConverted";

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
    exchange_rate: q.exchangeRate || 1,
    remarks: q.remarks,
    address: q.address,
    shipping_address: q.shippingAddress || "",
    salesperson: q.salesperson || "",
    reference_no: q.referenceNo || "",
    customer_notes: q.customerNotes || "",
    terms: q.terms || "",
    discount: q.docDiscount || 0,
    adjustment: q.adjustment || 0,
    tax_type: q.taxType || "None",
    tax_pct: q.taxPct || 0,
    lines: q.lines.map((l) => ({ item: l.item, qty: l.qty, rate: l.rate, discount: l.discount, description: l.description || "" })),
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
  const COLS = useMemo(() => quoteColumns(), []);
  const { ordered, visible, hidden, toggle, move } = useColumns("quotesTableColumns", COLS, ["created", "modified"]);
  // Paint the last cached snapshot instantly (stale-while-revalidate).
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Bulk selection (same master-page convention as DesignMaster).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<"" | QuoteStatus>("");
  const [bulkBusy, setBulkBusy] = useState(false);

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
    // Land on the new record so the next action can't target the wrong one.
    if (res.rowid) navigate(`/quotes/${encodeURIComponent(res.rowid)}`);
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

  const sort = useSortRows(filtered, quoteSortVal);
  const pager = usePagination(filtered.length, "quotesPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(sort.sorted);

  // ponytail: select-all covers the visible page only; `selected` accumulates across pages.
  const allShownSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  const ids = useMemo(() => [...selected], [selected]);

  const onBulkStatus = async () => {
    if (!bulkStatus) return;
    // Converted quotes keep their derived status — skip them.
    const targets = quotes.filter(
      (q) => selected.has(q.id) && q.status !== "Converted" && q.status !== "PartiallyConverted",
    );
    const skipped = ids.length - targets.length;
    setBulkBusy(true);
    let done = 0;
    let failed = 0;
    for (const q of targets) {
      const res = await setQuoteStatus(q.id, bulkStatus);
      if (res.ok) done += 1;
      else failed += 1;
    }
    setBulkBusy(false);
    if (failed) toast.error(`${done} updated, ${failed} failed (invalid transitions are rejected)`);
    else toast.success(`${done} quote${done === 1 ? "" : "s"} marked ${STATUS_LABEL[bulkStatus]}${skipped ? ` (${skipped} converted skipped)` : ""}`);
    setSelected(new Set());
    setBulkStatus("");
    invalidateQuotes();
    await load();
  };

  const onBulkDelete = async () => {
    if (!(await confirmDialog({ message: `Are you sure you want to delete ${ids.length} selected quote${ids.length > 1 ? "s" : ""}? This cannot be undone.`, danger: true })))
      return;
    setBulkBusy(true);
    let done = 0;
    let failed = 0;
    for (const rowid of ids) {
      const res = await deleteQuote(rowid);
      if (res.ok) done += 1;
      else failed += 1;
    }
    setBulkBusy(false);
    if (failed) toast.error(`${done} deleted, ${failed} failed`);
    else toast.success(`${done} quote${done === 1 ? "" : "s"} deleted`);
    setSelected(new Set());
    invalidateQuotes();
    await load();
  };

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

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ marginBottom: 12, borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          {can("quotes", "edit") && (
            <>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as "" | QuoteStatus)} disabled={bulkBusy} title="Bulk status change">
                <option value="">Change status…</option>
                <option value="PendingApproval">Submit for Approval</option>
                <option value="Sent">Sent</option>
                <option value="Accepted">Accepted</option>
                <option value="Rejected">Rejected</option>
                <option value="Draft">Draft</option>
              </select>
              <button className="btn" onClick={() => void onBulkStatus()} disabled={!bulkStatus || bulkBusy}>
                Apply
              </button>
            </>
          )}
          {can("quotes", "delete") && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={bulkBusy}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : (
        <div className="fbar" style={{ marginBottom: 12 }}>
          <Icon name="filter" size={12} />
          <select value={tab} onChange={(e) => setTab(e.target.value)} title="Filter by status">
            {TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({tabCount(t.id)})
              </option>
            ))}
          </select>
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
          {can("quotes", "export") && (
            <button
              className="hbtn"
              style={{ height: 26, padding: "0 10px", borderRadius: 5 }}
              title="Export the filtered rows as CSV"
              onClick={() =>
                exportCsv("quotes", filtered, [
                  { header: "Quote No", value: (q) => q.quoteNo },
                  { header: "Customer", value: (q) => q.customer },
                  { header: "Date", value: (q) => q.quoteDate },
                  { header: "Items", value: (q) => q.lines.length },
                  { header: "Currency", value: (q) => q.currency },
                  { header: "Final Total", value: (q) => quoteTotals(q).final },
                  { header: "Terms", value: (q) => q.paymentTerm },
                  { header: "Status", value: (q) => STATUS_LABEL[q.status] },
                  { header: "SO", value: (q) => q.soNumber },
                ])
              }
            >
              <Icon name="docs" size={13} />
              Export
            </button>
          )}
          {can("quotes", "create") && (
            /* fbar controls are 26px tall; the 30px .hbtn default would stretch the bar. */
            <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={saving} onClick={() => setShowForm(true)}>
              <Icon name="plus" size={13} />
              {saving ? "Saving…" : "New Quote"}
            </button>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && quotes.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title="Select all on this page" />
                </th>
                <SortTh id="quoteNo" label="Quote No" sort={sort} />
                {visible.map((c) => (
                  <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((q) => (
                <tr
                  key={q.id}
                  style={{ background: selected.has(q.id) ? "var(--accent-soft)" : undefined }}
                >
                  <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleOne(q.id)} />
                  </td>
                  <td className="mono">
                    <Link className="linkish" to={`/quotes/${q.id}`} onClick={(e) => e.stopPropagation()} title="View quote">
                      {q.quoteNo}
                    </Link>
                  </td>
                  {visible.map((c) => (
                    <td key={c.key} className={c.className} style={c.style}>
                      {c.render!(q)}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 2}>
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
