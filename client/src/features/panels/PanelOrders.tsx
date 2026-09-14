/* ============================================================
   Panel Orders (Panel Craft) — the cutting-job board. One card per
   PanelOrder across four stage columns:
     Received → In Cutting → Ready → Dispatched
   Each Received card carries a stock signal (green = cut-piece stock
   covers the order → direct Dispatch; red = short → Start Cutting).
   Ready ADDS the job's cut pieces to stock, Dispatch DEDUCTS them —
   both via the server status machine (/panel-order-status).
   Kanban/Sheet toggle + New Order + Update Stock, PalPlans-style.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { ErrorCard, SkeletonRows, EmptyState } from "@/ui/States";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState, useViewState } from "@/lib/usePersistedState";
import { FilterSelect, IconBtn, ORDER_STATUS_TONE } from "./pcBits";
import { PanelOrderForm } from "./PanelOrderForm";
import { CutStockForm } from "./CutStockForm";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import {
  setCutPieceStock,
  cachedCutStock,
  cachedPanelOrders,
  createPanelOrder,
  deletePanelOrder,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_STATUSES,
  setPanelOrderStatus,
  shortagesFor,
  type PanelOrderInput,
  type PanelOrderRow,
  type PanelOrderStatus,
} from "./panelOrdersApi";

/* Stage dots match the status-chip tones (pcBits ORDER_STATUS_TONE). */
const STAGE_COLOR: Record<PanelOrderStatus, string> = {
  Received: "var(--warn)",
  InCutting: "var(--blue)",
  Ready: "#0d9488",
  Dispatched: "var(--ok)",
};

