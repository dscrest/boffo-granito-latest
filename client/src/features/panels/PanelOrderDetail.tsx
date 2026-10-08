/* ============================================================
   Panel Order detail (CR-287, CR-302) — the ONE place a panel order
   changes status, on the shared RecordDetail (Sales Order parity):
   DetailRail of orders on the left; right: PNL number + status chip,
   customer link, right-aligned Edit · forward-step buttons from
   PANEL_ORDER_TRANSITIONS · More (Clone, Delete) · ✕; Details | Activity.
   Details = fields card, the Items card (one row per panel line) and the
   Requirements checklist (CR-288): one row per design × cut size summed
   across ALL lines vs cut-piece stock, a Panels column naming the panels
   each row serves with their share (CR-303), short In Stock figures in red
   (CR-305 — no "Short:" sentence on the card), and a manual "Available" tick per row that the godown
   saves on the order (PanelOrder.checklist JSON).
   CR-312: Allocated · Short columns + Allocate Stock (one modal, both
   directions) — Dispatch needs every piece BOOKED, not merely on hand.
   CR-313: Production Readiness card — MDF · Vinyl Printing · Cut Pieces
   marks (independent, any order, who/when stamped) + derived Overall.
   Edit / Delete only while New / Received (stock untouched); Edit stays
   visible but disabled afterwards (house rule). Forward-only: Ready ADDS
   stock (and books it to the order) and Dispatched DEDUCTS it.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Chip } from "@/ui/Chip";
import { Combobox } from "@/ui/Combobox";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { newestFirst } from "@/lib/dates";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { DetailRail } from "@/features/common/DetailRail";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedMdfs, listMdfs, type MdfRow } from "./mdfApi";
import { panelWeight } from "./panelOrderNeeds";
import { checkpointTone, READINESS_TONE } from "./pcBits";
import { AllocateCutStockModal } from "./AllocateCutStockModal";
import {
  allocatedByKey,
  CHECKPOINT_KEYS,
  CHECKPOINT_LABEL,
  CHECKPOINT_STATUSES,
  checkpointStatus,
  PANEL_ORDER_OPEN,
  readiness,
  setCheckpoint,
  type CheckpointKey,
  cachedCutWeights,
  cachedCutStock,
  cachedPanelOrders,
  deletePanelOrder,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_ACTION_LABEL,
  PANEL_ORDER_EDITABLE,
  PANEL_ORDER_LOCK_REASON,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_TRANSITIONS,
  requirementsFor,
  saveChecklist,
  setPanelOrderStatus,
  shortageText,
  type PanelOrderRow,
  type PanelOrderStatus,
} from "./panelOrdersApi";

/* RecordDetail chip classes (.chip.qstatus.q-*) — same palette the SO chip uses. */
const STATUS_CLS: Record<PanelOrderStatus, string> = {
  NewRequest: "q-draft",
  Received: "q-sent",
  InCutting: "q-accepted",
  Ready: "q-partial",
  Dispatched: "q-converted",
};

