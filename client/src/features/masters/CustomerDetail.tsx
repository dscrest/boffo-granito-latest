/* Customer detail — read-only record page for a Party (Customer),
   hydrated from the live Customer master + live orders. */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { SkeletonRows } from "@/ui/States";
import { useOrders } from "@/features/orders/useOrders";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { composeAddress, contactName, listCustomers, type CustomerRow } from "./customersApi";

export function CustomerDetail() {
  const { id = "" } = useParams();
  const code = decodeURIComponent(id);
  const navigate = useNavigate();
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
    { key: "mainParty", label: "Main Party", value: party.extras.main_party_name || "—" },
    { key: "country", label: "Country", value: party.country || "—" },
    { key: "workingStatus", label: "Working Status", value: party.extras.working_status || "—" },
    { key: "handlingPerson", label: "Handling Person", value: party.handlingPersonLabel || "—" },
    { key: "currency", label: "Currency", value: party.currency || "—" },
    { key: "paymentTerm", label: "Payment Term", value: party.paymentTermLabel || "—" },
    { key: "port", label: "Port of Discharge", value: party.portOfDischarge || "—" },
    { key: "contact", label: "Contact Person", value: contactName(party.extras) || "—" },
    { key: "contactEmail", label: "Email", value: party.extras.contact_email || "—" },
    {
      key: "contactPhone",
      label: "Phone",
      value:
        [party.extras.contact_work_phone, party.extras.contact_mobile].filter(Boolean).join(" / ") || "—",
    },
    { key: "billing", label: "Billing Address", value: composeAddress(party.extras, "billing") || party.address || "—" },
    { key: "shipping", label: "Shipping Address", value: composeAddress(party.extras, "shipping") || "—" },
    { key: "active", label: "Active", value: party.active ? "Yes" : "No" },
    { key: "orders", label: "Open Orders", value: String(orders.length) },
    { key: "totalQty", label: "Total Qty (boxes)", value: fmt(totalQty) },
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
      created={party.createdTime}
      modified={party.modifiedTime}
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
                <tr
                  key={o.id}
                  style={{ cursor: "pointer" }}
                  title="Open order details"
                  onClick={() => navigate(`/orders/${encodeURIComponent(o.id)}`)}
                >
                  <td className="mono" style={{ color: "var(--accent)" }}>{o.poNumber}</td>
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
