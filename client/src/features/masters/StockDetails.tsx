/* ============================================================
   Stock Details — Inventory ▸ batch/shade-wise on-hand stock. One row per
   (item · batch · shade) with Current Stock = produced − loaded, derived in
   batchStockApi (no per-batch stock is stored). Read-only aggregate: no
   create/edit/delete. Row-click opens the item detail Stock tab.
   Follows the master-grid convention (see Sizes / DesignMaster).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { usePersistedState } from "@/lib/usePersistedState";
import { listBatchStock, type BatchStockRow } from "@/features/stages/batchStockApi";

const dash = <span className="dim">—</span>;
const rowKey = (r: BatchStockRow) => `${r.designId} ${r.batchNumber} ${r.shade}`;

// Toggleable + reorderable columns. Produced/Loaded default-hidden — Current
// Stock is the headline; the two components sit behind the column picker.
const STOCK_COLUMNS: ColumnDef<BatchStockRow>[] = [
  {
    key: "item",
    label: "Item",
    render: (r) => (
      <Link className="linkish" to={`/design/${r.designId}?tab=stock`} onClick={(e) => e.stopPropagation()} title="View item stock">
        {r.designLabel || dash}
      </Link>
    ),
  },
  {
    key: "current",
    label: "Current Stock",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => fmt(r.current),
  },
  { key: "size", label: "Size", render: (r) => (r.sizeCode ? <span className="chip size">{r.sizeCode}</span> : dash) },
  { key: "batch", label: "Batch", className: "mono", render: (r) => r.batchNumber || dash },
  { key: "shade", label: "Shade", render: (r) => r.shade || dash },
  {
    key: "produced",
    label: "Produced",
    className: "num mono muted",
    style: { textAlign: "right" },
    render: (r) => fmt(r.produced),
  },
  {
    key: "loaded",
    label: "Loaded",
    className: "num mono muted",
    style: { textAlign: "right" },
    render: (r) => fmt(r.loaded),
  },
];

export function StockDetails() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BatchStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("stock.query", "");
  const { ordered, visible, hidden, toggle, move } = useColumns("stockTableColumns", STOCK_COLUMNS, [
    "produced",
    "loaded",
  ]);

  const load = async () => {
    setLoading(true);
    const res = await listBatchStock();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load stock");
      return;
    }
    setError(null);
    setRows(res.rows);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.designLabel.toLowerCase().includes(q) ||
            r.batchNumber.toLowerCase().includes(q) ||
            r.shade.toLowerCase().includes(q) ||
            r.sizeCode.toLowerCase().includes(q),
        )
      : rows;
    // Default order: item name, then batch — stable and scannable.
    return [...base].sort(
      (a, b) => a.designLabel.localeCompare(b.designLabel) || a.batchNumber.localeCompare(b.batchNumber),
    );
  }, [rows, query]);

  const pager = usePagination(filtered.length, "stockPageSize", query);
  const pageRows = pager.slice(filtered);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item, batch or shade…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
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
                    <th key={c.key} style={c.style}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={rowKey(r)}
                    tabIndex={0}
                    onClick={() => navigate(`/design/${r.designId}?tab=stock`)}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/design/${r.designId}?tab=stock`); }}
                    style={{ cursor: "pointer" }}
                  >
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
                        <EmptyState icon="package" title="No stock yet" hint="Record production against a batch to see stock here" />
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
