/* ============================================================
   Sample Order detail (CR-315/316) — the Panel Order detail shape on the
   shared RecordDetail: DetailRail of sample orders on the left; right:
   SMP number + status chip, customer link, right-aligned Edit · More
   (Print order PDF, Clone, Cancel Order, Delete) · ✕; Details | Readiness |
   Actions | Dispatch | Activity — the Panel Order detail's tabs (CR-485:
   loads are recorded on the Actions / Dispatch tabs, the header Record Load
   is gone). CR-486: More ▸ Print order PDF = the godown pick slip.
   Details = fields card + the Items card (one row per sample line with
   Requested · Supplied · Remaining · Last Supplied). Edit / Delete only
   while New (nothing supplied); Edit stays visible but disabled after.
   ============================================================ */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete, promptDialog } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { newestFirst } from "@/lib/dates";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { DetailRail } from "@/features/common/DetailRail";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { Chip } from "@/ui/Chip";
import { LOADING_TONE } from "./pcBits";
import { loadStatusOf, PanelLoadsTab, SampleActionsTab } from "./PanelLoads";
import { OrderReadinessTab, type ReadinessRow } from "./OrderReadinessTab";
import {
  cachedSampleOrders,
  cancelSampleOrder,
  deleteSampleOrder,
  listSampleOrders,
  remaining,
  SAMPLE_ORDER_EDITABLE,
  SAMPLE_ORDER_LOCK_REASON,
  SAMPLE_PIECE_LABEL,
  SAMPLE_STATUS_LABEL,
  type SampleOrderRow,
  type SampleOrderStatus,
} from "./sampleOrdersApi";

/* RecordDetail chip classes (.chip.qstatus.q-*) — same palette the SO chip uses. */
const STATUS_CLS: Record<SampleOrderStatus, string> = {
  New: "q-draft",
  PartiallySupplied: "q-partial",
  Supplied: "q-converted",
  Cancelled: "q-rejected",
};

