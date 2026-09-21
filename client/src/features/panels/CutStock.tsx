/* ============================================================
   Cut Piece Stock (Panel Craft) — on-hand cut pieces per design +
   cut size. Read-mostly grid over CutPieceStock; the only mutation
   is the Update Stock modal (sets the absolute on-hand — the stock
   otherwise moves via panel saves and the panel-order lifecycle).
   No detail page — a row click opens the modal prefilled.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { FilterSelect, IconBtn } from "./pcBits";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedCutSizes, listPanels, type CutSizeOption } from "./panelsApi";
import { cachedCutStockRows, listCutStock, setCutPieceStock, type CutStockRow } from "./panelOrdersApi";
import { CutStockForm } from "./CutStockForm";

const dash = <span className="dim">—</span>;

/** Grid row = stock row + hydrated names (from the design/cut-size caches). */
interface StockGridRow extends CutStockRow {
  designName: string;
  cutSizeName: string;
}

const STOCK_COLUMNS: ColumnDef<StockGridRow>[] = [
  { key: "design", label: "Design", render: (r) => <span className="design-name">{r.designName || "—"}</span> },
  { key: "cutSize", label: "Cut Piece Size", className: "mono", render: (r) => r.cutSizeName || dash },
  {
    key: "qty",
    label: "On Hand",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => <span style={r.qty === 0 ? { color: "var(--danger)" } : undefined}>{fmt(r.qty)}</span>,
  },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function CutStock() {
  const [rows, setRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("cutStock.query", "");
  const [designFilter, setDesignFilter] = useState("");
  // null = closed; {} = blank Adjust; ids = prefilled from a row click.
  const [adjust, setAdjust] = useState<{ design?: string; cutSize?: string } | null>(null);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("cutStockColumns", STOCK_COLUMNS, ["modified"]);

  const load = async () => {
    setLoading(true);
    const [stockRes, designsRes, panelsRes] = await Promise.all([listCutStock(), listDesigns(), listPanels()]);
    setLoading(false);
    if (panelsRes.ok) setCutSizes(panelsRes.cutSizes);
    if (!stockRes.ok) {
      setError(stockRes.error || "Failed to load cut-piece stock");
      return;
    }
    setError(null);
    setRows(stockRes.rows);
    if (designsRes.ok) setDesigns(designsRes.designs);
  };

  useEffect(() => {
    void load();
  }, []);

  const grid = useMemo(() => {
    const designName = new Map(designs.map((d) => [d.id, d.uniqueName || d.designName]));
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    return rows.map((r): StockGridRow => ({
      ...r,
      designName: designName.get(r.designId) || "",
      cutSizeName: cutName.get(r.cutSizeId) || "",
    }));
  }, [rows, designs, cutSizes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return grid.filter(
      (r) =>
        (!designFilter || r.designName === designFilter) &&
        (!q || r.designName.toLowerCase().includes(q) || r.cutSizeName.toLowerCase().includes(q)),
    );
  }, [grid, query, designFilter]);

  const designOptions = useMemo(() => [...new Set(grid.map((r) => r.designName).filter(Boolean))].sort(), [grid]);

  const sort = useSortRows(
    filtered,
    (r, k) => (k === "qty" ? r.qty : k === "cutSize" ? r.cutSizeName : k === "modified" ? r.modifiedTime : r.designName),
    "design",
  );
  const pager = usePagination(sort.sorted.length, "cutStockPageSize", `${query}|${designFilter}`);
  const pageRows = pager.slice(sort.sorted);

  const onAdjust = async (design: string, cutSize: string, qty: number) => {
    const res = await setCutPieceStock(design, cutSize, qty);
    if (!res.ok) {
      toast.error(res.error || "Stock update failed");
      return;
    }
    setAdjust(null);
    toast.success("Stock updated");
    await load();
  };

  const canAdjust = can("panel_craft", "edit");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {adjust && (
        <CutStockForm
          initialDesign={adjust.design}
          initialCutSize={adjust.cutSize}
          onSave={(d, c, qty) => void onAdjust(d, c, qty)}
          onClose={() => setAdjust(null)}
        />
      )}

      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Design" value={designFilter} onChange={setDesignFilter} options={designOptions} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search design or cut size…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        {canAdjust && (
          <button className="hbtn primary" onClick={() => setAdjust({})}>
            <Icon name="plus" size={13} />
            Update Stock
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
                  {canAdjust && <th style={{ width: 40 }} />}
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
                    {canAdjust && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="row-actions">
                          <IconBtn icon="edit" title="Update this stock" onClick={() => setAdjust({ design: r.designId, cutSize: r.cutSizeId })} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + (canAdjust ? 1 : 0)}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="tile"
                          title="No cut-piece stock yet"
                          hint="Record an opening entry with Update Stock — cutting jobs add stock when they turn Ready"
                          action={
                            canAdjust ? (
                              <button className="hbtn primary" onClick={() => setAdjust({})}>
                                Update Stock
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
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
