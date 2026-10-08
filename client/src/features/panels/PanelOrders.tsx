/* ============================================================
   Panel Orders (Panel Craft) — the cutting-job board. One card per
   PanelOrder (CR-302: a customer order holding several panel lines,
   numbered PNL/FY/NNN) across five stage columns:
     New → Received → In Cutting → Ready → Dispatched
   New (status NewRequest) = where every order is born, direct or raised
   from a Quote / SO (CR-286/294); Received = accepted. Each open card
   carries a stock signal (green = Available; red = Unavailable, with the
   missing pieces in the tooltip / Stock column — CR-288/295). Ready ADDS the job's cut pieces to
   stock, Dispatch DEDUCTS them — via the server status machine.
   CR-312/313: Stock reads the BOOKING (what still has to be cut after
   booked + free); MDF · Vinyl Printing · Cut Pieces · Readiness columns
   show the production checkpoints.
   CR-287: no stage buttons here — a row / card opens /panel-orders/:id
   where the status is changed. Kanban/Sheet toggle + New Order + Add Stock (opens the bulk sheet, CR-307).
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
import { checkpointTone, FilterSelect, IconBtn, ORDER_STATUS_TONE, READINESS_TONE } from "./pcBits";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import {
  allocatedByKey,
  cachedCutStock,
  cachedPanelOrders,
  CHECKPOINT_LABEL,
  checkpointStatus,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_STATUSES,
  readiness,
  requirementsFor,
  shortageText,
  type CheckpointKey,
  type PanelOrderRow,
  type PanelOrderStatus,
  type Readiness,
  type Shortage,
} from "./panelOrdersApi";

const READINESS_ORDER: Readiness[] = ["—", "Pending", "In Progress", "Ready for Production"];

/* Stage dots match the status-chip tones (pcBits ORDER_STATUS_TONE). */
const STAGE_COLOR: Record<PanelOrderStatus, string> = {
  NewRequest: "var(--muted)",
  Received: "var(--warn)",
  InCutting: "var(--blue)",
  Ready: "#0d9488",
  Dispatched: "var(--ok)",
};

/** A grid row = the order + the first panel's thumb + the pieces it still lacks (CR-312: after booking + free). */
type Row = PanelOrderRow & { panel?: PanelRow; shortages: Shortage[]; readiness: Readiness };

/** CR-313: one checkpoint's status chip; dispatched orders read "—". */
function CpChip({ o, k }: { o: Row; k: CheckpointKey }) {
  if (o.status === "Dispatched") return <span className="dim">—</span>;
  const st = checkpointStatus(o.checkpoints, k);
  return <Chip tone={checkpointTone(st)} label={st} title={`${CHECKPOINT_LABEL[k]}: ${st}${o.checkpoints[k] ? ` · ${o.checkpoints[k]!.by}` : ""}`} />;
}

