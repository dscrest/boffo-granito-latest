/* All Sales Orders table — backed by the Catalyst Data Store via ordersApi.
   Each row is an OrderItem joined to its SalesOrder header. New Order writes
   a real SalesOrder + OrderItems; every write is recorded in OperationLog. */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass } from "@/lib/format";
import { STAGES, type Order } from "@/data";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { createSalesOrder, listOrders, type NewSalesOrderInput } from "./ordersApi";

let _soSeq = 100;
const genOrderNumber = () => `SO/2026-27/${++_soSeq}`;

function draftToInput(dr: OrderDraft): NewSalesOrderInput {
  return {
    customer: dr.customer,
    order_number: genOrderNumber(),
    po_number: dr.po_number,
    order_date: dr.order_date,
    shipment_date: dr.shipment_date,
    payment_term: dr.payment_term,
    port_of_discharge: dr.port_of_discharge,
    status: dr.status,
    currency: dr.currency,
    remarks: dr.remarks,
    address: "",
    salesperson: dr.salesperson,
    customer_notes: dr.customer_notes,
    terms: dr.terms,
    lines: dr.lines.map((l) => ({
      item: l.design,
      qty: parseInt(l.ordered_qty_boxes, 10) || 0,
      rate: parseFloat(l.rate) || 0,
      discount: parseFloat(l.discount) || 0,
      stage: "po",
    })),
  };
}

export function OrdersTable() {
  const [tab, setTab] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listOrders();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load orders");
      return;
    }
    setError(null);
    setOrders(res.orders);
  };

  useEffect(() => {
    void load();
  }, []);

  const onSave = async (dr: OrderDraft) => {
    setShowForm(false);
    setNotice("Saving sales order…");
    const res = await createSalesOrder(draftToInput(dr));
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      return;
    }
    setNotice(`Sales order saved (#${res.rowid}).`);
    await load();
  };

  const filtered = useMemo(() => {
    if (tab === "all") return orders;
    return orders.filter((o) => o.stage === tab);
  }, [tab, orders]);

  return (
    <div>
      {showForm && <OrderForm onSave={onSave} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">All Sales Orders</div>
          <div className="sub">
            {loading ? "Loading…" : `${filtered.length} of ${orders.length} order lines`} · grouped by stage
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}>
          {error} — check the <a href="#/ops">Operations log</a>.
        </div>
      )}

      <div className="tabs">
        <div className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          All <span className="muted mono" style={{ marginLeft: 4 }}>{orders.length}</span>
        </div>
        {STAGES.map((s) => (
          <div key={s.id} className={`tab ${tab === s.id ? "active" : ""}`} onClick={() => setTab(s.id)}>
            {s.label} <span className="muted mono" style={{ marginLeft: 4 }}>{orders.filter((o) => o.stage === s.id).length}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>ID</th>
                <th>PO Number</th>
                <th>Party</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                <th>Progress</th>
                <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                <th>Stage</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const remaining = o.orderQty - o.loadedQty;
                return (
                  <tr key={o.id}>
                    <td className="muted mono" style={{ textAlign: "center" }}>{i + 1}</td>
                    <td className="mono muted">{o.id}</td>
                    <td className="mono" style={{ color: "var(--fg)" }}>{o.poNumber}</td>
                    <td>
                      <span style={{ marginRight: 6 }}>{o.flag}</span>
                      {o.party}
                    </td>
                    <td><span className="design-name">{o.design}</span></td>
                    <td>
                      <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                    </td>
                    <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                    <td><span className={`chip brand ${o.brand === "BIG" ? "big" : ""}`}>{o.brand}</span></td>
                    <td className="num">{fmt(o.orderQty)}</td>
                    <td style={{ width: 140 }}>
                      <SplitBar produced={o.producedQty} palletized={o.palletizedQty} loaded={o.loadedQty} total={o.orderQty} />
                    </td>
                    <td className="num">{fmt(remaining)}</td>
                    <td><StageBadge stage={o.stage} /></td>
                    <td className="mono muted">{o.dueDate}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="muted" style={{ textAlign: "center", padding: 18 }}>
                    No sales orders yet. Create one from a Quote (Convert) or via <b>New Order</b>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
