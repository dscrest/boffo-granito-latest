/* Sales Order detail — header + all line items of the order.
   Items are selectable; the action bar sends the whole order ("Palletize all")
   or just the ticked rows ("Palletize selected") into the close-pallet form. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fmt, finishClass } from "@/lib/format";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { StageBadge } from "@/ui/primitives";
import { can, canApprove } from "@/lib/auth";
import { type Order } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { createSalesOrder, deleteSalesOrder, listOrders, setOrderStatus, updateSalesOrderWithItems, soStatusLabel, SO_STATUS_CHIP } from "./ordersApi";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { draftToInput } from "./OrdersTable";
import { PalletPackForm } from "@/features/stages/PalletPackForm";
import { closePallet, type ClosePalletInput } from "@/features/stages/palletisationApi";

const avail = (o: Order) => Math.max(0, o.producedQty - o.palletizedQty);

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
  const [notice, setNotice] = useState<string | null>(null);

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

  const selectable = useMemo(() => items.filter((o) => avail(o) > 0), [items]);
  const allChecked = selectable.length > 0 && selectable.every((o) => sel.has(o.id));
  const toggle = (rowId: string) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(rowId) ? n.delete(rowId) : n.add(rowId);
      return n;
    });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(selectable.map((o) => o.id)));

  const onPalletSave = async (input: ClosePalletInput) => {
    setPack(null);
    setNotice("Closing pallet…");
    const res = await closePallet(input);
    if (!res.ok) {
      setNotice(res.error || "Close-pallet failed");
      return;
    }
    setNotice(`Pallet closed — batch #${res.rowid} · ${res.data?.boxes_packed ?? 0} boxes.`);
    setSel(new Set());
    await load();
  };

  if (loading && !head) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading order…</div>;
  }
  if (!head) {
    return <RecordDetail backTo="/orders" title="Order not found" fields={[]} hiddenStorageKey="orderDetailFields" />;
  }

  const totalOrdered = items.reduce((s, o) => s + o.orderQty, 0);
  const totalAvail = items.reduce((s, o) => s + avail(o), 0);

  // Status managed here (like quotes) — not in the order form.
  const status = head.status || "Confirmed";
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
  const onReject = () => {
    const r = window.prompt(`Rejection reason for ${head.orderNumber || head.poNumber} (required):`, "");
    if (r === null) return;
    if (!r.trim()) {
      toast.error("A rejection reason is required");
      return;
    }
    void changeStatus("Draft", "Order rejected — back to draft", r.trim());
  };

  // Editable until any work is recorded (server enforces the same guard with
  // a 409); editing a pending/approved order resets it to Draft.
  const workRecorded = items.some((o) => o.producedQty > 0 || o.palletizedQty > 0 || o.loadedQty > 0);
  const editable =
    can("orders", "edit") && !workRecorded && ["Draft", "PendingApproval", "Confirmed"].includes(status);

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
    toast.success(`Order created (#${res.rowid})`);
    if (res.rowid) navigate(`/orders/${encodeURIComponent(res.rowid)}`);
    // Same-route navigation reuses this component — reload so the new id resolves.
    await load();
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

  const fields: RecordField[] = [
    { key: "orderNumber", label: "SO Number", value: head.orderNumber || "—" },
    { key: "poNumber", label: "PO Number", value: head.poNumber || "—" },
    { key: "status", label: "Status", value: status },
    { key: "party", label: "Customer", value: `${head.flag} ${head.party}` },
    { key: "country", label: "Country", value: head.country },
    { key: "skus", label: "Line Items", value: String(items.length) },
    { key: "totalOrdered", label: "Total Order Qty", value: fmt(totalOrdered) },
    { key: "stage", label: "Stage", value: head.stage },
    { key: "orderDate", label: "Order Date", value: head.orderDate },
    { key: "dueDate", label: "Due Date", value: head.dueDate },
    { key: "salesperson", label: "Salesperson", value: head.salesperson || "—" },
    { key: "boxBranding", label: "Box Branding", value: head.boxBranding || "—" },
    { key: "invoice", label: "Invoice", value: head.invoice || "—" },
  ];

  return (
    <RecordDetail
      backTo="/orders"
      title={head.orderNumber || head.poNumber}
      statusChip={{ label: soStatusLabel(status), cls: SO_STATUS_CHIP[status] || "q-draft" }}
      actions={
        <>
          {editable && (
            <button className="hbtn" disabled={statusBusy} onClick={() => setEditing(true)} title="Edit header & line items">
              <Icon name="edit" size={13} /> Edit
            </button>
          )}
          {status === "Draft" && can("orders", "edit") && (
            <button className="hbtn primary" disabled={statusBusy} onClick={() => void changeStatus("PendingApproval", "Order submitted for approval")} title="Send this order for approval">
              <Icon name="check" size={13} /> Submit for Approval
            </button>
          )}
          {status === "PendingApproval" && canApprove("SalesOrder") && (
            <>
              <button className="hbtn primary" disabled={statusBusy} onClick={() => void changeStatus("Confirmed", "Order approved")} title="Approve this order">
                <Icon name="check" size={13} /> Approve
              </button>
              <button className="hbtn" disabled={statusBusy} onClick={onReject} title="Reject with reason" style={{ color: "var(--c-red)" }}>
                <Icon name="x" size={13} /> Reject
              </button>
            </>
          )}
          {status === "Confirmed" && can("orders", "edit") && (
            <button className="hbtn primary" disabled={statusBusy} onClick={() => void changeStatus("InProgress", "Order in progress")} title="Work has started on this order">
              <Icon name="check" size={13} /> Start Progress
            </button>
          )}
          {(status === "Confirmed" || status === "InProgress") && can("orders", "edit") && (
            <button className="hbtn" disabled={statusBusy} onClick={() => void changeStatus("Cancelled", "Order cancelled")} title="Cancel this order" style={{ color: "var(--c-red)" }}>
              <Icon name="x" size={13} /> Cancel Order
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
                ? [{ label: "Palletise", onClick: () => setPack({ mode: "all" as const }) }]
                : []),
              { label: "Send for Production", onClick: () => navigate("/production") },
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
        <>
          {head.flag}{" "}
          <Link className="linkish" to={`/parties/${encodeURIComponent(head.partyCode)}`} title="Open customer">
            {head.party}
          </Link>
          {head.poNumber && <> · PO {head.poNumber}</>}
          {" "}· {items.length} item{items.length > 1 ? "s" : ""}
        </>
      }
      fields={fields}
      hiddenStorageKey="orderDetailFields"
      defaultHidden={["orderNumber", "status", "party", "skus", "CREATEDTIME", "MODIFIEDTIME"]}
      activityTable="SalesOrder"
      entityId={head.salesOrderId}
      created={head.createdTime}
      modified={head.modifiedTime}
    >
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600 }}>Items</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {sel.size} selected · {totalAvail} boxes available
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {notice && <span className="muted dim" style={{ fontSize: 12, marginRight: 4 }}>{notice}</span>}
            <button
              className="btn"
              disabled={sel.size === 0 || !head.salesOrderId}
              onClick={() => setPack({ mode: "selected" })}
            >
              Send selected ({sel.size})
            </button>
            <button
              className="hbtn primary"
              disabled={totalAvail === 0 || !head.salesOrderId}
              onClick={() => setPack({ mode: "all" })}
            >
              <Icon name="palette" size={13} />
              Send to Palletisation
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
                <th className="num" style={{ textAlign: "right" }}>Produced</th>
                <th className="num" style={{ textAlign: "right" }}>Palletized</th>
                <th className="num" style={{ textAlign: "right" }}>Available</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => {
                const a = avail(o);
                const ready = a > 0;
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
                    <td className="num mono">{fmt(o.producedQty)}</td>
                    <td className="num mono">{fmt(o.palletizedQty)}</td>
                    <td className="num mono" style={{ color: ready ? "var(--c-green)" : "var(--dim)" }}>{a || "—"}</td>
                    <td><StageBadge stage={o.stage} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <OrderForm initial={items} onSave={(d) => void onEditSave(d)} onClose={() => setEditing(false)} />}
      {cloning && <OrderForm initial={items} clone onSave={(d) => void onCloneSave(d)} onClose={() => setCloning(false)} />}

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
  );
}
