/* Production — one row per production (request_group), styled like the Sales
   Orders master grid (ColumnPicker, advanced filter, footer pager). A row is a
   whole order's production request through its lifecycle: PendingApproval →
   Approved → Produced (or Rejected). Individual item lines live inside the
   detail, not here. "Send for Production" creates a request (goes to
   Approvals). Row click / Production-ID link opens the detail; output is
   recorded there, per line. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { ProgressBar } from "@/ui/primitives";
import { can } from "@/lib/auth";
import { exportCsv } from "@/lib/csv";
import { fmt, fmtDateTime, pct } from "@/lib/format";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { ProductionForm } from "./ProductionForm";
import {
  cachedProductionLogs,
  deleteProductionLog,
  groupProductionByOrder,
  invalidateProductionLogs,
  listProductionLogs,
  requestProduction,
  statusChip,
  type ProductionRequestGroup,
  type ProductionRequestInput,
  type ProductionStatus,
} from "./productionApi";

const TABS: Array<{ id: string; label: string; match?: ProductionStatus }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending", match: "PendingApproval" },
  { id: "approved", label: "Approved", match: "Approved" },
  { id: "produced", label: "Produced", match: "Produced" },
];

/* Data-driven columns (Production ID pinned outside the map as the row
   identity). Order matches the agreed default: Design, Order, Customer, Date,
   Status, Requested, Produced, Order Progress, Requested by. */
function productionColumns(): ColumnDef<ProductionRequestGroup>[] {
  return [
    { key: "design", label: "Design", render: (g) => <span className="design-name">{g.designSummary}</span> },
    {
      key: "order",
      label: "Order",
      className: "mono",
      render: (g) =>
        g.independent ? (
          <span className="chip" title="No Sales Order — make-to-stock">Independent</span>
        ) : (
          <Link className="linkish" to={`/orders/${g.salesOrderId}`} onClick={(ev) => ev.stopPropagation()} title="Open Sales Order">
            {g.orderNumber || g.poNumber || "—"}
          </Link>
        ),
    },
    { key: "customer", label: "Customer", render: (g) => g.customer || (g.independent ? "—" : "") },
    { key: "date", label: "Date", className: "mono muted", render: (g) => g.date || "—" },
    {
      key: "status",
      label: "Status",
      render: (g) => {
        const s = statusChip(g.status);
        return <span className="chip" style={{ color: s.color }}>{s.label}</span>;
      },
    },
    { key: "requested", label: "Requested", className: "num mono", style: { textAlign: "right" }, render: (g) => fmt(g.totalRequested) },
    {
      key: "produced",
      label: "Produced",
      className: "num mono",
      style: { textAlign: "right" },
      render: (g) => (g.totalProduced ? <span style={{ color: "var(--c-green)" }}>{fmt(g.totalProduced)}</span> : <span className="dim">—</span>),
    },
    {
      key: "progress",
      label: "Order Progress",
      render: (g) =>
        g.independent || g.ordered === 0 ? (
          <span className="dim">—</span>
        ) : (
          <div className="row" style={{ gap: 8, minWidth: 120 }}>
            <ProgressBar value={g.produced} max={g.ordered} color="var(--c-blue)" height={5} />
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{pct(g.produced, g.ordered)}%</span>
          </div>
        ),
    },
    { key: "by", label: "Requested by", className: "muted", render: (g) => g.performedBy || "—" },
    { key: "items", label: "Items", className: "num mono", style: { textAlign: "right" }, render: (g) => g.lineCount },
    { key: "created", label: "Created", className: "muted mono", render: (g) => fmtDateTime(g.createdTime) },
    { key: "modified", label: "Modified", className: "muted mono", render: (g) => fmtDateTime(g.modifiedTime) },
  ];
}

