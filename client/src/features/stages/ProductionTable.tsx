/* Production — one row per production (request_group), styled like the Sales
   Orders master grid (ColumnPicker, advanced filter, footer pager). A row is a
   whole order's production request through its lifecycle: PendingApproval →
   Approved → Produced (or Rejected). Individual item lines live inside the
   detail, not here. "Send for Production" creates a request (goes to
   Approvals). Row click / Production-ID link opens the detail; output is
   recorded there, per line. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { ProgressBar } from "@/ui/primitives";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { fmt, fmtDateTime, pct } from "@/lib/format";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { ProductionForm } from "./ProductionForm";
import { ProductionImport } from "./ProductionImport";
import { RecordOutputForm, type RecordOutputResult } from "./RecordOutputForm";
import { ProductionKanban, type ProductionGroupBy } from "./ProductionKanban";
import {
  cachedProductionLogs,
  deleteProductionLog,
  groupProductionByItem,
  invalidateProductionLogs,
  listProductionLogs,
  productionDetailKey,
  recordProduction,
  recordProductionLines,
  requestProduction,
  setProductionStage,
  stageChip,
  PRODUCTION_STAGE_ORDER,
  PRODUCTION_STAGE_META,
  type ProductionEntry,
  type ProductionRequestGroup,
  type ProductionRequestInput,
  type ProductionStage,
} from "./productionApi";

// Default view hides completed productions ("Pending" = anything not Completed).
const TABS: Array<{ id: string; label: string; match?: ProductionStage; pending?: boolean }> = [
  { id: "pending", label: "Pending", pending: true },
  { id: "all", label: "All" },
  { id: "new", label: "New Request", match: "New" },
  { id: "inproduction", label: "In Production", match: "InProduction" },
  { id: "completed", label: "Completed", match: "Completed" },
];

// Board swimlane dimensions, in the menu order. Selecting several nests them.
const GROUP_DIMS: Array<{ id: ProductionGroupBy; label: string }> = [
  { id: "item", label: "Item" },
  { id: "customer", label: "Customer" },
  { id: "order", label: "Order" },
  { id: "size", label: "Size" },
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
      key: "stage",
      label: "Status",
      render: (g) => {
        const s = stageChip(g.stage);
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
      key: "remaining",
      label: "Remaining",
      className: "num mono",
      style: { textAlign: "right" },
      render: (g) => fmt(Math.max(0, g.totalRequested - g.totalProduced)),
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
            <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>{pct(g.produced, g.ordered)}%</span>
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
    case "stage": return PRODUCTION_STAGE_ORDER.indexOf(g.stage);
    case "requested": return g.totalRequested;
    case "produced": return g.totalProduced;
    case "remaining": return Math.max(0, g.totalRequested - g.totalProduced);
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
  // Filter follows the view: board → All (see everything), grid → Pending (hide
  // the completed pile). Seed from the persisted view so a board reload starts on All.
  const [tab, setTab] = useState(() => (localStorage.getItem("productionView") === "board" ? "all" : "pending"));
  // View persists across visits (board stays board until switched back).
  const [view, setView] = useState<"grid" | "board" | "sheet">(() => {
    const v = localStorage.getItem("productionView");
    return v === "board" || v === "sheet" ? v : "grid";
  });
  useEffect(() => {
    localStorage.setItem("productionView", view);
  }, [view]);
  // Switching view snaps the filter back to that view's default (board=All; grid/sheet=Pending).
  const changeView = (v: "grid" | "board" | "sheet") => {
    setView(v);
    setTab(v === "board" ? "all" : "pending");
  };
  // Board grouping: an ordered list of dimensions → nested swimlanes (empty = flat).
  const [groupBy, setGroupBy] = useState<ProductionGroupBy[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("productionGroups") || "[]");
      return Array.isArray(v) ? v.filter((d) => GROUP_DIMS.some((o) => o.id === d)) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("productionGroups", JSON.stringify(groupBy));
  }, [groupBy]);
  // Grouping picker (reuses the grid's ColumnPicker: checked = included, row
  // order = nesting order). Checked dims first (in nesting order), rest after.
  const groupCols = useMemo<ColumnDef<unknown>[]>(() => {
    const ordered = [...groupBy, ...GROUP_DIMS.map((o) => o.id).filter((id) => !groupBy.includes(id))];
    return ordered.map((id) => ({ key: id, label: GROUP_DIMS.find((o) => o.id === id)!.label }));
  }, [groupBy]);
  const groupHidden = useMemo(() => new Set(GROUP_DIMS.map((o) => o.id).filter((id) => !groupBy.includes(id))), [groupBy]);
  const toggleGroup = (key: string) =>
    setGroupBy((prev) => (prev.includes(key as ProductionGroupBy) ? prev.filter((d) => d !== key) : [...prev, key as ProductionGroupBy]));
  // Apply commits the dragged row order → nesting order of the checked dims.
  const moveGroup = (keys: string[]) => setGroupBy((prev) => keys.filter((k) => prev.includes(k as ProductionGroupBy)) as ProductionGroupBy[]);
  const [query, setQuery] = usePersistedState("production.query", "");
  const [criteria, setCriteria] = usePersistedState<FilterCriteria>("production.criteria", {});
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Logging output (the `+` on a card, or dragging a remaining card → Completed)
  // opens the record dialog; all output flows through recordProduction.
  const [recordEntry, setRecordEntry] = useState<ProductionEntry | null>(null);
  // Sheet view: in-flight inline qty edits, keyed by production-line id.

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

  // One row/card per production LINE ITEM (item-wise). In-progress
  // ("InProduction") lanes float to the top; newest-first within each tier.
  const groups = useMemo(
    () =>
      groupProductionByItem(entries).sort((a, b) => {
        const ap = a.stage === "InProduction" ? 0 : 1;
        const bp = b.stage === "InProduction" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return b.createdTime > a.createdTime ? 1 : -1;
      }),
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
    toast.success(`Production recorded — ${fmt(total)} boxes · ${res.data?.lines ?? input.lines.length} item(s)`);
    invalidateProductionLogs();
    setTab("pending");
    await load();
  };

  const filterFields = useMemo<FilterField<ProductionRequestGroup>[]>(() => {
    const opts = (get: (r: ProductionRequestGroup) => string) => [...new Set(groups.map(get).filter(Boolean))].sort();
    return [
      { key: "customer", label: "Customer", type: "multiselect", options: opts((r) => r.customer), get: (r) => r.customer },
      { key: "stage", label: "Status", type: "multiselect", options: [...PRODUCTION_STAGE_ORDER], get: (r) => r.stage },
      { key: "by", label: "Requested By", type: "multiselect", options: opts((r) => r.performedBy), get: (r) => r.performedBy },
      { key: "requested", label: "Requested (boxes)", type: "numrange", get: (r) => r.totalRequested },
      { key: "date", label: "Date Between", type: "daterange", get: (r) => r.date || r.createdTime || "" },
    ];
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tabDef = TABS.find((t) => t.id === tab);
    const base = groups.filter((r) => {
      // Pending = "not Completed" in every view (grid/sheet/board) — the status
      // tab always filters by production status, never shows completed lines.
      if (tabDef?.pending && r.stage === "Completed") return false;
      if (tabDef?.match && r.stage !== tabDef.match) return false;
      if (!q) return true;
      return `${r.code} ${r.designSummary} ${r.orderNumber} ${r.poNumber} ${r.customer} ${r.performedBy}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, view, groups, query, criteria, filterFields]);

  const sort = useSortRows(filtered, prodSortVal, "created", -1); // newest first by default
  const pager = usePagination(filtered.length, "productionPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(sort.sorted);
  // One-level section key for the sheet from the selected group dimensions.
  // Declared before sheetSorted, which calls it inside its useMemo (TDZ else).
  const groupKeyOf = (g: ProductionRequestGroup): string =>
    groupBy
      .map((d) =>
        d === "item" ? g.designSummary || "—"
        : d === "customer" ? g.customer || "—"
        : d === "order" ? g.orderNumber || g.poNumber || (g.independent ? "Independent" : "—")
        : g.entries[0]?.size || "—",
      )
      .join("  ›  ");

  // Sheet groups rows into sections by the selected dims (adjacent within page).
  const sheetSorted = useMemo(
    () => (groupBy.length ? [...sort.sorted].sort((a, b) => groupKeyOf(a).localeCompare(groupKeyOf(b))) : sort.sorted),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sort.sorted, groupBy],
  );
  const sheetRows = pager.slice(sheetSorted);

  // Per-section Requested/Produced totals for the sheet group headers — summed
  // over the WHOLE filtered set (not just the page) so a section split across
  // pages still shows its true group total.
  const groupTotals = useMemo(() => {
    const m = new Map<string, { requested: number; produced: number }>();
    if (!groupBy.length) return m;
    for (const g of sheetSorted) {
      const k = groupKeyOf(g);
      const cur = m.get(k) || { requested: 0, produced: 0 };
      cur.requested += g.totalRequested;
      cur.produced += g.totalProduced;
      m.set(k, cur);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetSorted, groupBy]);

  const tabCount = (t: (typeof TABS)[number]) =>
    t.match
      ? groups.filter((g) => g.stage === t.match).length
      : t.pending
        ? groups.filter((g) => g.stage !== "Completed").length
        : groups.length;

  const tabLabel = (t: (typeof TABS)[number]) => t.label;

  const canEdit = can("stages", "edit");

  // Apply the stage to every plan line of a production group.
  const applyStage = async (g: ProductionRequestGroup, stage: ProductionStage) => {
    const res = await setProductionStage(g.entries.map((e) => e.id), stage);
    if (!res.ok) {
      toast.error(res.error || "Could not move production");
      return;
    }
    toast.success(`Moved ${g.code} to ${PRODUCTION_STAGE_META[stage].label}`);
    invalidateProductionLogs();
    await load();
  };

  // Kanban drag → New / In Production apply directly (no output captured — that
  // was the source of the false "complete"). Completed opens a capture dialog first.
  const onMove = async (g: ProductionRequestGroup, stage: ProductionStage) => {
    // Dragging a remaining card into Completed = "record the rest": open the
    // output dialog (prefilled to what's left). Other moves apply the stage.
    if (stage === "Completed") { setRecordEntry(g.entries[0]); return; }
    await applyStage(g, stage);
  };

  // Log output on a line. The server auto-steps the Kanban stage
  // (New → InProduction, full coverage → Completed).
  const onRecord = (g: ProductionRequestGroup) => setRecordEntry(g.entries[0]);
  const onRecordSave = async (results: RecordOutputResult[]) => {
    setRecordEntry(null);
    // ponytail: singles loop is sequential + non-atomic; form caps Σ ≤ remaining
    for (const { entry: e, payload, total } of results) {
      let res;
      if ("batches" in payload) res = await recordProductionLines(e.id, payload.batches);
      else for (const s of payload.singles) { res = await recordProduction(e.id, s); if (!res.ok) break; }
      if (!res?.ok) {
        toast.error(res?.error || "Record output failed");
        break;
      }
      toast.success(`+${fmt(total)} boxes produced`);
    }
    invalidateProductionLogs();
    await load();
  };

  // ---- Sheet view: inline stage commit ----
  const commitStage = async (e: ProductionEntry, stage: ProductionStage) => {
    if (stage === e.stage) return;
    // Completing a line with boxes still to make opens the record dialog to
    // capture the final output + batch/shade (same as the board's onMove).
    if (stage === "Completed" && e.qtyRequested - e.producedSoFar > 0) { setRecordEntry(e); return; }
    const res = await setProductionStage([e.id], stage);
    if (!res.ok) { toast.error(res.error || "Could not change status"); return; }
    invalidateProductionLogs();
    await load();
  };

  // One-level section key for the sheet from the selected group dimensions.
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

      {showImport && <ProductionImport onDone={() => { invalidateProductionLogs(); void load(); }} onClose={() => setShowImport(false)} />}

      {recordEntry && <RecordOutputForm entries={[recordEntry]} onSave={onRecordSave} onClose={() => setRecordEntry(null)} />}

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
              {tabLabel(t)} ({tabCount(t)})
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search production, order, customer…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <AdvancedFilterButton title="Production" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {(["grid", "sheet", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              title={v === "grid" ? "Table view" : v === "sheet" ? "Sheet — inline edit qty & stage" : "Kanban board"}
              style={{
                background: view === v ? "var(--accent-soft)" : "transparent",
                color: view === v ? "var(--fg)" : "var(--muted)",
                border: 0, padding: "4px 8px", cursor: "pointer", font: "inherit", display: "inline-flex", alignItems: "center",
              }}
            >
              <Icon name={v === "grid" ? "columns" : v === "sheet" ? "edit" : "kanban"} size={13} />
            </button>
          ))}
        </div>
        {(view === "board" || view === "sheet") && (
          <ColumnPicker
            columns={groupCols}
            hidden={groupHidden}
            onToggle={toggleGroup}
            onMove={moveGroup}
            onClear={() => setGroupBy([])}
            label={groupBy.length ? `Group: ${groupBy.map((d) => GROUP_DIMS.find((o) => o.id === d)!.label).join(" › ")}` : "Group"}
            icon="menu"
            title="Group into sections — check dimensions, drag to set order"
          />
        )}
        {view === "grid" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />}
        {canEdit && (
          <button className="hbtn" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => setShowImport(true)}>
            <Icon name="upload" size={13} />
            Import
          </button>
        )}
        {canEdit && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={saving} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            {saving ? "Saving…" : "Record New Production"}
          </button>
        )}
      </div>
      )}

      {view === "board" ? (
        loading && entries.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : (
          <ProductionKanban groups={filtered} groupBy={groupBy} canEdit={canEdit} onMove={(g, stage) => void onMove(g, stage)} onRecord={onRecord} />
        )
      ) : view === "sheet" ? (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            {loading && entries.length === 0 ? (
              <SkeletonRows rows={6} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <SortTh id="code" label="Production ID" sort={sort} />
                    <th>Design</th>
                    <th>Order</th>
                    <th>Customer</th>
                    <th className="num" style={{ textAlign: "right" }}>Requested</th>
                    {/* ponytail: Produced column hidden 2026-08-12 — recording goes through the + dialog; restore from git if inline entry returns */}
                    <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                    <th style={{ width: 150 }}>Status</th>
                    {canEdit && <th style={{ width: 44 }} />}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const out: ReactNode[] = [];
                    let prevKey: string | null = null;
                    for (const g of sheetRows) {
                      const e = g.entries[0];
                      if (groupBy.length) {
                        const key = groupKeyOf(g);
                        if (key !== prevKey) {
                          prevKey = key;
                          const tot = groupTotals.get(key) || { requested: 0, produced: 0 };
                          out.push(
                            <tr key={`h-${key}`} style={{ background: "var(--accent-soft)", fontWeight: 700, color: "var(--accent-ink)" }}>
                              <td colSpan={4}>{key}</td>
                              <td className="num mono" style={{ textAlign: "right" }}>{fmt(tot.requested)}</td>
                              <td className="num mono" style={{ textAlign: "right" }}>{fmt(Math.max(0, tot.requested - tot.produced))}</td>
                              <td colSpan={canEdit ? 2 : 1} />
                            </tr>,
                          );
                        }
                      }
                      const remaining = Math.max(0, e.qtyRequested - e.producedSoFar);
                      const detail = `/prod/${encodeURIComponent(productionDetailKey(e))}`;
                      out.push(
                        <tr key={g.group}>
                          <td className="mono">
                            <Link className="linkish" to={detail} title="View production">{g.code}</Link>
                          </td>
                          <td><span className="design-name">{g.designSummary}</span></td>
                          <td className="mono">{g.independent ? "Independent" : g.orderNumber || g.poNumber || "—"}</td>
                          <td>{g.customer || (g.independent ? "—" : "")}</td>
                          <td className="num mono" style={{ textAlign: "right" }}>{fmt(e.qtyRequested)}</td>
                          <td className="num mono" style={{ textAlign: "right" }}>{remaining ? fmt(remaining) : <span className="dim">—</span>}</td>
                          <td>
                            {canEdit ? (
                              <select value={e.stage} onChange={(ev) => void commitStage(e, ev.target.value as ProductionStage)}>
                                {PRODUCTION_STAGE_ORDER.map((s) => (
                                  <option key={s} value={s}>{PRODUCTION_STAGE_META[s].label}</option>
                                ))}
                              </select>
                            ) : (
                              stageChip(e.stage).label
                            )}
                          </td>
                          {canEdit && (
                            <td>
                              <button
                                type="button"
                                className="btn x"
                                title={remaining > 0 ? `Record output (${fmt(remaining)} to make)` : "Record output"}
                                aria-label="Record output"
                                onClick={() => setRecordEntry(e)}
                              >
                                <Icon name="plus" size={13} />
                              </button>
                            </td>
                          )}
                        </tr>,
                      );
                    }
                    if (!loading && sheetRows.length === 0) {
                      out.push(
                        <tr key="empty">
                          <td colSpan={canEdit ? 8 : 7}><EmptyState title="No matching results" hint="Try a different filter" /></td>
                        </tr>,
                      );
                    }
                    return out;
                  })()}
                </tbody>
              </table>
            )}
          </div>
          {!(loading && entries.length === 0) && <GridFooter {...pager} />}
        </div>
      ) : (
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
                {pageRows.map((g) => {
                  const detail = `/prod/${encodeURIComponent(productionDetailKey(g.entries[0]))}`;
                  return (
                  <tr
                    key={g.group}
                    tabIndex={0}
                    onClick={() => navigate(detail)}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(detail); }}
                    style={{ cursor: "pointer", background: selected.has(g.group) ? "var(--accent-soft)" : undefined }}
                  >
                    <td style={{ textAlign: "center" }} onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(g.group)} onChange={() => toggleOne(g.group)} />
                    </td>
                    <td className="mono">
                      <Link className="linkish" to={detail} onClick={(ev) => ev.stopPropagation()} title="View production">
                        {g.code}
                      </Link>
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(g)}
                      </td>
                    ))}
                  </tr>
                  );
                })}
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
                                Record New Production
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
      )}
    </div>
  );
}