const panelCodes = (o: PanelOrderRow) => o.lines.map((l) => l.panelCode).join(", ");

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
  { key: "number", label: "Order No", className: "mono", render: (o) => o.orderNumber || "—" },
  { key: "customer", label: "Customer", render: (o) => o.customerName },
  {
    key: "panels",
    label: "Panels",
    render: (o) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 320 }}>
        <ImageThumb images={o.panel?.images ?? []} alt={o.orderNumber} />
        <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={panelCodes(o)}>
          {o.lines.map((l, i) => (
            <span key={l.id}>
              {i > 0 && ", "}
              <Link className="linkish" to={`/panels/${encodeURIComponent(l.panelId)}`} onClick={stop} title="Open panel">{l.panelCode}</Link>
            </span>
          ))}
          {o.lines.length === 0 && "—"}
        </span>
      </span>
    ),
  },
  { key: "qty", label: "Qty", className: "num mono", style: { textAlign: "right" }, render: (o) => fmt(o.totalQty) },
  { key: "date", label: "Order Date", className: "mono muted", render: (o) => o.orderDate || "—" },
  { key: "sales", label: "Sales Person", render: (o) => o.salesperson || "—" },
  {
    key: "status",
    label: "Status",
    render: (o) => <Chip tone={ORDER_STATUS_TONE[o.status]} label={codeOf(PANEL_ORDER_STATUS_LABEL[o.status])} title={PANEL_ORDER_STATUS_LABEL[o.status]} />,
  },
  // CR-313: the three production checkpoints + the derived overall readiness.
  { key: "mdf", label: "MDF", render: (o) => <CpChip o={o} k="mdf" /> },
  { key: "vinyl", label: "Vinyl Printing", render: (o) => <CpChip o={o} k="vinyl" /> },
  { key: "cutPieces", label: "Cut Pieces", render: (o) => <CpChip o={o} k="cut" /> },
  {
    key: "readiness",
    label: "Readiness",
    render: (o) => (o.readiness === "—" ? <span className="dim">—</span> : <Chip tone={READINESS_TONE[o.readiness]} label={o.readiness} title="MDF · Vinyl Printing · Cut Pieces all Ready → Ready for Production" />),
  },
  {
    // CR-288 (5.1): the missing-items hint — "Unavailable · n" (CR-295 wording) with the pieces in the tooltip.
    // CR-312: a row is short only when need exceeds booked + free (pieces that must still be cut).
    key: "stock",
    label: "Stock",
    render: (o) =>
      o.status === "Dispatched" ? <span className="dim">—</span>
      : o.shortages.length ? <span style={{ color: "var(--c-amber)", fontWeight: 600, whiteSpace: "nowrap" }} title={shortageText(o.shortages)}>Unavailable · {o.shortages.length}</span>
      : <span style={{ color: "var(--c-green)" }} title="Cut-piece stock available for this order">Available</span>,
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
  const booked = useMemo(() => allocatedByKey(orders), [orders]); // CR-312

  // Search + status filter apply to both views; every row carries its shortages once.
  const shown = useMemo((): Row[] => {
    const q = query.trim().toLowerCase();
    return orders
      .filter(
        (o) =>
          (!statusFilter || PANEL_ORDER_STATUS_LABEL[o.status] === statusFilter) &&
          (!q ||
            o.orderNumber.toLowerCase().includes(q) ||
            panelCodes(o).toLowerCase().includes(q) ||
            o.customerName.toLowerCase().includes(q) ||
            o.salesOrderNo.toLowerCase().includes(q) ||
            o.quoteNo.toLowerCase().includes(q)),
      )
      .map((o) => ({
        ...o,
        panel: panelById.get(o.lines[0]?.panelId ?? ""),
        shortages: requirementsFor(o.lines, panelById, stock, { allocation: o.allocation, booked }).filter((r) => r.toCut > 0),
        readiness: readiness(o.checkpoints, o.status),
      }));
  }, [orders, query, statusFilter, panelById, stock, booked]);


  const sort = useSortRows(
    shown,
    (o, k) =>
      k === "qty" ? o.totalQty
      : k === "panels" ? o.panelCount
      : k === "customer" ? o.customerName
      : k === "date" ? o.orderDate
      : k === "sales" ? o.salesperson
      : k === "status" ? PANEL_ORDER_STATUSES.indexOf(o.status)
      : k === "stock" ? o.shortages.length
      : k === "mdf" ? checkpointStatus(o.checkpoints, "mdf")
      : k === "vinyl" ? checkpointStatus(o.checkpoints, "vinyl")
      : k === "cutPieces" ? checkpointStatus(o.checkpoints, "cut")
      : k === "readiness" ? READINESS_ORDER.indexOf(o.readiness)
      : k === "source" ? o.salesOrderNo || o.quoteNo
      : k === "created" ? o.createdTime
      : k === "modified" ? o.modifiedTime
      : o.orderNumber,
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
        <ImageThumb images={o.panel?.images ?? []} size={44} alt={o.orderNumber} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {!done && (
              <span
                title={o.shortages.length ? shortageText(o.shortages) : "Cut-piece stock available for this order"}
                style={{ width: 8, height: 8, borderRadius: "50%", background: o.shortages.length ? "var(--danger)" : "var(--ok)", flexShrink: 0 }}
              />
            )}
            <span className="mono" style={{ fontWeight: 600 }}>{o.orderNumber || "Panel Order"}</span>
            <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{fmt(o.totalQty)} pcs · {o.panelCount} panel{o.panelCount === 1 ? "" : "s"}</span>
          </div>
          <div style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.customerName}</div>
          <div className="mono dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={panelCodes(o)}>
            {panelCodes(o) || "—"}
          </div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
            {[o.orderDate, o.salesperson].filter(Boolean).join(" · ") || "—"}
          </div>
          {!done && (
            <div style={{ marginTop: 4 }} title="MDF · Vinyl Printing · Cut Pieces">
              <Chip tone={READINESS_TONE[o.readiness]} label={o.readiness} />
            </div>
          )}
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
          <input type="text" placeholder="Search order, panel, customer or source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        {view === "sheet" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />}
        {can("panel_craft", "edit") && (
          <button className="btn" onClick={() => navigate("/cut-stock/record")} title="Bulk Add Stock sheet (CR-307)">
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
