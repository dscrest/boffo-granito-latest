/* Sales Order detail — read-only record page for an Order line. */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { type Order } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { listOrders } from "./ordersApi";

export function OrderDetail() {
  const { id = "" } = useParams();
  const orderId = decodeURIComponent(id);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void listOrders().then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.ok) setOrders(res.orders);
    });
    return () => {
      alive = false;
    };
  }, []);

  const order = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);

  if (loading && !order) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading order…</div>;
  }
  if (!order) {
    return <RecordDetail backTo="/orders" title="Order not found" fields={[]} hiddenStorageKey="orderDetailFields" />;
  }

  const fields: RecordField[] = [
    { key: "id", label: "Order ID", value: order.id },
    { key: "poNumber", label: "PO Number", value: order.poNumber },
    { key: "party", label: "Party", value: `${order.flag} ${order.party}` },
    { key: "country", label: "Country", value: order.country },
    { key: "design", label: "Design", value: order.design },
    { key: "size", label: "Size", value: order.size },
    { key: "finish", label: "Finish", value: order.finish },
    { key: "brand", label: "Brand", value: order.brand },
    { key: "orderQty", label: "Order Qty", value: fmt(order.orderQty) },
    { key: "loadedQty", label: "Loaded Qty", value: fmt(order.loadedQty) },
    { key: "stage", label: "Stage", value: order.stage },
    { key: "orderDate", label: "Order Date", value: order.orderDate },
    { key: "dueDate", label: "Due Date", value: order.dueDate },
    { key: "salesperson", label: "Salesperson", value: order.salesperson || "—" },
    { key: "invoice", label: "Invoice", value: order.invoice || "—" },
  ];

  return (
    <RecordDetail
      backTo="/orders"
      title={order.poNumber}
      subtitle={`${order.flag} ${order.party} · ${order.design}`}
      fields={fields}
      hiddenStorageKey="orderDetailFields"
      activityTable="SalesOrder"
    />
  );
}
