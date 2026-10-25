/* ============================================================
   Pending Cut Stock (Panel Craft, CR-314) — the shortage view: one row
   per cut piece (design × cut size) across every open panel order (all
   stages but Dispatched) and every cut-piece item, with
     Required · On Hand · Booked · Free · Shortage · Orders
   Shortage = max(0, Required − On Hand) is what the godown must still
   cut; Booked (CR-312) is what open orders hold, Free what anyone may
   still book. Zero-stock items show even with no demand. Row click opens
   the item's Panel Items detail. Pure maths = demandByKey (panelOrderNeeds).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Chip } from "@/ui/Chip";
import { KPI } from "@/ui/primitives";
import { FilterSelect, IconBtn } from "./pcBits";
import { InfoTag } from "@/ui/InfoCard";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { usePersistedState } from "@/lib/usePersistedState";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedCutSizes, cachedPanels, listPanels, type CutSizeOption, type PanelRow } from "./panelsApi";
import { cachedCutStock, cachedPanelOrders, demandByKey, listCutStock, listPanelOrders, pendingNeedLines, type DemandRow, type PanelOrderRow } from "./panelOrdersApi";

const dash = <span className="dim">—</span>;

/** Grid row = demand row + hydrated item (names / image from the caches). */
interface Row extends DemandRow {
  design?: DesignRow;
  sizeLabel: string;
}

const COLUMNS: ColumnDef<Row>[] = [
  { key: "image", label: "Image", style: { width: 44 }, render: (r) => <ImageThumb images={r.design?.images ?? []} alt={r.designName} /> },
  { key: "design", label: "Item", render: (r) => <span className="design-name">{r.designName || "—"}</span> },
  { key: "size", label: "Size", render: (r) => (r.sizeLabel ? <span className="chip size">{r.sizeLabel}</span> : dash) },
  { key: "cutSize", label: "Cut Piece Size", className: "mono", render: (r) => r.cutSizeName || dash },
  { key: "required", label: "Required", className: "num mono", style: { textAlign: "right" }, render: (r) => (r.required ? fmt(r.required) : dash) },
  {
    key: "onHand",
    label: "On Hand",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => <span style={r.onHand === 0 ? { color: "var(--c-red)" } : undefined}>{fmt(r.onHand)}</span>,
  },
  { key: "allocated", label: "Booked", className: "num mono", style: { textAlign: "right" }, render: (r) => (r.allocated ? fmt(r.allocated) : dash) },
  { key: "free", label: "Free", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(r.free) },
  {
    key: "shortage",
    label: "Shortage",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.shortage > 0 ? <span style={{ color: "var(--c-red)", fontWeight: 600 }} title="Required − On Hand: pieces still to cut">{fmt(r.shortage)}</span> : dash),
  },
  {
    key: "orders",
    label: "Orders",
    // Count + (i) → the per-order list ("PNL/26-27/003 ×4", click opens the order) in the InfoTag card (user mandate 2026-10-22: never a list in the cell).
    render: (r) =>
      r.orders.length ? (
        <InfoTag label={`${r.orders.length} order${r.orders.length === 1 ? "" : "s"}`} title={`Orders needing ${r.cutSizeName || r.designName}`} width={300}>
          {r.orders.map((o) => (
            <Link key={o.id} className="linkish mono" to={`/panel-orders/${encodeURIComponent(o.id)}`} title="Open order" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{o.orderNumber || o.id}</span>
              <span className="dim">×{fmt(o.need)} pcs</span>
            </Link>
          ))}
        </InfoTag>
      ) : (
        dash
      ),
  },
  { key: "flag", label: "Stock", render: (r) => (r.onHand === 0 ? <Chip tone="red" label="Zero stock" /> : r.shortage > 0 ? <Chip tone="amber" label="Short" /> : <Chip tone="green" label="Covered" />) },
];

