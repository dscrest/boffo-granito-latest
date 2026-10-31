/* ============================================================
   Panel Order detail (CR-287, CR-302) on the shared RecordDetail (Sales
   Order parity): DetailRail of orders on the left; right: CR-399 customer
   name as the title, PNL number small in the sub line + the Loading chip,
   right-aligned Edit · More (Clone, Cancel, Delete) · ✕; Details |
   Actions | Dispatch | Activity.
   CR-400: the header chip is the ONE derived status (panelProgress: New →
   Ready → Completed → Dispatched) — no Accept / Start Cutting / Ready
   buttons any more, the lifecycle column is dormant.
   Details = fields card, the Items card (one row per panel line: image,
   panel (i), weights, qty) and the Requirements checklist (CR-288): one row
   per design × cut size summed across ALL lines vs cut-piece stock, a
   Panels column naming the panels each row serves with their share
   (CR-303), short In Stock figures in red (CR-305), a manual "Available"
   tick per row that the godown saves on the order (PanelOrder.checklist).
   CR-312: Allocated · Short columns + Allocate Stock (one modal, both
   directions) — pieces load only once BOOKED.
   CR-402: the per-panel MDF · Vinyl · Pasted marks live on the Actions tab
   (PanelActionsTab) beside the loading rows; the order-level Cut Pieces
   card is gone (dormant mark). CR-368: Cancel Order (More menu, reason
   mandatory, no loads). Edit / Delete only while nothing is loaded; Edit
   stays visible but disabled afterwards (house rule).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { cachedSampleOrders, listSampleOrders, type SampleOrderRow } from "./sampleOrdersApi"; // CR-487
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Chip } from "@/ui/Chip";
import { toast } from "@/ui/Toast";
import { confirmDelete, promptDialog } from "@/ui/ConfirmDialog";
import { Combobox } from "@/ui/Combobox";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { SetLocationModal } from "@/features/common/SetLocationModal";
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
import { lineStages, lineWeightSplit, loadingStatus, loadProgress, pendingNeedLines, pendingText, stockKey, type ProgressRow } from "./panelOrderNeeds";
import { OrderReadinessTab } from "./OrderReadinessTab";
import { LOADING_TONE } from "./pcBits";
import { lineRate } from "./panelPrice";
import { moneyFor } from "@/features/quotes/quoteTemplate";
import { LineCell, PanelActionsTab, PanelLoadsTab, type LoadableOrder } from "./PanelLoads";
import {
  allocatedByKey,
  PANEL_ORDER_OPEN,
  panelProgress,
  cachedCutWeights,
  cachedCutStock,
  cachedPanelOrders,
  cancelPanelOrder,
  deletePanelOrder,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_EDITABLE,
  PANEL_ORDER_LOCK_REASON,
  PANEL_ORDER_STATUS_LABEL,
  requirementsFor,
  setPanelOrderLocation,
  shortageText,
  type PanelOrderRow,
} from "./panelOrdersApi";

/* CR-410: Set Location lives in common/SetLocationModal.tsx since CR-412 (shared with the pallet boards). */

/* CR-367/400: the header chip = the derived progress, on the RecordDetail chip palette (.chip.qstatus.q-*). */
const PROGRESS_CLS: Record<ReturnType<typeof panelProgress>, string> = {
  New: "q-draft",
  Ready: "q-partial",
  Completed: "q-accepted",
  Dispatched: "q-converted",
  Cancelled: "q-rejected",
};

