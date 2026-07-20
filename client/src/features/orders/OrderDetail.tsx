/* Sales Order detail — header + all line items of the order.
   Items are selectable; the action bar sends the whole order ("Palletize all")
   or just the ticked rows ("Palletize selected") into the close-pallet form. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fmt, finishClass } from "@/lib/format";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog, promptDialog } from "@/ui/ConfirmDialog";
import { can, canApprove } from "@/lib/auth";
import { STAGES, type Order } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { createSalesOrder, deleteSalesOrder, listOrders, setOrderStatus, updateSalesOrderWithItems, soStatusLabel, SO_STATUS_CHIP } from "./ordersApi";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { draftToInput } from "./OrdersTable";
import { PalletPackForm } from "@/features/stages/PalletPackForm";
import { closePallet, listOrderBatches, type ClosePalletInput, type OrderBatchRow } from "@/features/stages/palletisationApi";
import { ProductionForm } from "@/features/stages/ProductionForm";
import { InProductionModal, InProductionCell } from "@/features/stages/InProductionModal";
import { cachedProductionLogs, invalidateProductionLogs, listProductionLogs, requestProduction, statusChip, type ProductionEntry, type ProductionRequestInput } from "@/features/stages/productionApi";
import { useMasters } from "@/features/masters/useMasters";
import { designStock } from "@/lib/stock";

// Boxes produced on THIS order still waiting to be palletised — drives the
// palletise selection/checkboxes only. NOT the sellable "Available" figure
// (that's designStock.available, incl. opening stock — see the Items table).
const toPalletise = (o: Order) => Math.max(0, o.producedQty - o.palletizedQty);

/* One meaningful header status. Approval/terminal statuses (Draft, Pending
   Approval, Rejected, Cancelled) show as-is. An active order (Confirmed /
   InProgress) instead shows where its stock actually is: produced-and-waiting
   → "Ready for Palletisation", otherwise the bottleneck line stage
   ("In Production", "Loading", …); falls back to the plain status before any
   work is recorded. Replaces the old two-chip (status + derived) display. */
function soDisplayStatus(
  status: string,
  items: Order[],
  readyForPalletisation: boolean,
): { label: string; cls: string } {
  const base = { label: soStatusLabel(status), cls: SO_STATUS_CHIP[status] || "q-draft" };
  if (status !== "Confirmed" && status !== "InProgress") return base;
  if (readyForPalletisation) return { label: "Ready for Palletisation", cls: "q-accepted" };
  const workStarted = items.some((o) => o.producedQty > 0 || o.palletizedQty > 0 || o.loadedQty > 0);
  if (!workStarted) return base;
  const stage = STAGES[Math.min(...items.map((o) => Math.max(0, STAGES.findIndex((s) => s.id === o.stage))))];
  return { label: stage.label, cls: "q-sent" };
}

/** Production orders (ProductionLog entries) recorded against this Sales Order. */
function SoProduction({ salesOrderId }: { salesOrderId: string }) {
  const [rows, setRows] = useState<ProductionEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void listProductionLogs().then((res) => {
      if (alive) setRows(res.ok ? res.entries.filter((e) => e.salesOrderId === salesOrderId) : []);
    });
    return () => {
      alive = false;
    };
  }, [salesOrderId]);

  if (rows == null) return <div className="muted mono" style={{ padding: 18 }}>Loading production…</div>;
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Design</th>
              <th>Size</th>
              <th>Status</th>
              <th className="num" style={{ textAlign: "right" }}>Requested</th>
              <th className="num" style={{ textAlign: "right" }}>Produced</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = statusChip(e.status);
              return (
                <tr key={e.id}>
                  <td className="mono muted">{e.productionDate || "—"}</td>
                  <td><span className="design-name">{e.design}</span></td>
                  <td>{e.size ? <span className={`chip size ${e.size.startsWith("200") || e.size.startsWith("75") ? "b" : ""}`}>{e.size}</span> : "—"}</td>
                  <td><span className="chip" style={{ color: s.color }}>{s.label}</span></td>
                  <td className="num mono">{fmt(e.qtyRequested)}</td>
                  <td className="num mono">{e.qtyBoxes ? fmt(e.qtyBoxes) : "—"}</td>
                  <td className="muted">{e.performedBy || "—"}</td>
                  <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.note}>{e.note || "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  No production requested against this order yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Palletised batches committed against this Sales Order (parallel to the
    Production tab — per-line palletisation detail). */