export function PendingCutStock() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [loading, setLoading] = useState(() => cachedPanelOrders() == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("pendingCutStock.query", "");
  const [designFilter, setDesignFilter] = useState("");
  const [shortOnly, setShortOnly] = usePersistedState("pendingCutStock.shortOnly", false);
  const [zeroOnly, setZeroOnly] = usePersistedState("pendingCutStock.zeroOnly", false);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("pendingCutStockColumns", COLUMNS);

  const load = async () => {
    setLoading(true);
    const [o, p, s, d] = await Promise.all([listPanelOrders(), listPanels(), listCutStock(), listDesigns()]);
    setLoading(false);
    if (!o.ok) {
      setError(o.error || "Failed to load panel orders");
      return;
    }
    setError(null);
    setOrders(o.orders);
    if (p.ok) {
      setPanels(p.panels);
      setCutSizes(p.cutSizes);
    }
    if (s.ok) setStock(s.stock);
    if (d.ok) setDesigns(d.designs);
  };
  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo((): Row[] => {
    const panelById = new Map(panels.map((p) => [p.id, p]));
    const byId = new Map(designs.map((d) => [d.id, d]));
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    // CR-347: only what is still PENDING to load counts as demand.
    return demandByKey(orders.map((o) => ({ ...o, lines: pendingNeedLines(o.lines, o.loads, panelById) })), panelById, stock, stock.keys()).map((r) => {
      const d = byId.get(r.designId);
      return { ...r, design: d, designName: r.designName || (d ? d.uniqueName || d.designName : ""), cutSizeName: r.cutSizeName || cutName.get(r.cutSizeId) || "", sizeLabel: d?.sizeLabel || "" };
    });
  }, [orders, panels, stock, designs, cutSizes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!shortOnly || r.shortage > 0) &&
        (!zeroOnly || r.onHand === 0) &&
        (!designFilter || r.designName === designFilter) &&
        (!q || r.designName.toLowerCase().includes(q) || r.cutSizeName.toLowerCase().includes(q) || r.sizeLabel.toLowerCase().includes(q) || r.orders.some((o) => o.orderNumber.toLowerCase().includes(q))),
    );
  }, [rows, query, designFilter, shortOnly, zeroOnly]);
  const designOptions = useMemo(() => [...new Set(rows.map((r) => r.designName).filter(Boolean))].sort(), [rows]);

  const sort = useSortRows(
    filtered,
    (r, k) =>
      k === "required" ? r.required
      : k === "onHand" ? r.onHand
      : k === "allocated" ? r.allocated
      : k === "free" ? r.free
      : k === "shortage" ? r.shortage
      : k === "orders" ? r.orders.length
      : k === "flag" ? (r.onHand === 0 ? 2 : r.shortage > 0 ? 1 : 0)
      : k === "cutSize" ? r.cutSizeName
      : k === "size" ? r.sizeLabel
      : r.designName,
    "shortage",
    -1, // worst first
  );
  const pager = usePagination(sort.sorted.length, "pendingCutStockPageSize", `${query}|${designFilter}|${shortOnly}|${zeroOnly}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const openOrders = orders.filter((o) => o.status !== "Dispatched" && o.status !== "Cancelled"); // CR-368
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      {loading && orders.length === 0 ? (
        <SkeletonRows rows={1} height={88} />
      ) : (
        <div className="kpi-grid" style={{ marginBottom: 12 }}>
          <KPI label="Open Orders" value={fmt(openOrders.length)} unit="orders" delta={`${fmt(openOrders.reduce((s, o) => s + o.totalQty, 0))} panels`} />
          <KPI label="Required" value={fmt(sum((r) => r.required))} unit="pcs" delta="cut pieces across open orders" />
          <KPI label="On Hand" value={fmt(sum((r) => r.onHand))} unit="pcs" delta={`${fmt(sum((r) => r.allocated))} booked · ${fmt(sum((r) => r.free))} free`} color="var(--c-green)" />
          <KPI label="Shortage" value={fmt(sum((r) => r.shortage))} unit="pcs" delta={`${fmt(rows.filter((r) => r.shortage > 0).length)} cut pieces to cut`} color={sum((r) => r.shortage) ? "var(--c-red)" : "var(--c-green)"} />
          <KPI label="Zero Stock" value={fmt(rows.filter((r) => r.onHand === 0).length)} unit="items" delta="cut pieces with nothing on hand" color={rows.some((r) => r.onHand === 0) ? "var(--c-amber)" : "var(--c-green)"} />
        </div>
      )}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <label className="row" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} /> Short only
        </label>
        <label className="row" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={zeroOnly} onChange={(e) => setZeroOnly(e.target.checked)} /> Zero stock only
        </label>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Item" value={designFilter} onChange={setDesignFilter} options={designOptions} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item, cut size or order…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
      </div>

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && orders.length === 0 ? (
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
                  const open = () => navigate(`/panel-items/${encodeURIComponent(r.designId)}`);
                  return (
                    <tr key={r.key} tabIndex={0} style={{ cursor: "pointer" }} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }} title="Open item — cut pieces & history">
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
                      {rows.length > 0 ? <EmptyState title="Nothing matches" hint="Clear a filter to see every cut piece" /> : <EmptyState icon="tile" title="Nothing pending" hint="No open panel orders and no cut-piece items yet" />}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && orders.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