export function PanelOrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PanelOrderRow[] | null>(() => cachedPanelOrders());
  const [samples, setSamples] = useState<SampleOrderRow[]>(() => cachedSampleOrders() ?? []); // CR-487: sample bookings count
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [mdfs, setMdfs] = useState<MdfRow[]>(() => cachedMdfs()); // CR-344
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [weights, setWeights] = useState<Map<string, number | null>>(() => cachedCutWeights() ?? new Map());
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false); // CR-410 Set Location modal
  const { enabled: whEnabled, nameOf: whName } = useWarehouses();

  const load = async () => {
    const [o, p, s, m, so] = await Promise.all([listPanelOrders(), listPanels(), listCutStock(), listMdfs(), listSampleOrders()]);
    setOrders(o.ok ? o.orders : (cachedPanelOrders() ?? []));
    if (so.ok) setSamples(so.orders);
    if (p.ok) setPanels(p.panels);
    if (m.ok) setMdfs(m.rows);
    if (s.ok) {
      setStock(s.stock);
      setWeights(s.weights);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const order = orders?.find((o) => o.id === id) ?? null;
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const mdfById = useMemo(() => new Map(mdfs.map((m) => [m.id, m])), [mdfs]); // CR-344
  type LineRow = PanelOrderRow["lines"][number];
  // CR-347/405: what is still pending to load, one row per line × piece kind + board — the need, booking and checklist all work on it.
  const progress = order ? loadProgress(order.lines, order.loads, panelById) : [];
  // CR-349/405: LIVE kg of ONE unit of a load row — a piece of that kind, or the line's board (null until weighed / a thickness is picked).
  const unitOf = (r: ProgressRow): number | null => {
    if (r.material === "Mdf") return mdfById.get(order?.lines.find((l) => l.id === r.lineId)?.mdfId ?? "")?.weightKg ?? null;
    return weights.get(stockKey(r.designId, r.cutSizeId)) ?? null;
  };
  // Per line: shipped kg are STAMPED on the loads (frozen); pending kg follow the master.
  const lineSplit = (l: LineRow) => lineWeightSplit(l.id, order?.loads ?? [], progress, unitOf);
  const lineWeight = (l: LineRow): number | null => {
    const s = lineSplit(l);
    if (s.pieces == null) return null;
    if (l.mdfId && s.mdf == null) return null;
    return s.pieces + (s.mdf ?? 0);
  };
  const kg = (n: number) => `${Math.round(n * 100) / 100} kg`;
  const kgOr = (n: number | null) => (n == null ? "—" : kg(n));
  const lineWeights = (order?.lines ?? []).map(lineWeight);
  const totalWeight = lineWeights.length && lineWeights.every((w) => w != null) ? lineWeights.reduce((s, w) => s + (w ?? 0), 0) : null;
  const sumPart = (k: "pieces" | "mdf") => {
    const parts = (order?.lines ?? []).map((l) => lineSplit(l)[k]).filter((v): v is number => v != null);
    return parts.length ? parts.reduce((s, v) => s + v, 0) : null;
  };
  const loadStatus = order ? loadingStatus(progress, order.status) : "Not loaded";
  const pending = pendingText(progress);
  // CR-312: free = on hand − every open order's booking; this order's own booking rides on each row.
  const booked = useMemo(() => allocatedByKey(orders ?? [], samples), [orders, samples]);
  const reqs = order ? requirementsFor(pendingNeedLines(order.lines, order.loads, panelById), panelById, stock, { allocation: order.allocation, booked }) : [];
  const short = reqs.filter((r) => r.short);
  const isOpen = !!order && PANEL_ORDER_OPEN.has(order.status);
  const openReason = !order || isOpen ? "" : order.status === "Cancelled" ? "Order cancelled" : "Order dispatched"; // CR-400: open from birth
  const overall = order ? panelProgress(order, reqs) : "New"; // CR-367/400: the ONE status
  const loadable: LoadableOrder | null = order ? { ...order, type: "Panel" } : null;
  // CR-404: Readiness tab rows — six stages per line; a loose cut piece names its design · size.
  const readinessRows = (order?.lines ?? []).map((l) => ({
    key: l.id,
    code: l.panelId ? l.panelCode : [l.designName, l.cutSizeName].filter(Boolean).join(" · ") || "Cut piece",
    qty: l.qty,
    stages: lineStages(l, order!, reqs, lineWeight(l) != null, panelById),
  }));

  if (orders === null) return <SkeletonRows rows={6} />;

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

  // CR-368: cancel — reason mandatory for every role; refused once anything is loaded.
  // CR-474: the PDF builder (pdfmake) is lazy-loaded so the page bundle stays light.
  const onPdf = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const { downloadPanelOrderPdf } = await import("./panelOrderPdf");
      await downloadPanelOrderPdf(order, panelById);
    } catch {
      toast.error("Could not build the PDF");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!order) return;
    const reason = await promptDialog({
      title: "Cancel order",
      message: `Cancel panel order ${order.orderNumber || ""} (${order.customerName})? Booked cut pieces return to free stock.`,
      placeholder: "Reason for cancelling (required)",
      required: true,
      danger: true,
      confirmLabel: "Cancel order",
    });
    if (!reason) return;
    setBusy(true);
    const res = await cancelPanelOrder(order.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not cancel the order");
      return;
    }
    toast.success("Panel order cancelled");
    await load();
  };

  const canEdit = can("panel_craft", "edit");
  // CR-347: once a load is recorded the lines are frozen too (a load line would dangle).
  const editable = !!order && PANEL_ORDER_EDITABLE.has(order.status) && order.loads.length === 0;
  // CR-368: cancellable while nothing has shipped — mirrors the server PANEL_ORDER_CANCELLABLE.
  const cancellable = !!order && (order.status === "NewRequest" || isOpen) && order.loads.length === 0;
  const lockReason = editable ? undefined : order?.loads.length ? "Pieces have been loaded — remove the loads to change the order" : PANEL_ORDER_LOCK_REASON;

  const railItems = newestFirst(orders).map((o) => ({
    id: o.id,
    to: `/panel-orders/${encodeURIComponent(o.id)}`,
    // CR-399: customer first, PNL number small (the SO rail's PO-first shape, CR-353).
    title: o.customerName || o.orderNumber || "Panel Order",
    subtitle: [o.orderNumber, PANEL_ORDER_STATUS_LABEL[o.status]].filter(Boolean).join(" · "),
    searchText: `${o.lines.map((l) => l.panelCode).join(" ")} ${o.salesOrderNo} ${o.quoteNo} ${o.salesperson}`,
  }));

  const fields: RecordField[] = order
    ? [
        { key: "orderDate", label: "Order Date", value: order.orderDate || "Not set" },
        { key: "salesperson", label: "Sales Person", value: order.salesperson || "Not set" },
        { key: "source", label: "Source", value: order.salesOrderNo || order.quoteNo || "Direct order" },
        { key: "panels", label: "Panels", value: `${order.panelCount} panel${order.panelCount === 1 ? "" : "s"}` },
        { key: "qty", label: "Total Qty", value: `${fmt(order.totalQty)} pcs` },
        {
          key: "weight",
          label: "Total Weight",
          value: totalWeight == null ? "Not available — weigh every cut piece on Panel Items" : `${kg(totalWeight)} (pieces ${kgOr(sumPart("pieces"))} · MDF ${kgOr(sumPart("mdf"))})`,
        },
        { key: "loading", label: "Loading", value: pending ? `${loadStatus} — pending ${pending}` : loadStatus },
        // CR-410: where the panels sit — "Warehouse ▸ Location"; hidden while the feature is dormant.
        ...(whEnabled ? [{ key: "location", label: "Location", value: order.warehouseId ? whName(order.warehouseId) : "Not set" }] : []),
      ]
    : [];

  // CR-410: Set Location → generic PATCH on PanelOrder.warehouse; the activity row comes free.
  const onSetLocation = async (id: string) => {
    if (!order) return;
    const res = await setPanelOrderLocation(order.id, id);
    if (!res.ok) {
      toast.error(res.error || "Could not save the location");
      return;
    }
    toast.success(id ? `Panels placed at ${whName(id)}` : "Location cleared");
    setLocating(false);
    await load();
  };

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
            title={order.customerName || order.orderNumber || "Panel Order"}
            statusChip={{ label: overall, cls: PROGRESS_CLS[overall], title: short.length && isOpen ? shortageText(short) : overall === "New" ? "Every panel's MDF · Vinyl · Pasted must be Ready" : overall === "Ready" ? "Book the cut pieces on the Actions tab" : undefined }}
            subtitle={
              <>
                {/* CR-399: the PNL number rides small; the customer link keeps its hop. */}
                <span className="mono">{order.orderNumber || "Panel Order"}</span>
                {order.customerCode && (
                  <>
                    <span className="dim"> · </span>
                    <Link className="linkish" to={`/parties/${encodeURIComponent(order.customerCode)}`} title="Open customer">Open customer</Link>
                  </>
                )}
                {/* CR-347: Loading Status beside the status — separate columns, like the SO roll-up. */}
                <span style={{ marginLeft: 8 }}>
                  <Chip tone={LOADING_TONE[loadStatus]} label={loadStatus} title={pending ? `Pending: ${pending}` : "Everything loaded"} />
                </span>
              </>
            }
            actions={
              <>
                {/* House rule: Edit is always visible — disabled with the reason once cutting starts. */}
                {canEdit && (
                  <button className="hbtn" disabled={busy || !editable} onClick={() => navigate(`/panel-orders/${encodeURIComponent(order.id)}/edit`)} title={lockReason || "Edit customer, panels & quantities"}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                )}
                {/* CR-400: no stage buttons — the status derives from the marks, the booking and the loads. */}
                <MoreMenu
                  items={[
                    // CR-474: on-demand PDF — cover page + one page per panel with its photo and cut pieces.
                    { label: "Print order PDF", disabled: busy, onClick: () => void onPdf() },
                    ...(can("panel_craft", "create") ? [{ label: "Clone", onClick: () => navigate(`/panel-orders/${encodeURIComponent(order.id)}/clone`) }] : []),
                    // CR-410: place the panels at a location (open orders only; hidden while no warehouse exists).
                    ...(canEdit && whEnabled ? [{ label: "Set Location", disabled: busy || !isOpen, title: isOpen ? "Where this order's panels sit" : openReason, onClick: () => setLocating(true) }] : []),
                    ...(canEdit
                      ? [{
                          label: "Cancel Order",
                          danger: true,
                          disabled: busy || !cancellable,
                          title: cancellable ? "Cancel this order — booked pieces return to free stock" : order.loads.length ? "Pieces have been loaded — delete the loads in the Dispatch tab first" : `Order ${PANEL_ORDER_STATUS_LABEL[order.status].toLowerCase()}`,
                          onClick: () => void onCancel(),
                        }]
                      : []),
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
            extraTabs={[
              { id: "readiness", label: "Readiness", content: <OrderReadinessTab rows={readinessRows} noun="panels" loadStage="Loaded" /> }, // CR-404
              {
                id: "actions",
                label: "Actions",
                content: <PanelActionsTab order={order} panelsById={panelById} stock={stock} reqs={reqs} onChanged={() => void load()} />, // CR-365
              },
              {
                id: "dispatch",
                label: "Dispatch",
                content: <PanelLoadsTab order={{ ...order, type: "Panel" }} panelsById={panelById} stock={stock} unitOf={unitOf} onChanged={() => void load()} />,
              },
            ]}
          >
            {locating && <SetLocationModal value={order.warehouseId} onSave={onSetLocation} onClose={() => setLocating(false)} />}
            {/* Items card — one row per panel / cut-piece line, the SO Items card shape.
                CR-377: size, designs and the MDF spec sit behind the (i) card (the same LineCell as the
                Actions / Dispatch tabs); CR-402: the MDF · Vinyl · Pasted marks moved to the Actions tab. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">
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
                      <th className="num" style={{ textAlign: "right" }}>Pieces kg</th>
                      <th className="num" style={{ textAlign: "right" }}>MDF kg</th>
                      <th className="num" style={{ textAlign: "right" }}>Total kg</th>
                      <th className="num" style={{ textAlign: "right" }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((l) => {
                      const p = panelById.get(l.panelId);
                      const sp = lineSplit(l);
                      const w = lineWeight(l);
                      const shipped = order.loads.some((ld) => ld.lines.some((x) => x.lineId === l.id));
                      const kgTitle = shipped ? "Shipped kg are frozen on the load; pending kg follow the master" : "Follows the master until loaded";
                      return [
                        <tr key={l.id}>
                          <td><ImageThumb images={p?.images ?? []} alt={l.panelCode} /></td>
                          <td className="mono">
                            {/* CR-377: short label + (i) → size · vinyl · MDF · designs in the InfoTag card */}
                            <LineCell
                              label={
                                l.panelId ? (
                                  <Link className="linkish" to={`/panels/${encodeURIComponent(l.panelId)}`} title="Open panel">{l.panelCode}</Link>
                                ) : (
                                  <span className="muted" title="A loose cut piece (CR-346)">{[l.designName, l.cutSizeName].filter(Boolean).join(" · ") || "Cut piece"}</span>
                                )
                              }
                              o={loadable!}
                              lineId={l.id}
                              panelsById={panelById}
                            />
                          </td>
                          <td className="num mono" title={kgTitle}>{sp.pieces == null ? <span className="dim">—</span> : kg(sp.pieces)}</td>
                          <td className="num mono" title={kgTitle}>{!l.mdfId ? <span className="dim">—</span> : sp.mdf == null ? <span className="dim">—</span> : kg(sp.mdf)}</td>
                          <td className="num mono" title={w == null ? "Weigh every cut piece on Panel Items" : kgTitle}>{w == null ? <span className="dim">—</span> : kg(w)}</td>
                          <td className="num mono">{fmt(l.qty)}</td>
                        </tr>,
                      ];
                    })}
                    {order.lines.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>No panels on this order.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ fontWeight: 600 }}>Total</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{kgOr(sumPart("pieces"))}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{kgOr(sumPart("mdf"))}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{totalWeight == null ? <span className="dim">—</span> : kg(totalWeight)}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(order.totalQty)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <PricingCard lines={order.lines} amount={order.amount} />

          </RecordDetail>
        )}
      </div>
    </div>
  );
}

