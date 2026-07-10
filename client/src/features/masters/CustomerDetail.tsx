/* ============================================================
   Customer detail — same split view as the Item (Design) detail page.
   Left: resizable, searchable list of customers. Right: header with
   Edit / More (Delete) / ✕, Primary Details, the customer's orders,
   and the Activity log.

   Route is keyed by customer *code* (/parties/:id); mutations use the
   row's ROWID. Edit opens the shared PartyForm modal in place.
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { canDelete, canUpdate } from "@/lib/auth";
import { STAGES } from "@/data";
import { fmt, fmtLocalDateTime } from "@/lib/format";
import { useOrders } from "@/features/orders/useOrders";
import { ActivityLog } from "@/features/common/RecordDetail";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { PartyForm } from "./PartyForm";
import {
  cachedCustomers,
  composeAddress,
  contactName,
  deleteCustomer,
  listCustomers,
  updateCustomer,
  type CustomerInput,
  type CustomerRow,
  type PaymentTermOption,
} from "./customersApi";

/** [label, value, isUnset] — unset fields read "Not set" (dimmed) rather than a bare dash. */
type Detail = [string, string, boolean];
const text = (label: string, s: string): Detail => [label, s || "Not set", !s];

const rows = (c: CustomerRow): Detail[] => [
  text("Display Name", c.name),
  text("Company Name", c.extras.company_name),
  text("Customer Type", c.extras.customer_type && c.extras.customer_type[0].toUpperCase() + c.extras.customer_type.slice(1)),
  text("Customer Number", c.code),
  text("Main Customer", c.extras.main_party_name),
  text("Country", c.country),
  text("Sales Person", c.handlingPersonLabel),
  text("Currency", c.currency),
  text("Payment Term", c.paymentTermLabel),
  text("Port of Discharge", c.portOfDischarge),
  text("Contact Person", contactName(c.extras)),
  text("Email", c.extras.contact_email),
  text("Phone", [c.extras.contact_work_phone, c.extras.contact_mobile].filter(Boolean).join(" / ")),
  text("Billing Address", composeAddress(c.extras, "billing") || c.address),
  text("Shipping Address", composeAddress(c.extras, "shipping")),
  ["Active", c.active ? "Yes" : "No", false],
  ["Created", fmtLocalDateTime(c.createdTime), false],
  ["Modified", fmtLocalDateTime(c.modifiedTime), false],
];

