/* Sales Order (Master Order) detail — header + all line items of the order.
   Items are selectable; the action bar sends the whole order ("Palletize all")
   or just the ticked rows ("Palletize selected") into the close-pallet form. */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fmt, finishClass } from "@/lib/format";
import { Icon } from "@/ui/Icon";
import { StageBadge } from "@/ui/primitives";
import { type Order } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { listOrders } from "./ordersApi";
import { PalletPackForm } from "@/features/stages/PalletPackForm";
import { closePallet, type ClosePalletInput } from "@/features/stages/palletisationApi";

const avail = (o: Order) => Math.max(0, o.producedQty - o.palletizedQty);

export function OrderDetail() {
  const { id = "" } = useParams();
  const orderId = decodeURIComponent(id);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pack, setPack] = useState<null | { mode: "selected" | "all" }>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const res = await listOrders();
    setLoading(false);
    if (res.ok) setOrders(res.orders);
  };
  useEffect(() => {
    void load();
  }, []);

  // The clicked row is one OrderItem; the detail is its whole SalesOrder.
  const head = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);
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

  const fields: RecordField[] = [
    { key: "poNumber", label: "PO Number", value: head.poNumber },
    { key: "party", label: "Party", value: `${head.flag} ${head.party}` },
    { key: "country", label: "Country", value: head.country },
    { key: "skus", label: "Line Items", value: String(items.length) },
    { key: "totalOrdered", label: "Total Order Qty", value: fmt(totalOrdered) },
    { key: "stage", label: "Stage", value: head.stage },
    { key: "orderDate", label: "Order Date", value: head.orderDate },
    { key: "dueDate", label: "Due Date", value: head.dueDate },
    { key: "salesperson", label: "Salesperson", value: head.salesperson || "—" },
    { key: "invoice", label: "Invoice", value: head.invoice || "—" },
  ];

  return (
    <RecordDetail
      backTo="/orders"
      title={head.poNumber}
      subtitle={`${head.flag} ${head.party} · ${items.length} item${items.length > 1 ? "s" : ""}`}
      fields={fields}
      hiddenStorageKey="orderDetailFields"
      activityTable="SalesOrder"
      entityId={head.salesOrderId}
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
              Palletize selected ({sel.size})
            </button>
            <button
              className="hbtn primary"
              disabled={totalAvail === 0 || !head.salesOrderId}
              onClick={() => setPack({ mode: "all" })}
            >
              <Icon name="palette" size={13} />
              Palletize all
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
