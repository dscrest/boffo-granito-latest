/* ============================================================
   Panel Orders (Panel Craft) — the cutting-job board. One card per
   PanelOrder across five stage columns:
     New Request → Received → In Cutting → Ready → Dispatched
   New Request (CR-286) = raised from a Quote / SO; Received = direct or
   accepted. Each open card carries a stock signal (green = cut-piece
   stock covers the order; red = short, with the missing pieces in the
   tooltip / Stock column — CR-288). Ready ADDS the job's cut pieces to
   stock, Dispatch DEDUCTS them — via the server status machine.
   CR-287: no stage buttons here — a row / card opens /panel-orders/:id
   where the status is changed. Kanban/Sheet toggle + New Order + Add Stock.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { ErrorCard, SkeletonRows, EmptyState } from "@/ui/States";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState, useViewState } from "@/lib/usePersistedState";
import { FilterSelect, IconBtn, ORDER_STATUS_TONE } from "./pcBits";
import { CutStockForm } from "./CutStockForm";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import {
  setCutPieceStock,
  cachedCutStock,
  cachedPanelOrders,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_STATUSES,
  shortagesFor,
  shortageText,
  type PanelOrderRow,
  type PanelOrderStatus,
  type Shortage,
} from "./panelOrdersApi";

/* Stage dots match the status-chip tones (pcBits ORDER_STATUS_TONE). */
const STAGE_COLOR: Record<PanelOrderStatus, string> = {
  NewRequest: "var(--muted)",
  Received: "var(--warn)",
  InCutting: "var(--blue)",
  Ready: "#0d9488",
  Dispatched: "var(--ok)",
};

/** A grid row = the order + its panel + the pieces it still lacks. */
type Row = PanelOrderRow & { panel?: PanelRow; shortages: Shortage[] };

const detailUrl = (id: string) => `/panel-orders/${encodeURIComponent(id)}`;
const stop = (e: React.MouseEvent) => e.stopPropagation();

/** Source sale link (CR-286) — SO or Quote number; "—" for a direct order. */
function SourceLink({ o }: { o: PanelOrderRow }) {
  if (o.salesOrderId)
    return <Link className="linkish mono" to={`/orders/${encodeURIComponent(o.salesOrderId)}`} onClick={stop} title="Open Sales Order">{o.salesOrderNo || "SO"}</Link>;
  if (o.quoteId)
    return <Link className="linkish mono" to={`/quotes/${encodeURIComponent(o.quoteId)}`} onClick={stop} title="Open Quote">{o.quoteNo || "Quote"}</Link>;
  return <span className="dim">—</span>;
}

/* Data-driven columns (grid standard). Created/Modified default-hidden. */
const PANEL_ORDER_COLUMNS: ColumnDef<Row>[] = [
  {
    key: "panel",
    label: "Panel",
    className: "mono",
    render: (o) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <ImageThumb images={o.panel?.images ?? []} alt={o.panelCode} />
        <Link className="linkish" to={`/panels/${encodeURIComponent(o.panelId)}`} onClick={stop} title="Open panel">{o.panelCode}</Link>
      </span>
    ),
  },
  { key: "customer", label: "Customer", render: (o) => o.customerName },
  { key: "qty", label: "Qty", className: "num mono", style: { textAlign: "right" }, render: (o) => fmt(o.qty) },
  { key: "date", label: "Order Date", className: "mono muted", render: (o) => o.orderDate || "—" },
  { key: "sales", label: "Sales Person", render: (o) => o.salesperson || "—" },
  {
    key: "status",
    label: "Status",
    render: (o) => <Chip tone={ORDER_STATUS_TONE[o.status]} label={codeOf(PANEL_ORDER_STATUS_LABEL[o.status])} title={PANEL_ORDER_STATUS_LABEL[o.status]} />,
  },
  {
    // CR-288 (5.1): the missing-items hint — "Short · n" with the pieces in the tooltip.
    key: "stock",
    label: "Stock",
    render: (o) =>
      o.status === "Dispatched" ? <span className="dim">—</span>
      : o.shortages.length ? <span style={{ color: "var(--c-amber)", fontWeight: 600, whiteSpace: "nowrap" }} title={shortageText(o.shortages)}>Short · {o.shortages.length}</span>
      : <span style={{ color: "var(--c-green)" }} title="Cut-piece stock covers this order">Covered</span>,
  },
  { key: "source", label: "Source", render: (o) => <SourceLink o={o} /> },
  { key: "created", label: "Created", className: "mono muted nw", render: (o) => fmtDateTime(o.createdTime) },
  { key: "modified", label: "Modified", className: "mono muted nw", render: (o) => fmtDateTime(o.modifiedTime) },
];