export function CustomerDetail() {
  const { id = "" } = useParams();
  const code = decodeURIComponent(id);
  const navigate = useNavigate();
  const { orders: allOrders } = useOrders();
  // Seed from cache so switching customers never flashes a skeleton.
  const [customers, setCustomers] = useState<CustomerRow[] | null>(() => cachedCustomers());
  // Pick-list options the edit form needs — listCustomers() already returns them.
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [salesPersons, setSalesPersons] = useState<PaymentTermOption[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const refresh = () =>
    listCustomers().then((res) => {
      setCustomers(res.ok ? res.customers : (cachedCustomers() ?? []));
      if (res.ok) {
        setPaymentTerms(res.paymentTerms);
        setSalesPersons(res.salesPersons);
      }
    });
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (customers === null) return <SkeletonRows rows={6} />;

  const party = customers.find((c) => c.code === code) ?? null;
  const orders = party ? allOrders.filter((o) => o.partyCode === party.code) : [];
  const totalQty = orders.reduce((s, o) => s + o.orderQty, 0);
  // One row per PO (SalesOrder) — its design lines collapse into a single
  // entry: qty summed, stage = the least-advanced line's stage.
  const stageRank = (s: string | undefined) => Math.max(0, STAGES.findIndex((st) => st.id === s));
  const byPo = new Map<string, (typeof orders)[number] & { designs: string[] }>();
  for (const o of orders) {
    const poKey = o.salesOrderId || o.id; // lines without a parent SO stay separate
    const g = byPo.get(poKey);
    if (!g) byPo.set(poKey, { ...o, designs: [o.design] });
    else {
      g.designs.push(o.design);
      g.orderQty += o.orderQty;
      if (stageRank(o.stage) < stageRank(g.stage)) g.stage = o.stage;
    }
  }
  const poRows = [...byPo.values()];
  // 10 most recent transactions, shown beside Primary Details.
  const recent = poRows.sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? "")).slice(0, 10);
  const needle = q.trim().toLowerCase();
  const listed = needle
    ? customers.filter((c) => `${c.name} ${c.code} ${c.country}`.toLowerCase().includes(needle))
    : customers;

  const onSave = async (input: CustomerInput) => {
    if (!party) return;
    const res = await updateCustomer(party.id, input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(false);
    toast.success("Customer updated");
    // The URL is keyed by code — follow a code change or the page 404s.
    const newCode = input.code.trim().toUpperCase();
    if (newCode !== party.code) {
      navigate(`/parties/${encodeURIComponent(newCode)}`, { replace: true });
    }
    await refresh();
  };

  const onDelete = async () => {
    if (!party) return;
    if (
      !(await confirmDialog({
        message: `Are you sure you want to delete customer "${party.name}"? This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const res = await deleteCustomer(party.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Customer deleted");
    navigate("/parties");
  };

  const moreItems = canDelete() ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : [];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {editing && party && (
        <PartyForm
          paymentTerms={paymentTerms}
          salesPersons={salesPersons}
          isEdit
          initial={{
            code: party.code,
            name: party.name,
            country_code: party.countryCode,
            currency: party.currency,
            payment_term: party.paymentTermId,
            port_of_discharge: party.portOfDischarge,
            address: party.address,
            active: party.active,
            ...party.extras,
          }}
          onSave={(input) => void onSave(input)}
          onClose={() => setEditing(false)}
        />
      )}

      {/* Customer list — fixed viewport height with its OWN scroll, sticky while
          the detail scrolls. Drag the bottom-right corner to resize the width. */}
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
        <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
          <input
            type="text"
            placeholder="Search customers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((c) => {
            const cur = c.code === code;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/parties/${encodeURIComponent(c.code)}`)}
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
                }}
                title={c.name}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.name}
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[c.code, c.country].filter(Boolean).join("  ·  ") || "No details yet"}
                </div>
              </button>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching customers</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!party ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Customer not found" hint="Pick a customer from the list" />
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              {/* Header inside the card so it top-aligns with the list (Zoho-style). */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  className="title"
                  style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={party.name}
                >
                  {party.name}
                </div>
                {canUpdate() && (
                  <button className="hbtn" onClick={() => setEditing(true)} disabled={busy} title="Edit customer">
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
                <button className="btn x" onClick={() => navigate("/parties")} title="Close">
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                {[party.code, `${poRows.length} orders`, !party.active && "Inactive"].filter(Boolean).join("  ·  ")}
              </div>

              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start", marginTop: 14 }}>
                <div style={{ flex: "1 1 460px", maxWidth: 520, minWidth: 0 }}>
                  <div className="form-section-title" style={{ marginBottom: 8 }}>Primary Details</div>
                  {rows(party).map(([label, value, unset]) => (
                    <DetailRow key={label} label={label} value={value} dim={unset} />
                  ))}
                </div>

                {/* The customer's 10 most recent orders — rows open the Master Order. */}
                <div style={{ flex: "1 1 380px", minWidth: 0 }}>
                  <div className="form-section-title" style={{ marginBottom: 8 }}>
                    Associated Orders {poRows.length > 0 && <span className="dim">({poRows.length} · {fmt(totalQty)} boxes)</span>}
                  </div>
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
                        {recent.map((o) => (
                          <tr
                            key={o.id}
                            style={{ cursor: "pointer" }}
                            title="Open order details"
                            onClick={() => navigate(`/orders/${encodeURIComponent(o.id)}`)}
                          >
                            <td className="mono" style={{ color: "var(--accent)" }}>{o.poNumber}</td>
                            <td>{o.designs.length > 1 ? `${o.designs.length} designs` : o.designs[0]}</td>
                            <td className="num mono">{fmt(o.orderQty)}</td>
                            <td>{o.stage}</td>
                            <td className="mono muted">{o.dueDate}</td>
                          </tr>
                        ))}
                        {poRows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No orders for this customer.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {poRows.length > recent.length && (
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>
                      Showing the 10 most recent of {poRows.length} orders.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Audit trail: who created / changed this customer, from OperationLog. */}
            <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Activity</div>
            <ActivityLog table="Customer" entityId={party.id} />
          </>
        )}
      </div>
    </div>
  );
}