// Sortable value per column key (header-click sorting — grid standard).
function prodSortVal(g: ProductionRequestGroup, k: string): string | number {
  switch (k) {
    case "code": return g.code;
    case "design": return g.designSummary;
    case "order": return g.independent ? "Independent" : g.orderNumber || g.poNumber || "";
    case "customer": return g.customer;
    case "date": return g.date || "";
    case "status": return g.status;
    case "requested": return g.totalRequested;
    case "produced": return g.totalProduced;
    case "progress": return g.ordered ? g.produced / g.ordered : -1;
    case "by": return g.performedBy || "";
    case "items": return g.lineCount;
    case "created": return g.createdTime || "";
    case "modified": return g.modifiedTime || "";
    default: return "";
  }
}

export function ProductionTable() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const COLS = useMemo(() => productionColumns(), []);
  // Fresh storage key (old productionTableColumns prefs were per-line columns).
  const { ordered, visible, hidden, toggle, move } = useColumns("productionGroupColumns", COLS, ["items", "created", "modified"]);

  const [entries, setEntries] = useState(() => cachedProductionLogs() ?? []);
  const [loading, setLoading] = useState(() => cachedProductionLogs() == null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listProductionLogs();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load production log");
      return;
    }
    setError(null);
    setEntries(res.entries);
  };
  useEffect(() => {
    void load();
  }, []);

  // One row per Sales Order's production (whole order), newest first.
  const groups = useMemo(
    () => groupProductionByOrder(entries).sort((a, b) => (b.createdTime > a.createdTime ? 1 : -1)),
    [entries],
  );

  const onRequest = async (input: ProductionRequestInput) => {
    setShowForm(false);
    setSaving(true);
    const res = await requestProduction(input);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Production request failed");
      return;
    }
    const total = input.lines.reduce((s, l) => s + l.qty_requested, 0);
    toast.success(`Sent for approval — ${fmt(total)} boxes · ${res.data?.lines ?? input.lines.length} item(s)`);
    invalidateProductionLogs();
    setTab("pending");
    await load();
  };

  const filterFields = useMemo<FilterField<ProductionRequestGroup>[]>(() => {
    const opts = (get: (r: ProductionRequestGroup) => string) => [...new Set(groups.map(get).filter(Boolean))].sort();
    return [
      { key: "customer", label: "Customer", type: "multiselect", options: opts((r) => r.customer), get: (r) => r.customer },
      { key: "status", label: "Status", type: "multiselect", options: ["PendingApproval", "Approved", "Produced", "Rejected"], get: (r) => r.status },
      { key: "by", label: "Requested By", type: "multiselect", options: opts((r) => r.performedBy), get: (r) => r.performedBy },
      { key: "requested", label: "Requested (boxes)", type: "numrange", get: (r) => r.totalRequested },
      { key: "date", label: "Date Between", type: "daterange", get: (r) => r.date || r.createdTime || "" },
    ];
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = TABS.find((t) => t.id === tab)?.match;
    const base = groups.filter((r) => {
      if (match && r.status !== match) return false;
      if (!q) return true;
      return `${r.code} ${r.designSummary} ${r.orderNumber} ${r.poNumber} ${r.customer} ${r.performedBy}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, groups, query, criteria, filterFields]);

  const sort = useSortRows(filtered, prodSortVal);
  const pager = usePagination(filtered.length, "productionPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(sort.sorted);

  const tabCount = (t: (typeof TABS)[number]) =>
    t.match ? groups.filter((g) => g.status === t.match).length : groups.length;

  const canEdit = can("stages", "edit");

  // Bulk selection (same master-page convention as OrdersTable). `selected`
  // holds group keys and accumulates across pages.
  const allShownSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.group));
  const toggleOne = (key: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) pageRows.forEach((r) => next.delete(r.group));
      else pageRows.forEach((r) => next.add(r.group));
      return next;
    });
  const ids = useMemo(() => [...selected], [selected]);

  const onBulkDelete = async () => {
    const picked = groups.filter((g) => selected.has(g.group));
    // A production with an order-linked Produced line can't be deleted (the
    // OrderItem.produced bump isn't reversed here).
    const deletable = picked.filter((g) => g.entries.every((e) => e.independent || e.status !== "Produced"));
    const blocked = picked.length - deletable.length;
    if (deletable.length === 0) {
      toast.error("Selected productions have recorded output and can't be deleted");
      return;
    }
    if (!(await confirmDialog({ message: `Delete ${deletable.length} production${deletable.length > 1 ? "s" : ""}${blocked ? ` (${blocked} skipped — output recorded)` : ""}? This cannot be undone.`, danger: true }))) return;
    setBulkBusy(true);
    let done = 0;
    let failed = 0;
    for (const g of deletable) {
      let ok = true;
      for (const e of g.entries) {
        const res = await deleteProductionLog(e.id);
        if (!res.ok) ok = false;
      }
      ok ? (done += 1) : (failed += 1);
    }
    setBulkBusy(false);
    if (failed) toast.error(`${done} deleted, ${failed} failed`);
    else toast.success(`${done} production${done === 1 ? "" : "s"} deleted`);
    setSelected(new Set());
    invalidateProductionLogs();
    await load();
  };

  return (
    <div>
      {showForm && <ProductionForm onSave={onRequest} onClose={() => setShowForm(false)} />}

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ marginBottom: 12, borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>{ids.length} selected</span>
          {can("stages", "delete") && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={bulkBusy}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : (
      <div className="fbar" style={{ marginBottom: 12 }}>
        <Icon name="filter" size={12} />
        <select value={tab} onChange={(e) => setTab(e.target.value)} title="Filter by status">
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({tabCount(t)})
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search production, order, customer…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <AdvancedFilterButton title="Production" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
        {can("stages", "export") && (
          <button
            className="hbtn"
            style={{ height: 26, padding: "0 10px", borderRadius: 5 }}
            title="Export the filtered rows as CSV"
            onClick={() =>
              exportCsv("production", filtered, [
                { header: "Production ID", value: (g) => g.code },
                { header: "Date", value: (g) => g.date },
                { header: "Status", value: (g) => statusChip(g.status).label },
                { header: "Design", value: (g) => g.designs.join(", ") },
                { header: "Order", value: (g) => (g.independent ? "Independent" : g.orderNumber || g.poNumber) },
                { header: "Customer", value: (g) => g.customer },
                { header: "Items", value: (g) => g.lineCount },
                { header: "Requested (boxes)", value: (g) => g.totalRequested },
                { header: "Produced (boxes)", value: (g) => g.totalProduced },
                { header: "Requested By", value: (g) => g.performedBy },
              ])
            }
          >
            <Icon name="docs" size={13} />
            Export
          </button>
        )}
        {canEdit && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={saving} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            {saving ? "Saving…" : "Send for Production"}
          </button>
        )}
      </div>
      )}

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && entries.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 34, textAlign: "center" }}>
                    <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title="Select all on this page" />
                  </th>
                  <SortTh id="code" label="Production ID" sort={sort} />
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((g) => (
                  <tr
                    key={g.group}
                    tabIndex={0}
                    onClick={() => navigate(`/prod/${encodeURIComponent(g.group)}`)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" && ev.target === ev.currentTarget) navigate(`/prod/${encodeURIComponent(g.group)}`);
                    }}
                    style={{ cursor: "pointer", background: selected.has(g.group) ? "var(--accent-soft)" : undefined }}
                    title="View production"
                  >
                    <td style={{ textAlign: "center" }} onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(g.group)} onChange={() => toggleOne(g.group)} />
                    </td>
                    <td className="mono">
                      <Link className="linkish" to={`/prod/${encodeURIComponent(g.group)}`} onClick={(ev) => ev.stopPropagation()} title="View production">
                        {g.code}
                      </Link>
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(g)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 2}>
                      {groups.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="factory"
                          title="No production requested yet"
                          hint="Send items for production from a Sales Order, or start a request here"
                          action={
                            canEdit ? (
                              <button className="hbtn primary" onClick={() => setShowForm(true)}>
                                Send for Production
                              </button>
                            ) : undefined
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
        {!(loading && entries.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