function SoPalletisation({ salesOrderId }: { salesOrderId: string }) {
  const [rows, setRows] = useState<OrderBatchRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void listOrderBatches(salesOrderId).then((res) => {
      if (alive) setRows(res.ok ? res.rows : []);
    });
    return () => {
      alive = false;
    };
  }, [salesOrderId]);

  if (rows == null) return <div className="muted mono" style={{ padding: 18 }}>Loading palletisation…</div>;
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Palletization Date</th>
              <th>Design</th>
              <th>Pallet</th>
              <th className="num" style={{ textAlign: "right" }}>Boxes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.batchId}>
                <td className="mono muted">{b.date}</td>
                <td><span className="design-name">{b.design}</span></td>
                <td>{b.pallet}</td>
                <td className="num mono">{fmt(b.boxes)}</td>
                <td><span className="chip">{b.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  Nothing palletised against this order yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const orderId = decodeURIComponent(id);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusBusy, setStatusBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pack, setPack] = useState<null | { mode: "selected" | "all" }>(null);
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [prod, setProd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listQ, setListQ] = useState("");
  const [prodLogs, setProdLogs] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const { designRows } = useMasters();

  const load = async () => {
    const res = await listOrders();
    setLoading(false);
    if (res.ok) setOrders(res.orders);
  };
  useEffect(() => {
    void load();
    void listProductionLogs().then((r) => r.ok && setProdLogs(r.entries));
  }, []);

  // Per-design stock, same source of truth as the Item master. In-production is
  // therefore the design-wide total across ALL orders (not just this line), with
  // its per-order breakdown for the drill-down popup.
  const stockOf = (o: Order) => {
    const key = o.designName || o.design; // plain design_name is the stock key (o.design is the display label)
    const opening = designRows.find((d) => d.designName === key)?.accountingStock ?? 0;
    return designStock(key, { openingStock: opening, orders, prodLogs });
  };
  // Line whose "In production" drill-down popup is open (null = closed).
  const [ipBreak, setIpBreak] = useState<Order | null>(null);

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

  const selectable = useMemo(() => items.filter((o) => toPalletise(o) > 0), [items]);
  // Line items still owing production — pre-filled job list for "Send for
  // Production". Kept above the early returns so hook order stays stable.
  const prodJobs = useMemo(() => items.filter((o) => o.producedQty < o.orderQty), [items]);
  const allChecked = selectable.length > 0 && selectable.every((o) => sel.has(o.id));
  const toggle = (rowId: string) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(rowId) ? n.delete(rowId) : n.add(rowId);
      return n;
    });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(selectable.map((o) => o.id)));

  const onPalletSave = async (inputs: ClosePalletInput[]) => {
    setPack(null);
    setNotice("Saving palletisation…");
    let done = 0;
    let boxes = 0;
    for (const input of inputs) {
      const res = await closePallet(input);
      if (!res.ok) {
        setNotice(res.error || "Palletisation failed");
        await load();
        return;
      }
      done += 1;
      boxes += res.data?.boxes_packed ?? 0;
    }
    setNotice(`Palletised — ${done} pallet${done > 1 ? "s" : ""} · ${boxes} boxes.`);
    setSel(new Set());
    await load();
  };

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
  const display = soDisplayStatus(status, items, readyForPalletisation);
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

  // Editable until any work is recorded (server enforces the same guard with
  // a 409); editing a pending/approved order resets it to Draft.
  const workRecorded = items.some((o) => o.producedQty > 0 || o.palletizedQty > 0 || o.loadedQty > 0);
  // InProgress included: a production REQUEST doesn't record any work qty, so the
  // order stays editable while a request is pending (server enforces the same —
  // it blocks only on recorded quantities, not on status).
  const editable =
    can("orders", "edit") && !workRecorded && ["Draft", "PendingApproval", "Confirmed", "InProgress"].includes(status);
  // Edit stays visible on every order (consistency); when locked, explain why.
  const editLockReason = workRecorded
    ? "Can't edit — production/work already recorded"
    : `Can't edit — order is ${status}`;

  const onEditSave = async (dr: OrderDraft) => {
    if (!head.salesOrderId) return;
    const res = await updateSalesOrderWithItems(head.salesOrderId, draftToInput(dr));
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(false);
    toast.success("Order updated");
    await load();
  };

  // Clone: same header + lines into a fresh order. draftToInput already blanks
  // the SO number and status, so createSalesOrder makes a clean Draft.
  const onCloneSave = async (dr: OrderDraft) => {
    const res = await createSalesOrder(draftToInput(dr));
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    setCloning(false);
    toast.success(`Order ${res.data?.order_number ?? ""} created`);
    if (res.rowid) navigate(`/orders/${encodeURIComponent(res.rowid)}`);
    // Same-route navigation reuses this component — reload so the new id resolves.
    await load();
  };

  const onProdSave = async (input: ProductionRequestInput) => {
    setProd(false);
    const res = await requestProduction(input);
    if (!res.ok) {
      toast.error(res.error || "Production request failed");
      return;
    }
    const total = input.lines.reduce((s, l) => s + l.qty_requested, 0);
    toast.success(`Production request sent for approval — ${total} boxes · ${res.data?.lines ?? input.lines.length} item(s)`);
    invalidateProductionLogs();
    // Land on the new production record instead of reloading this SO page.
    // The production detail keys order-linked batches by `so-<salesOrderId>`
    // (see productionDetailKey), not the raw request_group.
    if (head.salesOrderId) navigate(`/prod/${encodeURIComponent(`so-${head.salesOrderId}`)}`);
    else await load();
  };

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
    { key: "orderDate", label: "Order Date", value: head.orderDate },
    { key: "dueDate", label: "Due Date", value: head.dueDate },
    { key: "salesperson", label: "Salesperson", value: head.salesperson || "—" },
  ];

  // Left panel: one row per Sales Order (orders is per-line-item), filtered.
  const soHeads = [...new Map(orders.map((o) => [o.salesOrderId || o.id, o])).values()]
    .sort((a, b) => Number(b.salesOrderId || b.id) - Number(a.salesOrderId || a.id));
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
              ? `${totalAvail} boxes produced and waiting to be palletised`
              : undefined,
      }}
      actions={
        <>
          {can("orders", "edit") && (
            <button className="hbtn" disabled={statusBusy || !editable} onClick={() => setEditing(true)} title={editable ? "Edit header & line items" : editLockReason}>
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
          {status === "Confirmed" && can("orders", "edit") && (
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
              ...(head.salesOrderId && !["Draft", "PendingApproval"].includes(status) && can("stages", "edit")
                ? [{ label: "Palletization", onClick: () => setPack({ mode: "all" as const }) }]
                : []),
              ...(prodJobs.length > 0 && !["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(status) && can("stages", "edit")
                ? [{ label: "Record New Production", onClick: () => setProd(true) }]
                : []),
              ...((status === "Confirmed" || status === "InProgress") && can("orders", "edit")
                ? [{ label: "Cancel Order", danger: true, onClick: () => void changeStatus("Cancelled", "Order cancelled") }]
                : []),
              ...(head.salesOrderId && can("orders", "create")
                ? [{ label: "Clone", onClick: () => setCloning(true) }]
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
              { id: "production", label: "Production", content: <SoProduction salesOrderId={head.salesOrderId} /> },
              { id: "palletization", label: "Palletization", content: <SoPalletisation salesOrderId={head.salesOrderId} /> },
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
          <span className="muted" style={{ fontSize: 12 }}>
            {sel.size} selected · {totalAvail} boxes to palletise
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {notice && <span className="muted dim" style={{ fontSize: 12, marginRight: 4 }}>{notice}</span>}
            {/* "Send to Palletisation" (whole order) lives in the header More
               menu as "Palletization" now (user mandate 2026-07-20). This
               inline button stays for the ticked-rows path only. */}
            <button
              className="btn"
              disabled={sel.size === 0 || !head.salesOrderId}
              onClick={() => setPack({ mode: "selected" })}
            >
              Send selected ({sel.size})
            </button>
          </div>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={selectable.length === 0} title="Select all available" />
                </th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                <th className="num" style={{ textAlign: "right" }}>In Production</th>
                <th className="num" style={{ textAlign: "right" }}>Palletized</th>
                <th className="num" style={{ textAlign: "right" }}>Available</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => {
                const ready = toPalletise(o) > 0;
                const st = stockOf(o);
                const stock = st.available;
                return (
                  <tr key={o.id}>
                    <td style={{ textAlign: "center" }}>
                      {ready ? (
                        <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
                      ) : (
                        <span className="muted" title="Nothing produced yet to palletize">—</span>
                      )}
                    </td>
                    <td><span className="design-name">{o.design}</span></td>
                    <td><span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span></td>
                    <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                    <td className="num mono">{fmt(o.orderQty)}</td>
                    <td className="num"><InProductionCell total={st.inProduction} onOpen={() => setIpBreak(o)} /></td>
                    <td className="num mono">{fmt(o.palletizedQty)}</td>
                    <td className="num mono" style={{ color: stock > 0 ? "var(--c-green)" : "var(--dim)" }}>{stock || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {ipBreak && (() => {
        const s = stockOf(ipBreak);
        return <InProductionModal label={ipBreak.design} total={s.inProduction} orders={s.inProductionOrders} onClose={() => setIpBreak(null)} />;
      })()}
      {editing && <OrderForm initial={items} onSave={(d) => void onEditSave(d)} onClose={() => setEditing(false)} />}
      {cloning && <OrderForm initial={items} clone onSave={(d) => void onCloneSave(d)} onClose={() => setCloning(false)} />}
      {prod && head.salesOrderId && (
        <ProductionForm
          presetSalesOrderId={head.salesOrderId}
          onSave={onProdSave}
          onClose={() => setProd(false)}
        />
      )}

      {pack && head.salesOrderId && (
        <PalletPackForm
          presetOrderId={head.salesOrderId}
          preselectItemIds={pack.mode === "selected" ? [...sel] : undefined}
          autoFillAll={pack.mode === "all"}
          onSave={onPalletSave}
          onClose={() => setPack(null)}
        />
      )}
    </RecordDetail>
      </div>
    </div>
  );
}
