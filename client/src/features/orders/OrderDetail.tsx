/* Sales Order detail — header + all line items of the order.
   "Send to Palletization" (inline button or the header More menu) opens the
   PalPlan screen scoped to this order (/packing?fromOrder=). */
import { codeOf } from "@/ui/statusCode";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fmt, finishClass } from "@/lib/format";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog, promptDialog } from "@/ui/ConfirmDialog";
import { can, canApprove } from "@/lib/auth";
import { type Order, type Quote } from "@/data";
import { ContainerPlanCard } from "@/features/quotes/ContainerPlanCard";
import { QuotePrint } from "@/features/quotes/QuotePrint";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { deleteSalesOrder, listOrders, loadStatus, palStatus, setOrderStatus, soLiveStatus, soStatusLabel } from "./ordersApi";
import { listOrderBatches } from "@/features/stages/palletisationApi";
import { listPalPlans, palLineStatusLabel } from "@/features/stages/palPlansApi";
import { DispatchTab, dispatchRows, dispatchedByDesign } from "@/features/stages/DispatchTab";
import { SendToLoadingModal } from "@/features/stages/SendToLoadingModal";
import { groupReady } from "@/features/stages/newLoadingRows";
import { deallocateStock, listProductionLogs, stageChip, type AllocEntry, type ProductionEntry } from "@/features/stages/productionApi";
import { AllocateStockModal } from "./AllocateStockModal";
import { ChangeStatusModal } from "./ChangeStatusModal";
import { useOrders } from "./useOrders";
import { useStockLookup } from "@/features/masters/LineStock";
import { lineSupplies } from "@/lib/needProduction";
import { useMasters } from "@/features/masters/useMasters";

// Boxes produced on THIS order still waiting to be palletised — drives the
// palletise selection/checkboxes only. NOT the sellable "Available" figure
// (that's designStock.available on the Item master; CR-164 dropped the
// In Production / Available columns from this page).
const toPalletise = (o: Order) => Math.max(0, o.producedQty - o.palletizedQty);