export function PanelOrders() {
  // Opens on whatever Settings → Default view says.
  const [view, setView] = useViewState("panelOrders.view", "sheet" as const, "kanban" as const);
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [loading, setLoading] = useState(() => cachedPanelOrders() == null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [query, setQuery] = usePersistedState("panelOrders.query", "");
  const [statusFilter, setStatusFilter] = useState("");

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

  // Search + status filter apply to both views.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (!statusFilter || PANEL_ORDER_STATUS_LABEL[o.status] === statusFilter) &&
        (!q || o.panelCode.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q)),
    );
  }, [orders, query, statusFilter]);

  const onCreate = async (input: PanelOrderInput) => {
    const res = await createPanelOrder(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    setShowNew(false);
    toast.success("Panel order saved");
    await load();
  };

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

  const onMove = async (o: PanelOrderRow, to: PanelOrderStatus) => {
    setBusyId(o.id);
    const res = await setPanelOrderStatus(o.id, to);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error || "Could not update the order");
      return;
    }
    toast.success(`Order moved to ${PANEL_ORDER_STATUS_LABEL[to]}`);
    await load();
  };

  const onDelete = async (o: PanelOrderRow) => {
    if (!(await confirmDialog({ message: `Delete this panel order (${o.panelCode} · ${o.customerName})? This cannot be undone.`, danger: true }))) return;
    const res = await deletePanelOrder(o.id);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Panel order deleted");
    await load();
  };

  const canEdit = can("panel_craft", "edit");

  const sort = useSortRows(
    shown,
    (o, k) =>
      k === "qty" ? o.qty
      : k === "customer" ? o.customerName
      : k === "date" ? o.orderDate
      : k === "sales" ? o.salesperson
      : k === "status" ? o.status
      : o.panelCode,
    "",
  );
  const pager = usePagination(sort.sorted.length, "panelOrdersPageSize", `${query}|${statusFilter}`);
  const pageRows = pager.slice(sort.sorted);

  /** The stage action for one order card/row (Received branches on stock). */
  const actionFor = (o: PanelOrderRow): { label: string; to: PanelOrderStatus } | null => {
    if (!canEdit) return null;
    const short = shortagesFor(o, panelById.get(o.panelId), stock);
    if (o.status === "Received") return short.length ? { label: "Start Cutting", to: "InCutting" } : { label: "Dispatch", to: "Dispatched" };
    if (o.status === "InCutting") return { label: "Ready", to: "Ready" };
    if (o.status === "Ready") return { label: "Dispatch", to: "Dispatched" };
    return null;
  };

  const card = (o: PanelOrderRow) => {
    const shortages = shortagesFor(o, panelById.get(o.panelId), stock);
    const action = actionFor(o);
    const done = o.status === "Dispatched";
    return (
      <div key={o.id} className="pc-job-card">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!done && (
            <span
              title={shortages.length ? `Short: ${shortages.map((s) => `${s.designName} ${s.cutSizeName} (${fmt(s.have)}/${fmt(s.need)})`).join(", ")}` : "Cut-piece stock covers this order"}
              style={{ width: 8, height: 8, borderRadius: "50%", background: shortages.length ? "var(--danger)" : "var(--ok)", flexShrink: 0 }}
            />
          )}
          <Link className="linkish mono" style={{ fontWeight: 600 }} to={`/panels/${encodeURIComponent(o.panelId)}`} title="Open panel">
            {o.panelCode}
          </Link>
          <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{fmt(o.qty)} panel{o.qty === 1 ? "" : "s"}</span>
          {o.status === "Received" && can("panel_craft", "delete") && (
            <button
              type="button"
              className="btn x"
              title="Delete order"
              aria-label="Delete order"
              style={{ padding: 2, height: 20, width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => void onDelete(o)}
            >
              ✕
            </button>
          )}
        </div>
        <div style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.customerName}</div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
          {[o.orderDate, o.salesperson].filter(Boolean).join(" · ") || "—"}
        </div>
        {action && (
          <button className="btn" style={{ marginTop: 8, width: "100%" }} disabled={busyId === o.id} onClick={() => void onMove(o, action.to)}>
            {busyId === o.id ? "Saving…" : action.label}
          </button>
        )}
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
              <SortTh id="panel" label="Panel" sort={sort} />
              <SortTh id="customer" label="Customer" sort={sort} />
              <SortTh id="qty" label="Qty" sort={sort} className="num" style={{ textAlign: "right" }} />
              <SortTh id="date" label="Order Date" sort={sort} />
              <SortTh id="sales" label="Sales Person" sort={sort} />
              <SortTh id="status" label="Status" sort={sort} />
              <th />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((o) => {
              const action = actionFor(o);
              return (
                <tr key={o.id}>
                  <td className="mono">
                    <Link className="linkish" to={`/panels/${encodeURIComponent(o.panelId)}`} title="Open panel">{o.panelCode}</Link>
                  </td>
                  <td>{o.customerName}</td>
                  <td className="num mono">{fmt(o.qty)}</td>
                  <td className="mono muted">{o.orderDate || "—"}</td>
                  <td>{o.salesperson || "—"}</td>
                  <td>
                    <Chip tone={ORDER_STATUS_TONE[o.status]} label={codeOf(PANEL_ORDER_STATUS_LABEL[o.status])} title={PANEL_ORDER_STATUS_LABEL[o.status]} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {action && (
                      <button className="btn" disabled={busyId === o.id} onClick={() => void onMove(o, action.to)}>
                        {busyId === o.id ? "Saving…" : action.label}
                      </button>
                    )}
                    {o.status === "Received" && can("panel_craft", "delete") && (
                      <span className="row-actions" style={{ marginLeft: 4 }}>
                        <IconBtn icon="trash" title="Delete order" danger onClick={() => void onDelete(o)} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7}>
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
      {showNew && <PanelOrderForm onSave={(i) => void onCreate(i)} onClose={() => setShowNew(false)} />}
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
          <input type="text" placeholder="Search panel or customer…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        {can("panel_craft", "edit") && (
          <button className="btn" onClick={() => setShowStock(true)}>
            Update Stock
          </button>
        )}
        {can("panel_craft", "create") && (
          <button className="hbtn primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        )}
      </div>

      {loading && orders.length === 0 ? <div className="card"><SkeletonRows rows={6} /></div> : view === "kanban" ? board : sheet}
    </div>
  );
}