export function SampleOrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SampleOrderRow[] | null>(() => cachedSampleOrders());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const o = await listSampleOrders();
    setOrders(o.ok ? o.orders : (cachedSampleOrders() ?? []));
  };
  useEffect(() => {
    void load();
  }, []);

  const order = orders?.find((o) => o.id === id) ?? null;
  if (orders === null) return <SkeletonRows rows={6} />;

  const onDelete = async () => {
    if (!order) return;
    const reason = await confirmDelete({ message: `Delete sample order ${order.orderNumber || ""} (${order.customerName})? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const res = await deleteSampleOrder(order.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Sample order deleted");
    navigate("/panel-orders?type=Sample");
  };

  // CR-368: cancel — reason mandatory for every role; only while nothing has gone out.
  const onCancel = async () => {
    if (!order) return;
    const reason = await promptDialog({
      title: "Cancel order",
      message: `Cancel sample order ${order.orderNumber || ""} (${order.customerName})?`,
      placeholder: "Reason for cancelling (required)",
      required: true,
      danger: true,
      confirmLabel: "Cancel order",
    });
    if (!reason) return;
    setBusy(true);
    const res = await cancelSampleOrder(order.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not cancel the order");
      return;
    }
    toast.success("Sample order cancelled");
    await load();
  };

  // CR-486: the godown pick slip — pdfmake lazy-loaded, like the Panel Order PDF (CR-474).
  const onPdf = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const { downloadSampleOrderPdf } = await import("./sampleOrderPdf");
      await downloadSampleOrderPdf(order);
    } catch {
      toast.error("Could not build the PDF");
    } finally {
      setBusy(false);
    }
  };

  const canEdit = can("panel_craft", "edit");
  const editable = !!order && SAMPLE_ORDER_EDITABLE.has(order.status);
  const lockReason = editable ? undefined : SAMPLE_ORDER_LOCK_REASON;
  const open = !!order && order.status !== "Supplied" && order.status !== "Cancelled"; // CR-368
  const cancellable = !!order && order.status === "New" && order.loads.length === 0;
  const loadable = order ? ({ ...order, type: "Sample" } as const) : null; // CR-347
  const loadStatus = loadable ? loadStatusOf(loadable) : "Not loaded";
  // CR-404: Readiness tab — a sample line has no marks or stock; its one stage is Supplied (= loaded).
  const readinessRows: ReadinessRow[] = (order?.lines ?? []).map((l) => ({
    key: l.id,
    code: [l.designName, l.pieceKind === "Cut" ? l.cutSizeName : SAMPLE_PIECE_LABEL[l.pieceKind]].filter(Boolean).join(" · "),
    qty: l.qty,
    stages: [{ name: "Supplied", done: remaining(l) === 0, applicable: true }],
  }));

  const railItems = newestFirst(orders).map((o) => ({
    id: o.id,
    to: `/sample-orders/${encodeURIComponent(o.id)}`,
    title: o.orderNumber || "Sample Order",
    subtitle: [o.customerName, SAMPLE_STATUS_LABEL[o.status]].filter(Boolean).join(" · "),
    searchText: `${o.lines.map((l) => l.designName).join(" ")} ${o.salesOrderNo} ${o.quoteNo} ${o.salesperson}`,
  }));

  const fields: RecordField[] = order
    ? [
        { key: "orderDate", label: "Order Date", value: order.orderDate || "Not set" },
        { key: "salesperson", label: "Sales Person", value: order.salesperson || "Not set" },
        { key: "source", label: "Source", value: order.salesOrderNo || order.quoteNo || "Direct order" },
        { key: "items", label: "Items", value: `${order.lines.length} item${order.lines.length === 1 ? "" : "s"}` },
        { key: "qty", label: "Requested", value: `${fmt(order.totalQty)} pcs` },
        { key: "supplied", label: "Supplied", value: `${fmt(order.suppliedQty)} of ${fmt(order.totalQty)} pcs` },
        { key: "note", label: "Notes", value: order.note || "—" },
      ]
    : [];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <DetailRail placeholder="Search sample orders…" currentId={id} items={railItems} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {!order ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Sample order not found" hint="Pick an order from the list" />
          </div>
        ) : (
          <RecordDetail
            backTo="/panel-orders?type=Sample"
            title={order.orderNumber || "Sample Order"}
            statusChip={{ label: SAMPLE_STATUS_LABEL[order.status], cls: STATUS_CLS[order.status] }}
            subtitle={
              <>
                {order.customerCode ? (
                  <Link className="linkish" to={`/parties/${encodeURIComponent(order.customerCode)}`} title="Open customer">
                    {order.customerName}
                  </Link>
                ) : (
                  order.customerName
                )}
                <span style={{ marginLeft: 8 }}>
                  <Chip tone={LOADING_TONE[loadStatus]} label={loadStatus} />
                </span>
              </>
            }
            actions={
              <>
                {/* House rule: Edit is always visible — disabled with the reason once samples went out. */}
                {canEdit && (
                  <button className="hbtn" disabled={busy || !editable} onClick={() => navigate(`/sample-orders/${encodeURIComponent(order.id)}/edit`)} title={lockReason || "Edit customer, items & quantities"}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                )}
                {/* CR-485: no Record Load here — loads are recorded on the Actions / Dispatch tabs, like a panel order. */}
                <MoreMenu
                  items={[
                    { label: "Print order PDF", disabled: busy, title: "The pick slip for the godown — items, remarks, a box per row for broken pieces", onClick: () => void onPdf() }, // CR-486
                    ...(can("panel_craft", "create") ? [{ label: "Clone", onClick: () => navigate(`/sample-orders/${encodeURIComponent(order.id)}/clone`) }] : []),
                    ...(canEdit
                      ? [{ label: "Cancel Order", danger: true, disabled: busy || !cancellable, title: cancellable ? "Cancel this order" : "Samples have gone out — delete the loads first, or the order is already closed", onClick: () => void onCancel() }]
                      : []),
                    ...(can("panel_craft", "delete")
                      ? [{ label: "Delete", danger: true, disabled: !editable, title: editable ? undefined : "Only a New order can be deleted", onClick: () => void onDelete() }]
                      : []),
                  ]}
                />
              </>
            }
            fields={fields}
            hiddenStorageKey="sampleOrderDetailFields"
            defaultHidden={["CREATEDTIME", "MODIFIEDTIME"]}
            hideFields
            activityTable="SampleOrder"
            entityId={order.id}
            created={order.createdTime}
            modified={order.modifiedTime}
            extraTabs={[
              { id: "readiness", label: "Readiness", content: <OrderReadinessTab rows={readinessRows} noun="items" /> }, // CR-404
              { id: "actions", label: "Actions", content: <SampleActionsTab order={order} onChanged={() => void load()} /> }, // CR-485
              ...(loadable ? [{ id: "dispatch", label: "Dispatch", content: <PanelLoadsTab order={loadable} onChanged={() => void load()} /> }] : []),
            ]}
          >
            {/* Items card — one row per sample line, the SO Items card shape. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">
                <span style={{ fontWeight: 600 }}>Samples</span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {order.lines.length} item{order.lines.length === 1 ? "" : "s"}
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
                      <th>Item</th>
                      <th>Piece</th>
                      <th>Cut Piece Size</th>
                      <th className="num" style={{ textAlign: "right" }}>Requested</th>
                      <th className="num" style={{ textAlign: "right" }}>Supplied</th>
                      <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                      <th>Last Supplied</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((l) => {
                      const rem = remaining(l);
                      return (
                        <tr key={l.id}>
                          <td><ImageThumb images={l.images} alt={l.designName} /></td>
                          <td>
                            <Link className="linkish" to={`/design/${encodeURIComponent(l.designId)}`} title="Open item">{l.designName}</Link>
                          </td>
                          <td>{SAMPLE_PIECE_LABEL[l.pieceKind]}</td>
                          <td className="mono muted">{l.pieceKind === "Cut" ? l.cutSizeName || "—" : <span className="dim">—</span>}</td>
                          <td className="num mono">{fmt(l.qty)}</td>
                          <td className="num mono">{fmt(l.suppliedQty)}</td>
                          <td className="num mono" style={rem > 0 ? { color: "var(--c-amber)", fontWeight: 600 } : undefined}>{fmt(rem)}</td>
                          <td className="mono muted">{l.suppliedOn || <span className="dim">—</span>}</td>
                          <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.note}>{l.note || <span className="dim">—</span>}</td>
                        </tr>
                      );
                    })}
                    {order.lines.length === 0 && (
                      <tr>
                        <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 18 }}>No samples on this order.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ fontWeight: 600 }}>Total</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(order.totalQty)}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(order.suppliedQty)}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(order.totalQty - order.suppliedQty)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </RecordDetail>
        )}
      </div>
    </div>
  );
}