function SoProduction({ salesOrderId, onChanged }: { salesOrderId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<ProductionEntry[] | null>(null);
  // Stock allocated to this order (CR-199) — the production-first supply trail.
  const [allocs, setAllocs] = useState<AllocEntry[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void listProductionLogs().then((res) => {
      if (!alive) return;
      setRows(res.ok ? res.entries.filter((e) => e.salesOrderId === salesOrderId) : []);
      setAllocs(res.ok ? res.allocEntries.filter((a) => a.salesOrderId === salesOrderId) : []);
    });
    return () => {
      alive = false;
    };
  }, [salesOrderId, tick]);
  const onDeallocate = async (a: AllocEntry) => {
    if (!(await confirmDialog({ title: "De-allocate stock", message: `Return ${fmt(a.qtyBoxes)} boxes of ${a.design}${a.batchNumber ? ` (batch ${a.batchNumber})` : ""} to free stock?`, confirmLabel: "De-allocate", danger: true }))) return;
    const res = await deallocateStock(a.id);
    if (!res.ok) {
      toast.error(res.error || "Could not de-allocate");
      return;
    }
    toast.success(`${fmt(a.qtyBoxes)} boxes returned to free stock`);
    setTick((t) => t + 1);
    onChanged();
  };

  if (rows == null) return <div className="muted mono" style={{ padding: 18 }}>Loading production…</div>;
  return (
    <>
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Allocated on</th>
              <th>Design</th>
              <th>Batch</th>
              <th className="num" style={{ textAlign: "right" }}>Boxes</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {allocs.map((a) => (
              <tr key={a.id}>
                <td className="mono muted nw">{a.createdTime.slice(0, 10) || "—"}</td>
                <td><span className="design-name">{a.design}</span></td>
                <td className="nw">{a.batchNumber ? <span className="chip mono">{a.batchNumber}</span> : <span className="dim">—</span>}</td>
                <td className="num mono" style={{ color: "var(--c-green)" }}>{fmt(a.qtyBoxes)}</td>
                <td className="muted nw">{a.performedBy || "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {can("stages", "edit") && (
                    <button type="button" className="btn ord-rm" title="De-allocate — return these boxes to free stock" onClick={() => void onDeallocate(a)}>✕</button>
                  )}
                </td>
              </tr>
            ))}
            {allocs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  No stock allocated to this order yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    {rows.length > 0 && (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Design</th>
              <th>Size</th>
              <th>Batch</th>
              <th>Status</th>
              <th className="num" style={{ textAlign: "right" }}>Requested</th>
              <th className="num" style={{ textAlign: "right" }}>Produced</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = stageChip(e.stage);
              const lastRec = e.records[e.records.length - 1];
              const date = e.productionDate || lastRec?.productionDate || e.createdTime.slice(0, 10);
              const batches = [...new Set(e.records.map((r) => r.batchNumber).filter(Boolean))];
              if (!batches.length && e.batchNumber) batches.push(e.batchNumber);
              return (
                <tr key={e.id}>
                  <td className="mono muted nw">{date || "—"}</td>
                  <td><span className="design-name">{e.design}</span></td>
                  <td className="nw">{e.size ? <span className={`chip size ${e.size.startsWith("200") || e.size.startsWith("75") ? "b" : ""}`}>{e.size}</span> : "—"}</td>
                  <td className="nw">
                    {batches.length
                      ? batches.map((b) => <span key={b} className="chip mono" style={{ marginRight: 4 }}>{b}</span>)
                      : <span className="dim">—</span>}
                  </td>
                  <td className="nw"><span className="chip" style={{ color: s.color }} title={s.label}>{codeOf(s.label)}</span></td>
                  <td className="num mono">{fmt(e.qtyRequested)}</td>
                  <td className="num mono">{e.producedSoFar ? <span style={{ color: "var(--c-green)" }}>{fmt(e.producedSoFar)}</span> : <span className="dim">—</span>}</td>
                  <td className="muted nw">{e.performedBy || lastRec?.performedBy || "—"}</td>
                  <td className="muted" style={{ maxWidth: 240 }}><span className="clip" title={e.note}>{e.note || "—"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    )}
    </>
  );
}

/** Palletisation committed against this Sales Order (parallel to the
    Production tab). Sourced from the current PalPlan flow (PalletizationPlan
    lines — this is what /packing writes); legacy PalletisedBatch rows are
    appended so pre-rework history still shows. */
type SoPalRow = {
  key: string;
  pal: string; // PAL/FY/NNN ("" for legacy rows) — tooltip only since CR-165
  planId: string; // "" for legacy rows (no detail page)
  date: string;
  design: string;
  batch: string; // production batch ("" = legacy aggregate) — CR-180
  pallet: string; // pallet format name (tooltip)
  pallets: number | null; // boxes ÷ boxes-per-pallet, fractional (null = unknown format)
  boxes: number;
  status: string;
};

/** One-decimal pallet count: 9 → "9", 0.5 → "0.5". */
const fmtPallets = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function SoPalletisation({ salesOrderId }: { salesOrderId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SoPalRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([listPalPlans(), listOrderBatches(salesOrderId)]).then(([plansRes, legacy]) => {
      if (!alive) return;
      const boxById = new Map(plansRes.boxes.map((b) => [b.id, b]));
      const planRows: SoPalRow[] = plansRes.plans.flatMap((p) =>
        p.lines
          .filter((l) => l.salesOrderId === salesOrderId)
          .map((l) => {
            // Same derivation as the board's stageOf: box status wins, then the line's own status.
            const box = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
            const status = palLineStatusLabel(l, box?.status, p.status);
            return {
              key: l.id,
              pal: p.palNumber,
              planId: p.id,
              date: p.plannedDate || p.createdTime.slice(0, 10),
              design: l.designLabel,
              batch: l.batchNumber,
              pallet: l.palletName,
              pallets: l.boxesPerPallet > 0 ? l.boxes / l.boxesPerPallet : null,
              boxes: l.boxes,
              status,
            };
          }),
      );
      const legacyRows: SoPalRow[] = (legacy.ok ? legacy.rows : []).map((b) => ({
        key: `batch-${b.batchId}`, pal: "", planId: "", date: b.date, design: b.design, batch: b.batchNumber, pallet: b.pallet, pallets: null, boxes: b.boxes, status: b.status,
      }));
      setRows([...planRows, ...legacyRows]);
    });
    return () => {
      alive = false;
    };
  }, [salesOrderId]);

  if (rows == null) return <div className="muted mono" style={{ padding: 18 }}>Loading palletization…</div>;
  const totalBoxes = rows.reduce((s, r) => s + r.boxes, 0);
  const totalPallets = rows.reduce((s, r) => s + (r.pallets ?? 0), 0);
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Design</th>
              <th>Batch</th>
              <th>Palletization Date</th>
              <th className="num" style={{ textAlign: "right" }}>Pallets</th>
              <th className="num" style={{ textAlign: "right" }}>Boxes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.key}
                title={[b.pal, b.pallet].filter(Boolean).join(" · ") || undefined}
                tabIndex={b.planId ? 0 : undefined}
                style={b.planId ? { cursor: "pointer" } : undefined}
                onClick={() => b.planId && navigate(`/packing/${encodeURIComponent(b.planId)}`)}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && b.planId && navigate(`/packing/${encodeURIComponent(b.planId)}`)}
              >
                <td><span className="design-name">{b.design}</span></td>
                <td className="nw">{b.batch ? <span className="chip mono">{b.batch}</span> : <span className="dim">—</span>}</td>
                <td className="mono muted">{b.date}</td>
                <td className="num mono">{b.pallets == null ? <span className="dim">—</span> : fmtPallets(b.pallets)}</td>
                <td className="num mono">{fmt(b.boxes)}</td>
                <td><span className="chip" title={b.status}>{codeOf(b.status)}</span></td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  Nothing palletised against this order yet.
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={3} style={{ fontWeight: 500 }}>Total</td>
                <td className="num mono" style={{ fontWeight: 500 }}>{fmtPallets(totalPallets)}</td>
                <td className="num mono" style={{ fontWeight: 500 }}>{fmt(totalBoxes)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Container Planning tab — the plan card, with each container marked Sent /
    Partially sent / Planned from what has actually left the loading board. */
function SoContainerPlan({ salesOrderId, containerPlan, docNo }: { salesOrderId: string; containerPlan?: string; docNo: string }) {
  const { designRows } = useMasters();
  const [dispatched, setDispatched] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void listPalPlans().then((r) => {
      if (alive && r.ok) setDispatched(dispatchedByDesign(dispatchRows(r.plans, r.boxes, { kind: "so", salesOrderIds: [salesOrderId] })));
    });
    return () => {
      alive = false;
    };
  }, [salesOrderId]);
  // Plan lines store a design NAME; dispatch counts are keyed by Design ROWID.
  const designKey = useMemo(() => {
    const byName = new Map<string, string>();
    designRows.forEach((d) => {
      if (d.designName) byName.set(d.designName, d.id);
      if (d.uniqueName) byName.set(d.uniqueName, d.id);
    });
    return (name: string) => byName.get(name) || name;
  }, [designRows]);
  return (
    <ContainerPlanCard
      containerPlan={containerPlan}
      docNo={docNo}
      plannerPath={`/orders/${salesOrderId}/containerise`}
      dispatchedByDesign={dispatched ?? undefined}
      designKey={designKey}
    />
  );
}