export function PanelOrders() {
  const navigate = useNavigate();
  // Opens on whatever Settings → Default view says.
  const [view, setView] = useViewState("panelOrders.view", "sheet" as const, "kanban" as const);
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [loading, setLoading] = useState(() => cachedPanelOrders() == null);
  const [error, setError] = useState<string | null>(null);
  const [showStock, setShowStock] = useState(false);
  const [query, setQuery] = usePersistedState("panelOrders.query", "");
  const [statusFilter, setStatusFilter] = useState("");
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("panelOrdersColumns", PANEL_ORDER_COLUMNS, ["created", "modified"]);

  const load = async () => {
    const [o, p, s] = await Promise.all([listPanelOrders(), listPanels(), listCutStock()]);
    setLoading(false);
    if (!o.ok) {
      setError(o.error || "Failed to load panel orders");
      return;
    }
    setError(null);
    setOrders(o.orders);
    if (p.ok) setPanels(p.panels);
    if (s.ok) setStock(s.stock);
  };

  useEffect(() => {
    void load();
  }, []);

  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);

  // Search + status filter apply to both views; every row carries its shortages once.
  const shown = useMemo((): Row[] => {
    const q = query.trim().toLowerCase();
    return orders
      .filter(
        (o) =>
          (!statusFilter || PANEL_ORDER_STATUS_LABEL[o.status] === statusFilter) &&
          (!q || o.panelCode.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || o.salesOrderNo.toLowerCase().includes(q) || o.quoteNo.toLowerCase().includes(q)),
      )
      .map((o) => {
        const panel = panelById.get(o.panelId);
        return { ...o, panel, shortages: shortagesFor(o, panel, stock) };
      });
  }, [orders, query, statusFilter, panelById, stock]);

  const onAdjust = async (design: string, cutSize: string, qty: number) => {
    const res = await setCutPieceStock(design, cutSize, qty);
    if (!res.ok) {
      toast.error(res.error || "Stock update failed");
      return;
    }
    setShowStock(false);
    toast.success(`Cut-piece stock updated — now ${fmt(res.data?.qty ?? 0)} pcs`);
    await load();
  };

  const sort = useSortRows(
    shown,
    (o, k) =>
      k === "qty" ? o.qty
      : k === "customer" ? o.customerName
      : k === "date" ? o.orderDate
      : k === "sales" ? o.salesperson
      : k === "status" ? PANEL_ORDER_STATUSES.indexOf(o.status)
      : k === "stock" ? o.shortages.length
      : k === "source" ? o.salesOrderNo || o.quoteNo
      : k === "created" ? o.createdTime
      : k === "modified" ? o.modifiedTime
      : o.panelCode,
    "created",
    -1, // newest first
  );
  const pager = usePagination(sort.sorted.length, "panelOrdersPageSize", `${query}|${statusFilter}`);
  const pageRows = pager.slice(sort.sorted);

  /** Whole row / card opens the order (CR-287) — status is changed there. */
  const openProps = (id: string) => ({
    tabIndex: 0,
    style: { cursor: "pointer" as const },
    onClick: () => navigate(detailUrl(id)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.target === e.currentTarget) navigate(detailUrl(id));
    },
  });

  const card = (o: Row) => {
    const done = o.status === "Dispatched";
    const { style, ...rest } = openProps(o.id);
    return (
      <div key={o.id} className="pc-job-card" style={{ display: "flex", gap: 10, ...style }} {...rest} title="Open panel order">
        <ImageThumb images={o.panel?.images ?? []} size={44} alt={o.panelCode} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {!done && (
              <span
                title={o.shortages.length ? shortageText(o.shortages) : "Cut-piece stock covers this order"}
                style={{ width: 8, height: 8, borderRadius: "50%", background: o.shortages.length ? "var(--danger)" : "var(--ok)", flexShrink: 0 }}
              />
            )}
            <Link className="linkish mono" style={{ fontWeight: 600 }} to={`/panels/${encodeURIComponent(o.panelId)}`} onClick={stop} title="Open panel">
              {o.panelCode}
            </Link>
            <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{fmt(o.qty)} panel{o.qty === 1 ? "" : "s"}</span>
          </div>
          <div style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.customerName}</div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
            {[o.orderDate, o.salesperson].filter(Boolean).join(" · ") || "—"}
          </div>
          {(o.salesOrderId || o.quoteId) && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
              From <SourceLink o={o} />
            </div>
          )}
          {!done && o.shortages.length > 0 && (
            <div style={{ fontSize: "var(--t-sm)", color: "var(--c-amber)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={shortageText(o.shortages)}>
              {shortageText(o.shortages)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const board = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${PANEL_ORDER_STATUSES.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto", marginTop: 12 }}>
      {PANEL_ORDER_STATUSES.map((stage) => {
        const cards = shown.filter((o) => o.status === stage);
        return (
          <div key={stage} className="card" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STAGE_COLOR[stage] }} />
              <span style={{ fontWeight: 600 }}>{PANEL_ORDER_STATUS_LABEL[stage]}</span>
              <span className="muted" style={{ fontSize: 14, marginLeft: "auto" }}>{cards.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
              {cards.map(card)}
              {cards.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  const sheet = (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              {visible.map((c) => (
                <SortTh key={c.key} id={c.key} label={c.label} sort={sort} className={c.className} style={c.style} />
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((o) => (
              <tr key={o.id} {...openProps(o.id)} title="Open panel order">
                {visible.map((c) => (
                  <td key={c.key} className={c.className} style={c.style}>
                    {c.render!(o)}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={visible.length}>
                  {orders.length > 0 ? (
                    <EmptyState title="No matching results" hint="Try a different filter" />
                  ) : (
                    <EmptyState title="No panel orders yet" hint="Record the first one with New Order" />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <GridFooter {...pager} />
    </div>
  );

  return (
    <div>
      {showStock && <CutStockForm onSave={(d, c, qty) => void onAdjust(d, c, qty)} onClose={() => setShowStock(false)} />}

      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span role="group" aria-label="Board view" title="Switch view" style={{ display: "inline-flex", gap: 4 }}>
          <IconBtn icon="kanban" title="Kanban view" active={view === "kanban"} onClick={() => setView("kanban")} />
          <IconBtn icon="orders" title="Sheet view" active={view === "sheet"} onClick={() => setView("sheet")} />
        </span>
        <span className="pc-divider" />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={PANEL_ORDER_STATUSES.map((s) => PANEL_ORDER_STATUS_LABEL[s])}
        />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search panel, customer or source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        {view === "sheet" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />}
        {can("panel_craft", "edit") && (
          <button className="btn" onClick={() => setShowStock(true)}>
            Add Stock
          </button>
        )}
        {can("panel_craft", "create") && (
          <button className="hbtn primary" onClick={() => navigate("/panel-orders/new")}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        )}
      </div>

      {loading && orders.length === 0 ? <div className="card"><SkeletonRows rows={6} /></div> : view === "kanban" ? board : sheet}
    </div>
  );
}
