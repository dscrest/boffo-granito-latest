/* ============================================================
   Cut Stock (Panel Craft) — one row per cut-piece ITEM (CR-307): the
   Item-master look (image, item, size) + Cut Piece Size · Weight/pc ·
   On Hand · Booked · Free (CR-312: what open panel orders hold vs what
   anyone may still book) · Stock Wt. Read-only grid over CutPieceStock; stock moves ONLY
   through the two bulk sheets (Add Stock = /cut-stock/record, Adjust
   Stock = /cut-stock/adjust) and the panel-order lifecycle. A row click
   opens the item's Panel Items detail, where cut pieces + weights live.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { FilterSelect, IconBtn } from "./pcBits";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedCutSizes, listPanels, type CutSizeOption } from "./panelsApi";
import { allocatedByKey, cachedCutStockRows, cachedPanelOrders, listCutStock, listPanelOrders, type CutStockRow, type PanelOrderRow } from "./panelOrdersApi";

const dash = <span className="dim">—</span>;
const kg2 = (n: number) => Math.round(n * 100) / 100;

/** Grid row = stock row + hydrated item (from the design/cut-size caches). */
interface StockGridRow extends CutStockRow {
  design?: DesignRow;
  designName: string;
  sizeLabel: string;
  cutSizeName: string;
  booked: number; // CR-312: Σ open panel orders' booking
  free: number; // qty − booked
}

const STOCK_COLUMNS: ColumnDef<StockGridRow>[] = [
  { key: "image", label: "Image", style: { width: 44 }, render: (r) => <ImageThumb images={r.design?.images ?? []} alt={r.designName} /> },
  { key: "design", label: "Item", render: (r) => <span className="design-name">{r.designName || "—"}</span> },
  { key: "size", label: "Size", render: (r) => (r.sizeLabel ? <span className="chip size">{r.sizeLabel}</span> : dash) },
  { key: "cutSize", label: "Cut Piece Size", className: "mono", render: (r) => r.cutSizeName || dash },
  {
    key: "weight",
    label: "Weight / pc",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.weightKg == null ? <span className="dim" title="Set on the Panel Item">—</span> : `${r.weightKg} kg`),
  },
  {
    key: "qty",
    label: "On Hand (pcs)",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => <span style={r.qty === 0 ? { color: "var(--c-red)" } : undefined}>{fmt(r.qty)}</span>,
  },
  { key: "booked", label: "Booked", className: "num mono", style: { textAlign: "right" }, render: (r) => (r.booked ? <span title="Held by open panel orders">{fmt(r.booked)}</span> : dash) },
  {
    key: "free",
    label: "Free",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => <span style={r.free === 0 && r.qty > 0 ? { color: "var(--c-amber)" } : undefined} title="On hand not booked by any order">{fmt(r.free)}</span>,
  },
  {
    key: "stockKg",
    label: "Stock Wt",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.weightKg == null ? dash : `${kg2(r.weightKg * r.qty)} kg`),
  },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function CutStock() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("cutStock.query", "");
  const [designFilter, setDesignFilter] = useState("");
  // Key bumped (CR-312): Booked / Free columns.
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("cutStockColumns.v3", STOCK_COLUMNS, ["modified"]);

  const load = async () => {
    setLoading(true);
    const [stockRes, designsRes, panelsRes, ordersRes] = await Promise.all([listCutStock(), listDesigns(), listPanels(), listPanelOrders()]);
    setLoading(false);
    if (panelsRes.ok) setCutSizes(panelsRes.cutSizes);
    if (ordersRes.ok) setOrders(ordersRes.orders);
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
    const byId = new Map(designs.map((d) => [d.id, d]));
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    const booked = allocatedByKey(orders);
    return rows.map((r): StockGridRow => {
      const d = byId.get(r.designId);
      const b = booked.get(`${r.designId}|${r.cutSizeId}`) ?? 0;
      return { ...r, design: d, designName: d ? d.uniqueName || d.designName : "", sizeLabel: d?.sizeLabel || "", cutSizeName: cutName.get(r.cutSizeId) || "", booked: b, free: Math.max(0, r.qty - b) };
    });
  }, [rows, designs, cutSizes, orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return grid.filter(
      (r) => (!designFilter || r.designName === designFilter) && (!q || r.designName.toLowerCase().includes(q) || r.cutSizeName.toLowerCase().includes(q) || r.sizeLabel.toLowerCase().includes(q)),
    );
  }, [grid, query, designFilter]);
  const designOptions = useMemo(() => [...new Set(grid.map((r) => r.designName).filter(Boolean))].sort(), [grid]);

  const sort = useSortRows(
    filtered,
    (r, k) =>
      k === "qty" ? r.qty
      : k === "booked" ? r.booked
      : k === "free" ? r.free
      : k === "weight" ? r.weightKg ?? -1
      : k === "stockKg" ? (r.weightKg ?? 0) * r.qty
      : k === "cutSize" ? r.cutSizeName
      : k === "size" ? r.sizeLabel
      : k === "modified" ? r.modifiedTime
      : r.designName,
    "design",
  );
  const pager = usePagination(sort.sorted.length, "cutStockPageSize", `${query}|${designFilter}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);
  const totals = useMemo(() => ({ pcs: filtered.reduce((s, r) => s + r.qty, 0), kg: filtered.reduce((s, r) => s + (r.weightKg ?? 0) * r.qty, 0) }), [filtered]);
  const canEdit = can("panel_craft", "edit");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : `${fmt(totals.pcs)} pcs · ${kg2(totals.kg)} kg`}</span>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Item" value={designFilter} onChange={setDesignFilter} options={designOptions} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item, size or cut size…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        {canEdit && (
          <button className="hbtn" onClick={() => navigate("/cut-stock/transfer")} title="Move pieces between warehouses (CR-330)">
            <Icon name="truck" size={13} />
            Transfer
          </button>
        )}
        {canEdit && (
          <button className="hbtn" onClick={() => navigate("/cut-stock/adjust")} title="Breakage, theft, count correction…">
            <Icon name="edit" size={13} />
            Adjust Stock
          </button>
        )}
        {canEdit && (
          <button className="hbtn primary" onClick={() => navigate("/cut-stock/record")}>
            <Icon name="plus" size={13} />
            Add Stock
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
                {pageRows.map((r) => {
                  // Whole row opens the item's cut pieces (weights live there); no row icons (CR-279).
                  const open = () => navigate(`/panel-items/${encodeURIComponent(r.designId)}`);
                  return (
                    <tr key={r.id} tabIndex={0} style={{ cursor: "pointer" }} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }} title="Open item — cut pieces & history">
                      {visible.map((c) => (
                        <td key={c.key} className={c.className} style={c.style}>
                          {c.render!(r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="tile"
                          title="No cut pieces yet"
                          hint="Add items on Panel Items first, then record stock with Add Stock"
                          action={canEdit ? <button className="hbtn primary" onClick={() => navigate("/panel-items")}>Panel Items</button> : undefined}
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