export function OrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const orderId = decodeURIComponent(id);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusBusy, setStatusBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [sendLoad, setSendLoad] = useState(false);
  // CR-175/203: New Loading from palletised stock = the Loading Session page, this SO only.
  const newLoading = () => navigate(`/loading/new?so=${encodeURIComponent(head?.salesOrderId || "")}`);
  const [allocating, setAllocating] = useState(false); // CR-199: Allocate Stock
  const [changingStatus, setChangingStatus] = useState(false); // CR-231: manual status + reason
  // CR-200 supply status per line — every open order shares each item's free
  // stock first-come, so it needs ALL orders, not just this one's lines.
  const { orders: everyOrder } = useOrders();
  const stockFor = useStockLookup();
  const supplyById = lineSupplies(everyOrder, stockFor);
  const [listQ, setListQ] = useState("");
  const { customers } = useMasters();

  const load = async () => {
    const res = await listOrders();
    setLoading(false);
    if (res.ok) setOrders(res.orders);
  };
  useEffect(() => {
    void load();
  }, []);

  // The clicked row is one OrderItem — or, from a pallet's related list, the
  // SalesOrder itself. Either way the detail below is the whole SalesOrder.
  const head = useMemo(
    () =>
      orders.find((o) => o.id === orderId) ?? orders.find((o) => o.salesOrderId === orderId) ?? null,
    [orders, orderId],
  );
  const items = useMemo(() => {
    if (!head) return [];
    return head.salesOrderId ? orders.filter((o) => o.salesOrderId === head.salesOrderId) : [head];
  }, [orders, head]);
  // Boxes New Loading could take right now (same groupReady the Loading Session
  // uses); null = not known yet, so the button is never greyed on a guess.
  const [readyToLoad, setReadyToLoad] = useState<number | null>(null);
  const soIdForReady = head?.salesOrderId || "";
  useEffect(() => {
    if (!soIdForReady) return;
    let alive = true;
    void listPalPlans().then((r) => {
      if (!alive || !r.ok) return;
      const bands = groupReady(r.plans.flatMap((p) => p.lines), (l) => l.salesOrderId === soIdForReady);
      setReadyToLoad(bands.reduce((n, b) => n + b.designs.reduce((m, d) => m + d.ready, 0), 0));
    });
    return () => {
      alive = false;
    };
  }, [soIdForReady, orders]);


  if (loading && !head) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading order…</div>;
  }
  if (!head) {
    return <RecordDetail backTo="/orders" title="Order not found" fields={[]} hiddenStorageKey="orderDetailFields" />;
  }

  const totalAvail = items.reduce((s, o) => s + toPalletise(o), 0);
  // Derived (no SO status change): every line fully produced AND boxes waiting
  // to be palletised → the order's stock is ready for palletisation.
  const readyForPalletisation =
    items.length > 0 && items.every((o) => o.producedQty >= o.orderQty) && totalAvail > 0;

  // Status managed here (like quotes) — not in the order form.
  const status = head.status || "Confirmed";
  // Header chip = the order LIFECYCLE, the very function the Orders grid uses
  // (CR-233) — palletization / loading progress are their own fields below.
  const display = soLiveStatus(status, items);
  // Header + Items-card actions follow what has actually happened to the order.
  const workStarted = items.some((o) => o.producedQty > 0 || o.palletizedQty > 0 || o.loadedQty > 0 || o.dispatchedQty > 0);
  const canAllocate =
    !!head.salesOrderId && !["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(status) && can("stages", "edit") && items.some((o) => o.producedQty < o.orderQty);
  const noStockReason =
    totalAvail > 0 ? "" : items.every((o) => o.palletizedQty >= o.orderQty) ? "Nothing left to palletize" : "Allocate stock to this order first";
  const changeStatus = async (next: string, label: string, reason?: string) => {
    if (!head.salesOrderId || statusBusy) return;
    setStatusBusy(true);
    const res = await setOrderStatus(head.salesOrderId, next, reason);
    setStatusBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Status update failed");
      return;
    }
    toast.success(label);
    await load();
  };
  const onReject = async () => {
    const reason = await promptDialog({
      title: "Reject order",
      message: `Reason for rejecting ${head.orderNumber || head.poNumber}:`,
      placeholder: "Rejection reason",
      confirmLabel: "Reject",
      danger: true,
      required: true,
    });
    if (reason == null) return;
    void changeStatus("Rejected", "Sales order rejected", reason);
  };

  // Editable even after work is recorded (CR-232: lines are edited in place —
  // the form + server hold a worked line to its item and its shipped boxes).
  // Before any work, editing a pending/approved order resets it to Draft.
  const editable = can("orders", "edit") && !["Cancelled", "Rejected"].includes(status);
  // Edit stays visible on every order (consistency); when locked, explain why.
  const editLockReason = `Can't edit — order is ${soStatusLabel(status)}`;

  // Edit / Clone open the Sales Order form page (CR-219).
  const formUrl = (mode: "edit" | "clone") => `/orders/${encodeURIComponent(orderId)}/${mode}`;

  const onDelete = async () => {
    if (!head.salesOrderId) return;
    if (!(await confirmDialog({ message: `Delete order ${head.orderNumber || head.poNumber}? This cannot be undone.`, danger: true }))) return;
    const res = await deleteSalesOrder(head.salesOrderId);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Order deleted");
    navigate("/orders");
  };

  // Delete one line. Any production linked to it is DISASSOCIATED (made
  // Independent), not deleted; the SO total is reshaped server-side. An order
  // must keep at least one line (server 409s on the last one).

  // Trimmed to read like the Quote detail — SO-specific extras (Country, Line
  // Items, Total Qty, Box Branding, Invoice) live in the Items table below.
  const fields: RecordField[] = [
    // SO Number shown in the details (user mandate 2026-07-20: customer details
    // carry the SO number, not the PO number). It's also the page title.
    { key: "orderNumber", label: "SO Number", value: head.orderNumber || "—" },
    { key: "party", label: "Customer", value: head.party },
    // Stage omitted — the order's status is the header chip, not repeated here.
    // Where the boxes are — same helpers as the grid columns (CR-233).
    { key: "palStatus", label: "Palletization Status", value: palStatus(items).label },
    { key: "loadStatus", label: "Loading Status", value: loadStatus(items).label },
    { key: "orderDate", label: "Order Date", value: head.orderDate },
    { key: "dueDate", label: "Due Date", value: head.dueDate },
    { key: "salesperson", label: "Salesperson", value: head.salesperson || "—" },
    { key: "boxBrand", label: "Box Brand", value: head.boxBrandLabel || head.boxBranding || "—" },
    // Same commercial facts the Quote detail shows (detail-page consistency).
    { key: "paymentTerm", label: "Payment Term", value: head.paymentTerm || "—" },
    { key: "currency", label: "Currency", value: head.currency || "—" },
    { key: "totalBoxes", label: "Total Boxes", value: fmt(items.reduce((s, o) => s + o.orderQty, 0)) },
    { key: "netTotal", label: "Net Total", value: head.totalAmount ? `${head.currency || ""} ${fmt(head.totalAmount)}`.trim() : "—" },
  ];

  // Left panel: one row per Sales Order (orders is per-line-item), filtered.
  const soHeads = [...new Map(orders.map((o) => [o.salesOrderId || o.id, o])).values()]
    // ROWIDs exceed Number precision (CR-238) — compare as numeric strings.
    .sort((a, b) => (b.salesOrderId || b.id).localeCompare(a.salesOrderId || a.id, undefined, { numeric: true }));
  const needle = listQ.trim().toLowerCase();
  const listed = needle
    ? soHeads.filter((x) => `${x.orderNumber} ${x.poNumber} ${x.party}`.toLowerCase().includes(needle))
    : soHeads;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {/* SO list — resizable, sticky, own scroll (mirrors QuoteDetail). */}
      <div
        className="card"
        style={{
          width: 300,
          minWidth: 220,
          maxWidth: 420,
          flexShrink: 0,
          padding: 0,
          resize: "horizontal",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - var(--header-h) - 46px)",
          position: "sticky",
          top: 0,
        }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search orders…" value={listQ} onChange={(e) => setListQ(e.target.value)} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((x) => {
            const cur = x.salesOrderId === head.salesOrderId;
            return (
              <Link
                key={x.salesOrderId || x.id}
                to={`/orders/${encodeURIComponent(x.salesOrderId || x.id)}`}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  textDecoration: "none",
                }}
                title={x.orderNumber || x.poNumber}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {x.orderNumber || x.poNumber || "—"}
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[x.party, soStatusLabel(x.status || "Confirmed")].filter(Boolean).join("  ·  ")}
                </div>
              </Link>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching orders</div>}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
    <RecordDetail
      backTo="/orders"
      title={head.orderNumber || head.poNumber}
      statusChip={{
        label: display.label,
        cls: display.cls,
        title:
          status === "Rejected" && head.rejectReason
            ? `Rejected: ${head.rejectReason}`
            : readyForPalletisation
              ? `${totalAvail} boxes produced and waiting to be palletized`
              : undefined,
      }}
      actions={
        <>
          {can("orders", "edit") && (
            <button className="hbtn" disabled={statusBusy || !editable} onClick={() => navigate(formUrl("edit"))} title={editable ? "Edit header & line items" : editLockReason}>
              <Icon name="edit" size={13} /> Edit
            </button>
          )}
          {(status === "Draft" || status === "Rejected") && can("orders", "edit") && (
            <button className="hbtn primary" disabled={statusBusy} onClick={() => void changeStatus("PendingApproval", "Order submitted for approval")} title="Send this order for approval">
              <Icon name="check" size={13} /> Submit for Approval
            </button>
          )}
          {status === "PendingApproval" && canApprove("SalesOrder") && (
            <>
              <button className="hbtn primary" disabled={statusBusy} onClick={() => void changeStatus("Confirmed", "Sales order approved")} title="Approve this order">
                <Icon name="check" size={13} /> Approve
              </button>
              <button className="hbtn" disabled={statusBusy} onClick={onReject} title="Reject with reason" style={{ color: "var(--c-red)" }}>
                <Icon name="x" size={13} /> Reject
              </button>
            </>
          )}
          {status === "Confirmed" && !workStarted && can("orders", "edit") && (
            <button className="hbtn primary" disabled={statusBusy} onClick={() => void changeStatus("InProgress", "Order sent to customer")} title="Mark as Sent — the salesperson has acknowledged this order to the customer">
              <Icon name="check" size={13} /> Mark as Sent
            </button>
          )}
          {status === "Cancelled" && can("orders", "edit") && (
            <button className="hbtn" disabled={statusBusy} onClick={() => void changeStatus("Confirmed", "Order reopened")} title="Reopen as Confirmed">
              <Icon name="check" size={13} /> Reopen
            </button>
          )}
          <MoreMenu
            items={[
              // Palletise only once the order is past approval (mirror of the
              // items-card buttons; the server never gates on status).
              // Send to Palletization → the same PalPlan screen as "New
              // Palletization" and Production's button (unified entry, items
              // pre-shown), scoped to this SO.
              ...(head.salesOrderId && !["Draft", "PendingApproval"].includes(status) && can("stages", "edit")
                ? [{ label: "Palletization", onClick: () => navigate(`/packing/new?fromOrder=${encodeURIComponent(head.salesOrderId!)}`) }]
                : []),
              // New Loading (CR-175): this SO's palletised stock into a container —
              // same modal as /loading's New Loading, SO preset.
              ...(head.salesOrderId && !["Draft", "PendingApproval"].includes(status) && can("stages", "edit")
                ? [{ label: "New Loading", onClick: newLoading }]
                : []),
              // Allocate Stock (CR-199): hand free stock to this order's lines.
              ...(canAllocate
                ? [{ label: "Allocate Stock", onClick: () => setAllocating(true) }]
                : []),
              // ponytail: "Record New Production" retired here (CR-198) — production is
              // recorded to stock on /prod, then allocated to this order (Allocate Stock).
              ...(head.salesOrderId && can("orders", "edit")
                ? [{ label: "Plan Containerisation", onClick: () => navigate(`/orders/${head.salesOrderId}/containerise`) }]
                : []),
              { label: "Print Order", onClick: () => setPrinting(true) },
              ...(head.salesOrderId && can("orders", "edit")
                ? [{ label: "Change Status", onClick: () => setChangingStatus(true) }]
                : []),
              ...((status === "Confirmed" || status === "InProgress") && can("orders", "edit")
                ? [{ label: "Cancel Order", danger: true, onClick: () => void changeStatus("Cancelled", "Order cancelled") }]
                : []),
              ...(head.salesOrderId && can("orders", "create")
                ? [{ label: "Clone", onClick: () => navigate(formUrl("clone")) }]
                : []),
              ...(can("orders", "delete")
                ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }]
                : []),
            ]}
          />
        </>
      }
      subtitle={
        <Link className="linkish" to={`/parties/${encodeURIComponent(head.partyCode)}`} title="Open customer">
          {head.party}
        </Link>
      }
      fields={fields}
      hiddenStorageKey="orderDetailFields"
      defaultHidden={["party", "CREATEDTIME", "MODIFIEDTIME"]}
      hideFields
      extraTabs={
        head.salesOrderId
          ? [
              { id: "production", label: "Production", content: <SoProduction salesOrderId={head.salesOrderId} onChanged={() => void load()} /> },
              { id: "palletization", label: "Palletization", content: <SoPalletisation salesOrderId={head.salesOrderId} /> },
              {
                id: "containers",
                label: "Container Planning",
                content: (
                  <SoContainerPlan
                    salesOrderId={head.salesOrderId}
                    containerPlan={head.containerPlan}
                    docNo={head.orderNumber || head.poNumber}
                  />
                ),
              },
              {
                id: "dispatch",
                label: "Dispatch",
                content: (
                  <DispatchTab
                    scope={{ kind: "so", salesOrderIds: [head.salesOrderId] }}
                    orderedBoxes={items.reduce((s, o) => s + o.orderQty, 0)}
                  />
                ),
              },
            ]
          : undefined
      }
      activityTable="SalesOrder"
      entityId={head.salesOrderId}
      created={head.createdTime}
      modified={head.modifiedTime}
    >
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600 }}>Items</span>
          <span className="muted" style={{ fontSize: 14 }}>
            {totalAvail} boxes to palletize
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {/* Both send paths (this button and the header More → Palletization)
               open the same PalPlan screen scoped to this order. */}
            {/* Stock is waiting to be claimed — the one action that unblocks the rest. */}
            {/* Per line, not the header label — allocating one line moves the header
               on while another line still has free stock to claim. */}
            {canAllocate && items.some((o) => ["Stock ready", "Partial stock"].includes(supplyById.get(o.id)?.status ?? "")) && (
              <button className="btn primary" onClick={() => setAllocating(true)} title="Hand free stock to this order's lines">
                Allocate Stock
              </button>
            )}
            <button
              className="btn"
              disabled={totalAvail === 0 || !head.salesOrderId}
              onClick={() => navigate(`/packing/new?fromOrder=${encodeURIComponent(head.salesOrderId!)}`)}
              title={noStockReason || "Plan this order's produced boxes onto pallets"}
            >
              Send to Palletization
            </button>
            {/* Direct loading — skips palletization (items land in /loading Ready).
               Same gate as Palletization: past approval + stages edit. */}
            {can("stages", "edit") && !["Draft", "PendingApproval"].includes(status) && (
              <button
                className="btn"
                disabled={!head.salesOrderId || totalAvail === 0}
                onClick={() => setSendLoad(true)}
                title={noStockReason || "Send items straight to the loading board — no palletization step"}
              >
                Send to Loading
              </button>
            )}
            {/* New Loading (CR-175) — the palletised route; mirrors the header More entry. */}
            {can("stages", "edit") && !["Draft", "PendingApproval"].includes(status) && (
              <button
                className="btn"
                disabled={!head.salesOrderId || readyToLoad === 0}
                onClick={newLoading}
                title={readyToLoad === 0 ? "Nothing ready for loading" : "Start a loading from this order's palletized stock"}
              >
                New Loading
              </button>
            )}
          </div>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                <th className="num" style={{ textAlign: "right" }}>Allocated</th>
                <th>Supply</th>
                <th className="num" style={{ textAlign: "right" }}>Palletized</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td><span className="design-name">{o.design}</span></td>
                  <td><span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span></td>
                  <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                  <td className="num mono">{fmt(o.orderQty)}</td>
                  <td className="num mono">{fmt(o.producedQty)}</td>
                  <td className="nw">
                    {(() => {
                      const sp = supplyById.get(o.id);
                      return sp ? <span className="chip" style={{ color: sp.color }} title={sp.label}>{codeOf(sp.label)}</span> : <span className="dim">—</span>;
                    })()}
                  </td>
                  <td className="num mono">{fmt(o.palletizedQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


      {/* SO print — the quotation sheet with Sales Order labels; the SO's
          header + lines are mapped into the Quote shape the template reads. */}
      {printing && (
        <QuotePrint
          doc={{ title: "SALES ORDER", eyebrow: "Sales Order For", noLabel: "SO NO.", validLabel: "DUE DATE" }}
          quote={{
            id: head.salesOrderId || head.id,
            quoteNo: head.orderNumber || head.poNumber,
            customer: head.party,
            partyCode: head.partyCode,
            // The SO's own addresses (CR-221); older orders fall back to the customer master.
            address: head.address || customers.find((c) => c.code === head.partyCode)?.address || "",
            shippingAddress: head.shippingAddress || "",
            quoteDate: head.orderDate,
            expiryDate: head.dueDate,
            paymentTerm: head.paymentTerm || "",
            portOfDischarge: head.portOfDischarge || "",
            status: "Draft",
            currency: head.currency || "INR",
            remarks: head.remarks || "",
            salesperson: head.salesperson,
            customerNotes: head.customerNotes,
            terms: head.terms,
            docDiscount: head.docDiscount,
            adjustment: head.adjustment,
            taxType: head.taxType,
            taxPct: head.taxPct,
            lines: items.map((o) => ({ item: o.design, qty: o.orderQty, rate: o.rate || 0, discount: o.discount || 0, description: o.description })),
            soNumber: null,
          } satisfies Quote}
          onClose={() => setPrinting(false)}
        />
      )}
      {sendLoad && head.salesOrderId && (
        <SendToLoadingModal
          presetSalesOrderId={head.salesOrderId}
          onDone={() => {
            setSendLoad(false);
            void load();
          }}
          onClose={() => setSendLoad(false)}
        />
      )}
      {changingStatus && head.salesOrderId && (
        <ChangeStatusModal
          title={[head.orderNumber || head.poNumber, head.party].filter(Boolean).join("  ·  ")}
          salesOrderId={head.salesOrderId}
          current={status}
          onDone={() => void load()}
          onClose={() => setChangingStatus(false)}
        />
      )}
      {allocating && head.salesOrderId && (
        <AllocateStockModal
          title={[head.orderNumber || head.poNumber, head.party].filter(Boolean).join("  ·  ")}
          items={items}
          onDone={() => void load()}
          onClose={() => setAllocating(false)}
        />
      )}
    </RecordDetail>
      </div>
    </div>
  );
}