/** CR-504: the ₹ frozen on each line at save — Vinyl · MDF · Cut pieces per ONE panel, × qty. Informative;
    prices change on Edit. A line saved before pricing reads "—" until the order is edited and saved. */
function PricingCard({ lines, amount }: { lines: PanelOrderRow["lines"]; amount: number | null }) {
  const money = moneyFor("INR");
  const cell = (v: number | null, title?: string) => (v == null ? <span className="dim" title="Edit and save the order to price it">—</span> : <span title={title}>{money(v)}</span>);
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head">
        <span style={{ fontWeight: 600 }}>Pricing</span>
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Panel</th>
              <th className="num" style={{ textAlign: "right" }}>Vinyl</th>
              <th className="num" style={{ textAlign: "right" }}>MDF</th>
              <th className="num" style={{ textAlign: "right" }}>Cut Pieces</th>
              <th className="num" style={{ textAlign: "right" }}>Rate</th>
              <th className="num" style={{ textAlign: "right" }}>Qty</th>
              <th className="num" style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const priced = lineRate(l) != null;
              const cut = !l.panelId;
              return (
                <tr key={l.id}>
                  <td className="mono">{l.panelId ? l.panelCode : [l.designName, l.cutSizeName].filter(Boolean).join(" · ") || "Cut piece"}</td>
                  <td className="num mono">{cut && priced ? <span className="dim">—</span> : cell(l.vinylPrice)}</td>
                  <td className="num mono">{cut && priced ? <span className="dim">—</span> : cell(l.mdfPrice)}</td>
                  <td className="num mono">{cell(l.piecesPrice)}</td>
                  <td className="num mono">{cell(lineRate(l), "Price of one panel / piece")}</td>
                  <td className="num mono">{fmt(l.qty)}</td>
                  <td className="num mono">{cell(l.amount)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} style={{ fontWeight: 600 }}>Total</td>
              <td className="num mono" style={{ fontWeight: 600 }}>{cell(amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
