/* ============================================================
   Stock Adjustments (CR-308) — Inventory ▸ the history of box-stock
   corrections (breakage, theft, count…): one row per adjusted line, newest
   first, read straight from the production-log cache (entry_type="adjust").
   "New Adjustment" opens the bulk sheet (/stock-adjustments/new). No edit,
   no delete — an adjustment is reversed by the opposite entry.
   Follows the master-grid convention (see StockDetails).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { cachedAdjustEntries, listProductionLogs, type AdjustEntry } from "@/features/stages/productionApi";

const dash = <span className="dim">—</span>;

const COLUMNS: ColumnDef<AdjustEntry>[] = [
  { key: "date", label: "Date", className: "mono", render: (r) => r.adjDate || dash },
  {
    key: "item",
    label: "Item",
    render: (r) => (
      <Link className="linkish" to={`/design/${encodeURIComponent(r.designId)}?tab=stock`} onClick={(e) => e.stopPropagation()} title="View item stock">
        <span className="design-name">{r.design}</span>
      </Link>
    ),
  },
  { key: "size", label: "Size", render: (r) => (r.size ? <span className="chip size">{r.size}</span> : dash) },
  { key: "batch", label: "Batch", className: "mono", render: (r) => r.batchNumber || <span className="dim" title="Unbatched stock">—</span> },
  {
    key: "qty",
    label: "Boxes",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => <span style={{ color: r.qtyBoxes < 0 ? "var(--c-red)" : "var(--c-green)", fontWeight: 600 }}>{r.qtyBoxes > 0 ? "+" : ""}{fmt(r.qtyBoxes)}</span>,
  },
  { key: "reason", label: "Reason", render: (r) => r.reason || dash },
  { key: "note", label: "Note", className: "muted", render: (r) => r.note || dash },
  { key: "group", label: "Adj #", className: "muted mono", render: (r) => r.requestGroup || dash },
  { key: "by", label: "By", className: "muted", render: (r) => r.performedBy || dash },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
];

export function StockAdjustments() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdjustEntry[]>(() => cachedAdjustEntries());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("stockAdjust.query", "");
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("stockAdjustColumns", COLUMNS, ["group", "created"]);

  const load = async () => {
    setLoading(true);
    const res = await listProductionLogs();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load adjustments");
      return;
    }
    setError(null);
    setRows(res.adjustEntries);
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.design} ${r.batchNumber} ${r.reason} ${r.note} ${r.performedBy} ${r.requestGroup}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  // Newest first (house default for transaction lists).
  const sort = useSortRows(filtered, (r, k) => (k === "qty" ? r.qtyBoxes : k === "date" ? r.adjDate : k === "created" ? r.createdTime : k === "item" ? r.design : (r as unknown as Record<string, string>)[k === "batch" ? "batchNumber" : k]), "created", -1);
  const pager = usePagination(sort.sorted.length, "stockAdjustPageSize", `${query}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);
  const canEdit = can("items", "edit");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item, batch, reason…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        {canEdit && (
          <button className="hbtn primary" onClick={() => navigate("/stock-adjustments/new")}>
            <Icon name="plus" size={13} />
            New Adjustment
          </button>
        )}
      </div>

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different search" />
                      ) : (
                        <EmptyState
                          icon="package"
                          title="No stock adjustments yet"
                          hint="Record breakage, theft or a count correction with New Adjustment"
                          action={canEdit ? <button className="hbtn primary" onClick={() => navigate("/stock-adjustments/new")}>New Adjustment</button> : undefined}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
