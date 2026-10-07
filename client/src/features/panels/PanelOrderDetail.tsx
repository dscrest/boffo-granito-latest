/* ============================================================
   Panel Order detail (CR-287) — the ONE place a panel order changes
   status. Same split view as PanelDetail: DetailRail of orders on the
   left; right: header (panel · customer, status chip, forward-step
   buttons from PANEL_ORDER_TRANSITIONS, Edit, More, ✕), Overview |
   Activity tabs.
   Overview = order fields + the Requirements checklist (CR-288): one
   row per panel line × order qty vs cut-piece stock, an amber "Short:"
   note when pieces are missing, and a manual "Available" tick per row
   that the godown saves on the order (PanelOrder.checklist JSON).
   Forward-only: Ready ADDS stock and Dispatched DEDUCTS it, so there is
   no backward move (it would double-count). Dispatch is disabled while
   stock is short (the server 409s too).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Chip } from "@/ui/Chip";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt, fmtLocalDateTime } from "@/lib/format";
import { newestFirst } from "@/lib/dates";
import { ActivityLog, StatusTimeline, tabStyle } from "@/features/common/RecordDetail";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { DetailRail } from "@/features/common/DetailRail";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { ORDER_STATUS_TONE } from "./pcBits";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import {
  cachedCutStock,
  cachedPanelOrders,
  deletePanelOrder,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_ACTION_LABEL,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_TRANSITIONS,
  requirementsFor,
  saveChecklist,
  setPanelOrderStatus,
  shortageText,
  type PanelOrderRow,
  type PanelOrderStatus,
} from "./panelOrdersApi";

export function PanelOrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PanelOrderRow[] | null>(() => cachedPanelOrders());
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [busy, setBusy] = useState(false);
  // Local checklist so a tick shows at once; the save lands in the background.
  const [ticks, setTicks] = useState<Record<string, boolean> | null>(null);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "activity" ? "activity" : "overview";
  const setTab = (t: "overview" | "activity") => setSp(t === "overview" ? {} : { tab: t }, { replace: true });

  const load = async () => {
    const [o, p, s] = await Promise.all([listPanelOrders(), listPanels(), listCutStock()]);
    setOrders(o.ok ? o.orders : (cachedPanelOrders() ?? []));
    if (p.ok) setPanels(p.panels);
    if (s.ok) setStock(s.stock);
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => setTicks(null), [id]); // new record → forget the previous order's ticks

  const order = orders?.find((o) => o.id === id) ?? null;
  const panel = useMemo(() => panels.find((p) => p.id === order?.panelId), [panels, order?.panelId]);
  const reqs = order ? requirementsFor(order, panel, stock) : [];
  const short = reqs.filter((r) => r.short);
  const checklist = ticks ?? order?.checklist ?? {};

  if (orders === null) return <SkeletonRows rows={6} />;

  const move = async (to: PanelOrderStatus) => {
    if (!order) return;
    setBusy(true);
    const res = await setPanelOrderStatus(order.id, to);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not update the order");
      return;
    }
    toast.success(`Order moved to ${PANEL_ORDER_STATUS_LABEL[to]}`);
    await load();
  };

  const onDelete = async () => {
    if (!order) return;
    const reason = await confirmDelete({ message: `Delete this panel order (${order.panelCode} · ${order.customerName})? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const res = await deletePanelOrder(order.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Panel order deleted");
    navigate("/panel-orders");
  };

  const tick = async (key: string, on: boolean) => {
    if (!order) return;
    const next = { ...checklist, [key]: on };
    if (!on) delete next[key];
    setTicks(next);
    const res = await saveChecklist(order.id, next);
    if (!res.ok) {
      setTicks(checklist); // revert
      toast.error(res.error || "Could not save the checklist");
    }
  };

  const canEdit = can("panel_craft", "edit");
  const canDelete = !!order && can("panel_craft", "delete") && (order.status === "NewRequest" || order.status === "Received");
  const moreItems = canDelete ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : [];

  const railItems = newestFirst(orders).map((o) => ({
    id: o.id,
    to: `/panel-orders/${encodeURIComponent(o.id)}`,
    title: o.panelCode,
    subtitle: [o.customerName, PANEL_ORDER_STATUS_LABEL[o.status]].filter(Boolean).join(" · "),
    searchText: `${o.salesOrderNo} ${o.quoteNo} ${o.salesperson}`,
  }));

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <DetailRail placeholder="Search panel orders…" currentId={id} items={railItems} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {!order ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Panel order not found" hint="Pick an order from the list" />
          </div>
        ) : (
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${order.panelCode} · ${order.customerName}`}>
                {order.panelCode} <span className="dim" style={{ fontWeight: 500 }}>· {order.customerName}</span>
              </div>
              <Chip tone={ORDER_STATUS_TONE[order.status]} label={PANEL_ORDER_STATUS_LABEL[order.status]} />
              {/* Forward steps only — stock moves on Ready (+) and Dispatched (−). */}
              {canEdit &&
                PANEL_ORDER_TRANSITIONS[order.status].map((to) => {
                  const blocked = to === "Dispatched" && short.length > 0;
                  return (
                    <button
                      key={to}
                      className="hbtn primary"
                      disabled={busy || blocked}
                      title={blocked ? `${shortageText(short)} — start a cutting job or add stock first` : `Move to ${PANEL_ORDER_STATUS_LABEL[to]}`}
                      onClick={() => void move(to)}
                    >
                      <Icon name="check" size={13} />
                      {PANEL_ORDER_ACTION_LABEL[to]}
                    </button>
                  );
                })}
              {/* House rule: Edit is always visible. ponytail: no edit form — delete and raise again. */}
              <button className="hbtn" disabled title="Delete this order and raise it again to change the panel, quantity or date">
                <Icon name="edit" size={13} />
                Edit
              </button>
              <MoreMenu items={moreItems} />
              <button className="btn x" onClick={() => navigate("/panel-orders")} title="Close">
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
              {[order.orderDate && `Ordered ${order.orderDate}`, order.salesperson, order.salesOrderNo && `From ${order.salesOrderNo}`, order.quoteNo && `From ${order.quoteNo}`]
                .filter(Boolean)
                .join("  ·  ") || "—"}
            </div>

            <div className="row" style={{ gap: 4, marginTop: 12, borderBottom: "1px solid var(--border)" }}>
              <button onClick={() => setTab("overview")} style={tabStyle(tab === "overview")}>Overview</button>
              <button onClick={() => setTab("activity")} style={tabStyle(tab === "activity")}>Activity</button>
            </div>

            {tab === "overview" && (
              <>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
                  <div style={{ flex: "1 1 340px", minWidth: 280, maxWidth: 520 }}>
                    <div className="form-section-title" style={{ marginBottom: 8 }}>Order Details</div>
                    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>Panel</span>
                      <Link className="linkish mono" to={`/panels/${encodeURIComponent(order.panelId)}`} title="Open panel">{order.panelCode}</Link>
                    </div>
                    <DetailRow label="Customer" value={order.customerName} />
                    <DetailRow label="Quantity" value={`${fmt(order.qty)} panel${order.qty === 1 ? "" : "s"}`} />
                    <DetailRow label="Order Date" value={order.orderDate || "Not set"} dim={!order.orderDate} />
                    <DetailRow label="Sales Person" value={order.salesperson || "Not set"} dim={!order.salesperson} />
                    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>Source</span>
                      {order.salesOrderId ? (
                        <Link className="linkish mono" to={`/orders/${encodeURIComponent(order.salesOrderId)}`} title="Open Sales Order">{order.salesOrderNo || "Sales Order"}</Link>
                      ) : order.quoteId ? (
                        <Link className="linkish mono" to={`/quotes/${encodeURIComponent(order.quoteId)}`} title="Open Quote">{order.quoteNo || "Quote"}</Link>
                      ) : (
                        <span className="dim">Direct order</span>
                      )}
                    </div>
                    <DetailRow label="Created" value={fmtLocalDateTime(order.createdTime)} />
                    <DetailRow label="Modified" value={fmtLocalDateTime(order.modifiedTime)} />
                  </div>
                  <div style={{ flex: "0 1 340px", minWidth: 280, border: "1px solid var(--border)", borderRadius: 10, padding: 14, alignSelf: "flex-start" }}>
                    <div className="form-section-title" style={{ marginBottom: 8 }}>Panel</div>
                    <ImageThumb images={panel?.images ?? []} size={120} alt={order.panelCode} />
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
                      {[panel?.panelSize && `Panel: ${panel.panelSize}`, panel?.vinylSize && `Vinyl: ${panel.vinylSize}`].filter(Boolean).join("  ·  ") || "No sizes set"}
                    </div>
                  </div>
                </div>

                {/* CR-288: the godown checklist — what this order needs, what is on hand, and the manual Available tick. */}
                <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Requirements</div>
                {short.length > 0 && order.status !== "Dispatched" && (
                  <div style={{ fontSize: "var(--t-sm)", color: "var(--c-amber)", fontWeight: 600, marginBottom: 8 }}>{shortageText(short)}</div>
                )}
                <div style={{ overflow: "auto" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th>Cut Piece Size</th>
                        <th className="num" style={{ textAlign: "right" }}>Need</th>
                        <th className="num" style={{ textAlign: "right" }}>In Stock</th>
                        <th style={{ width: 90, textAlign: "center" }}>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reqs.map((r) => (
                        <tr key={r.key}>
                          <td>
                            <Link className="linkish" to={`/design/${encodeURIComponent(r.designId)}`} title="Open item">
                              <span className="design-name">{r.designName}</span>
                            </Link>
                          </td>
                          <td className="mono">{r.cutSizeName || <span className="dim">—</span>}</td>
                          <td className="num mono">{fmt(r.need)}</td>
                          <td className="num mono" style={{ color: r.short ? "var(--c-amber)" : undefined, fontWeight: r.short ? 600 : undefined }} title={r.short ? `Short by ${fmt(r.need - r.have)}` : undefined}>
                            {fmt(r.have)}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              aria-label={`${r.designName} ${r.cutSizeName} available`}
                              checked={!!checklist[r.key]}
                              disabled={!canEdit}
                              onChange={(e) => void tick(r.key, e.target.checked)}
                            />
                          </td>
                        </tr>
                      ))}
                      {reqs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>This panel has no designs yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === "activity" && (
              <div style={{ marginTop: 14 }}>
                <StatusTimeline entityType="PanelOrder" entityId={order.id} />
                <ActivityLog table="PanelOrder" entityId={order.id} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
