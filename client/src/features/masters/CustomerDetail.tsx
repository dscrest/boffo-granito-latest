/* Customer detail — read-only record page for a Party (Customer),
   hydrated from the live Customer master + live orders. */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { SkeletonRows } from "@/ui/States";
import { useOrders } from "@/features/orders/useOrders";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { listCustomers, type CustomerRow } from "./customersApi";

export function CustomerDetail() {
  const { id = "" } = useParams();
  const code = decodeURIComponent(id);
  const { orders: allOrders } = useOrders();
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);

  useEffect(() => {
    void listCustomers().then((res) => setCustomers(res.ok ? res.customers : []));
  }, []);

  if (customers === null) {
    return <SkeletonRows rows={6} />;
  }

  const party = customers.find((c) => c.code === code) ?? null;
  if (!party) {
    return (
      <RecordDetail backTo="/parties" title="Customer not found" fields={[]} hiddenStorageKey="customerDetailFields" />
    );
  }

  const orders = allOrders.filter((o) => o.partyCode === party.code);
  const totalQty = orders.reduce((s, o) => s + o.orderQty, 0);

  const fields: RecordField[] = [
    { key: "name", label: "Name", value: party.name },
    { key: "code", label: "Code", value: party.code },
    { key: "country", label: "Country", value: party.country || "—" },
    { key: "currency", label: "Currency", value: party.currency || "—" },
    { key: "paymentTerm", label: "Payment Term", value: party.paymentTermLabel || "—" },
    { key: "port", label: "Port of Discharge", value: party.portOfDischarge || "—" },
    { key: "address", label: "Address", value: party.address || "—" },
    { key: "active", label: "Active", value: party.active ? "Yes" : "No" },
    { key: "orders", label: "Open Orders", value: String(orders.length) },
    { key: "totalQty", label: "Total Qty (sqm)", value: fmt(totalQty) },
  ];

  return (
    <RecordDetail
      backTo="/parties"
      title={`${party.flag} ${party.name}`}
      subtitle={`${party.code} · ${orders.length} orders`}
      fields={fields}
      hiddenStorageKey="customerDetailFields"
      activityTable="Customer"
      entityId={party.id}
    >
      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Design</th>
                <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                <th>Stage</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono" style={{ color: "var(--fg)" }}>{o.poNumber}</td>
                  <td>{o.design}</td>
                  <td className="num mono">{fmt(o.orderQty)}</td>
                  <td>{o.stage}</td>
                  <td className="mono muted">{o.dueDate}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No orders for this customer.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RecordDetail>
  );
}