export function PanelOrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PanelOrderRow[] | null>(() => cachedPanelOrders());
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [weights, setWeights] = useState<Map<string, number | null>>(() => cachedCutWeights() ?? new Map());
  const [mdfs, setMdfs] = useState<MdfRow[]>(() => cachedMdfs());
  const [busy, setBusy] = useState(false);
  const [allocating, setAllocating] = useState(false); // CR-312 modal
  // Local checklist so a tick shows at once; the save lands in the background.
  const [ticks, setTicks] = useState<Record<string, boolean> | null>(null);

  const load = async () => {
    const [o, p, s, m] = await Promise.all([listPanelOrders(), listPanels(), listCutStock(), listMdfs()]);
    setOrders(o.ok ? o.orders : (cachedPanelOrders() ?? []));
    if (p.ok) setPanels(p.panels);
    if (s.ok) {
      setStock(s.stock);
      setWeights(s.weights);
    }
    if (m.ok) setMdfs(m.rows);
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => setTicks(null), [id]); // new record → forget the previous order's ticks

  const order = orders?.find((o) => o.id === id) ?? null;
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const mdfById = useMemo(() => new Map(mdfs.map((m) => [m.id, m])), [mdfs]);
  // CR-309: line weight = (Σ cut-piece weight × pieces + MDF) × qty; null until every piece is weighed.
  const lineWeight = (l: { panelId: string; qty: number; mdfId: string }): number | null => {
    const p = panelById.get(l.panelId);
    if (!p) return null;
    const w = panelWeight(p, weights, mdfById.get(l.mdfId)?.weightKg ?? null);
    return w == null ? null : w * l.qty;
  };
  const kg = (n: number) => `${Math.round(n * 100) / 100} kg`;
  const lineWeights = (order?.lines ?? []).map(lineWeight);
  const totalWeight = lineWeights.length && lineWeights.every((w) => w != null) ? lineWeights.reduce((s, w) => s + (w ?? 0), 0) : null;
  // CR-312: free = on hand − every open order's booking; this order's own booking rides on each row.
  const booked = useMemo(() => allocatedByKey(orders ?? []), [orders]);
  const reqs = order ? requirementsFor(order.lines, panelById, stock, { allocation: order.allocation, booked }) : [];
  const short = reqs.filter((r) => r.short);
  const unbooked = reqs.filter((r) => r.allocated < r.need);
  const unbookedPcs = unbooked.reduce((s, r) => s + r.need - r.allocated, 0);
  const isOpen = !!order && PANEL_ORDER_OPEN.has(order.status);
  const openReason = !order || isOpen ? "" : order.status === "Dispatched" ? "Order dispatched" : "Accept the request first";
  const checklist = ticks ?? order?.checklist ?? {};
  // CR-313: what each checkpoint has to cover, derived from the lines.
  const sumBy = (label: (l: PanelOrderRow["lines"][number]) => string) => {
    const m = new Map<string, number>();
    for (const l of order?.lines ?? []) m.set(label(l), (m.get(label(l)) ?? 0) + l.qty);
    return [...m.entries()].map(([k, q]) => `${k} ×${fmt(q)}`).join(" · ") || "—";
  };
  const cpText: Record<CheckpointKey, string> = {
    mdf: sumBy((l) => mdfById.get(l.mdfId)?.label || "No MDF picked"),
    vinyl: sumBy((l) => panelById.get(l.panelId)?.vinylSize || "No vinyl size"),
    cut: reqs.length
      ? `Booked ${fmt(reqs.reduce((s, r) => s + r.allocated, 0))} of ${fmt(reqs.reduce((s, r) => s + r.need, 0))} pcs${reqs.some((r) => r.toCut > 0) ? ` · cut ${fmt(reqs.reduce((s, r) => s + r.toCut, 0))} more` : ""}`
      : "—",
  };
  const overall = order ? readiness(order.checkpoints, order.status) : "Pending";

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
    const reason = await confirmDelete({ message: `Delete panel order ${order.orderNumber || ""} (${order.customerName})? This cannot be undone.` });
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

  // CR-313: one checkpoint mark; the server stamps who / when and mirrors it on the source sale.
  const mark = async (key: CheckpointKey, status: string) => {
    if (!order || status === checkpointStatus(order.checkpoints, key)) return;
    setBusy(true);
    const res = await setCheckpoint(order.id, key, status);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not save the checkpoint");
      return;
    }
    await load();
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
  const editable = !!order && PANEL_ORDER_EDITABLE.has(order.status);
  const lockReason = editable ? undefined : PANEL_ORDER_LOCK_REASON;

  const railItems = newestFirst(orders).map((o) => ({
    id: o.id,
    to: `/panel-orders/${encodeURIComponent(o.id)}`,
    title: o.orderNumber || "Panel Order",
    subtitle: [o.customerName, PANEL_ORDER_STATUS_LABEL[o.status]].filter(Boolean).join(" · "),
    searchText: `${o.lines.map((l) => l.panelCode).join(" ")} ${o.salesOrderNo} ${o.quoteNo} ${o.salesperson}`,
  }));

  const fields: RecordField[] = order
    ? [
        { key: "orderDate", label: "Order Date", value: order.orderDate || "Not set" },
        { key: "salesperson", label: "Sales Person", value: order.salesperson || "Not set" },
        { key: "source", label: "Source", value: order.salesOrderNo || order.quoteNo || "Direct order" },
        { key: "panels", label: "Panels", value: `${order.panelCount} panel${order.panelCount === 1 ? "" : "s"}` },
        { key: "qty", label: "Total Qty", value: `${fmt(order.totalQty)} pcs` },
        { key: "weight", label: "Total Weight", value: totalWeight == null ? "Not available — weigh every cut piece on Panel Items" : kg(totalWeight) },
      ]
    : [];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <DetailRail placeholder="Search panel orders…" currentId={id} items={railItems} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {!order ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Panel order not found" hint="Pick an order from the list" />
          </div>
        ) : (
          <RecordDetail
            backTo="/panel-orders"
            title={order.orderNumber || "Panel Order"}
            statusChip={{ label: PANEL_ORDER_STATUS_LABEL[order.status], cls: STATUS_CLS[order.status], title: short.length && order.status !== "Dispatched" ? shortageText(short) : undefined }}
            subtitle={
              order.customerCode ? (
                <Link className="linkish" to={`/parties/${encodeURIComponent(order.customerCode)}`} title="Open customer">
                  {order.customerName}
                </Link>
              ) : (
                order.customerName
              )
            }
            actions={
              <>
                {/* House rule: Edit is always visible — disabled with the reason once cutting starts. */}
                {canEdit && (
                  <button className="hbtn" disabled={busy || !editable} onClick={() => navigate(`/panel-orders/${encodeURIComponent(order.id)}/edit`)} title={lockReason || "Edit customer, panels & quantities"}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                )}
                {/* Forward steps only — stock moves on Ready (+) and Dispatched (−). CR-312: Dispatch needs every piece booked. */}
                {canEdit &&
                  PANEL_ORDER_TRANSITIONS[order.status].map((to) => {
                    const blocked = to === "Dispatched" && unbooked.length > 0;
                    return (
                      <button
                        key={to}
                        className="hbtn primary"
                        disabled={busy || blocked}
                        title={blocked ? `Book ${fmt(unbookedPcs)} more pcs first — Allocate Stock on the Requirements card` : `Move to ${PANEL_ORDER_STATUS_LABEL[to]}`}
                        onClick={() => void move(to)}
                      >
                        <Icon name="check" size={13} />
                        {PANEL_ORDER_ACTION_LABEL[to]}
                      </button>
                    );
                  })}
                <MoreMenu
                  items={[
                    ...(can("panel_craft", "create") ? [{ label: "Clone", onClick: () => navigate(`/panel-orders/${encodeURIComponent(order.id)}/clone`) }] : []),
                    ...(can("panel_craft", "delete")
                      ? [{ label: "Delete", danger: true, disabled: !editable, title: editable ? undefined : "Only a New or Received order can be deleted", onClick: () => void onDelete() }]
                      : []),
                  ]}
                />
              </>
            }
            fields={fields}
            hiddenStorageKey="panelOrderDetailFields"
            defaultHidden={["CREATEDTIME", "MODIFIEDTIME"]}
            hideFields
            activityTable="PanelOrder"
            entityId={order.id}
            created={order.createdTime}
            modified={order.modifiedTime}
          >
            {/* Items card — one row per panel line, the SO Items card shape. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>Items</span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {order.panelCount} panel{order.panelCount === 1 ? "" : "s"}
                </span>
                {(order.salesOrderId || order.quoteId) && (
                  <span className="muted" style={{ fontSize: 14, marginLeft: "auto" }}>
                    From{" "}
                    {order.salesOrderId ? (
                      <Link className="linkish mono" to={`/orders/${encodeURIComponent(order.salesOrderId)}`} title="Open Sales Order">{order.salesOrderNo || "Sales Order"}</Link>
                    ) : (
                      <Link className="linkish mono" to={`/quotes/${encodeURIComponent(order.quoteId)}`} title="Open Quote">{order.quoteNo || "Quote"}</Link>
                    )}
                  </span>
                )}
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>Image</th>
                      <th>Panel</th>
                      <th>Panel Size</th>
                      <th>Designs</th>
                      <th>MDF</th>
                      <th className="num" style={{ textAlign: "right" }}>Weight</th>
                      <th className="num" style={{ textAlign: "right" }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((l) => {
                      const p = panelById.get(l.panelId);
                      return (
                        <tr key={l.id}>
                          <td><ImageThumb images={p?.images ?? []} alt={l.panelCode} /></td>
                          <td className="mono">
                            <Link className="linkish" to={`/panels/${encodeURIComponent(l.panelId)}`} title="Open panel">{l.panelCode}</Link>
                          </td>
                          <td className="mono muted">{p?.panelSize || "—"}</td>
                          <td className="muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p?.lines.map((x) => x.designName).join(", ")}>
                            {p?.lines.map((x) => x.designName).join(", ") || "—"}
                          </td>
                          <td className="mono muted">{mdfById.get(l.mdfId)?.label || <span className="dim">—</span>}</td>
                          {(() => {
                            const w = lineWeight(l);
                            return <td className="num mono" title={w == null ? "Weigh every cut piece on Panel Items" : "Σ cut-piece weight × pieces + MDF, × qty"}>{w == null ? <span className="dim">—</span> : kg(w)}</td>;
                          })()}
                          <td className="num mono">{fmt(l.qty)}</td>
                        </tr>
                      );
                    })}
                    {order.lines.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>No panels on this order.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ fontWeight: 600 }}>Total</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{totalWeight == null ? <span className="dim">—</span> : kg(totalWeight)}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(order.totalQty)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* CR-313: Production Readiness — three independent checkpoints + the derived overall mark. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>Production Readiness</span>
                <span style={{ marginLeft: "auto" }} title="All three Ready → Ready for Production; any mark → In Progress">
                  <Chip tone={READINESS_TONE[overall]} label={overall} />
                </span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Checkpoint</th>
                      <th>Requirement</th>
                      <th style={{ width: 190 }}>Status</th>
                      <th>Marked by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHECKPOINT_KEYS.map((k) => {
                      const m = order.checkpoints[k];
                      const st = checkpointStatus(order.checkpoints, k);
                      return (
                        <tr key={k}>
                          <td style={{ fontWeight: 600 }}>{CHECKPOINT_LABEL[k]}</td>
                          <td className="muted" title={cpText[k]}>{cpText[k]}</td>
                          <td>
                            {canEdit && isOpen ? (
                              <Combobox
                                value={st}
                                options={CHECKPOINT_STATUSES[k].map((v) => ({ value: v, label: v }))}
                                onChange={(v) => void mark(k, v)}
                                ariaLabel={`${CHECKPOINT_LABEL[k]} status`}
                                disabled={busy}
                              />
                            ) : (
                              <span title={openReason || undefined}><Chip tone={checkpointTone(st)} label={st} /></span>
                            )}
                          </td>
                          <td className="muted mono" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap" }}>
                            {m ? `${m.by} · ${m.at.slice(0, 16)}` : <span className="dim">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CR-288: the godown checklist — what this order needs, what is on hand, booked (CR-312) and the manual Available tick. */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>Requirements</span>
                {/* CR-305: no "Short:" sentence here — the red In Stock figures say it. */}
                {/* CR-312: always visible for editors, greyed with the reason (house rule). */}
                {canEdit && (
                  <button
                    className="hbtn primary"
                    style={{ marginLeft: "auto" }}
                    disabled={busy || !isOpen || reqs.length === 0}
                    title={openReason || (reqs.length === 0 ? "No cut pieces required" : unbooked.length ? `Book free cut pieces to this order — ${fmt(unbookedPcs)} pcs still unbooked` : "Every piece is booked — open to release pieces")}
                    onClick={() => setAllocating(true)}
                  >
                    <Icon name="package" size={13} /> Allocate Stock
                  </button>
                )}
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Design</th>
                      <th>Cut Piece Size</th>
                      <th>Panels</th>
                      <th className="num" style={{ textAlign: "right" }}>Need</th>
                      <th className="num" style={{ textAlign: "right" }}>In Stock</th>
                      <th className="num" style={{ textAlign: "right" }}>Allocated</th>
                      <th className="num" style={{ textAlign: "right" }}>Short</th>
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
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>
                          {r.panels.map((p, i) => (
                            <span key={p.panelId}>
                              {i > 0 && <span className="dim"> · </span>}
                              <Link className="linkish" to={`/panels/${encodeURIComponent(p.panelId)}`} title="Open panel">{p.panelCode}</Link>
                              <span className="dim"> ×{fmt(p.qty)}</span>
                            </span>
                          ))}
                        </td>
                        <td className="num mono">{fmt(r.need)}</td>
                        <td className="num mono" style={{ color: r.short ? "var(--c-red)" : undefined, fontWeight: r.short ? 600 : undefined }} title={r.short ? `Short by ${fmt(r.need - r.have)}` : undefined}>
                          {fmt(r.have)}
                        </td>
                        <td className="num mono" style={{ color: r.allocated >= r.need ? "var(--c-green)" : undefined }} title={`Booked to this order · ${fmt(r.free)} free to book`}>
                          {fmt(r.allocated)}
                        </td>
                        <td className="num mono" style={r.toCut > 0 ? { color: "var(--c-red)", fontWeight: 600 } : undefined} title="Need − allocated − free: pieces that must still be cut for this order">
                          {r.toCut > 0 ? fmt(r.toCut) : <span className="dim">—</span>}
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
                        <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 18 }}>No cut pieces required — these panels have no designs yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {allocating && (
              <AllocateCutStockModal
                orderId={order.id}
                title={`${order.orderNumber || "Panel Order"} · ${order.customerName}`}
                reqs={reqs}
                onDone={() => void load()}
                onClose={() => setAllocating(false)}
              />
            )}
          </RecordDetail>
        )}
      </div>
    </div>
  );
}
