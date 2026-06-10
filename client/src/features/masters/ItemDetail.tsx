/* Item (Design) detail — read-only record page for a Design. */
import { useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { DESIGNS, ORDERS } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";

export function ItemDetail() {
  const { id = "" } = useParams();
  const name = decodeURIComponent(id);
  const design = DESIGNS.find((d) => d.name === name) ?? null;

  if (!design) {
    return <RecordDetail backTo="/design" title="Item not found" fields={[]} hiddenStorageKey="itemDetailFields" />;
  }

  const orders = ORDERS.filter((o) => o.design === design.name);
  const openQty = orders.reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);

  const fields: RecordField[] = [
    { key: "name", label: "Design Name", value: design.name },
    { key: "size", label: "Size", value: design.size },
    { key: "finish", label: "Finish", value: design.finish },
    { key: "brand", label: "Brand", value: design.brand },
    { key: "category", label: "Category", value: design.category },
    { key: "pos", label: "Active POs", value: String(orders.length) },
    { key: "openQty", label: "Open Qty", value: fmt(openQty) },
  ];

  return (
    <RecordDetail
      backTo="/design"
      title={design.name}
      subtitle={`${design.size} · ${design.finish} · ${design.brand}`}
      fields={fields}
      hiddenStorageKey="itemDetailFields"
      activityTable="Design"
    >
      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Party</th>
                <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono" style={{ color: "var(--fg)" }}>{o.poNumber}</td>
                  <td>{o.flag} {o.party}</td>
                  <td className="num mono">{fmt(o.orderQty)}</td>
                  <td>{o.stage}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No orders use this item.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RecordDetail>
  );
}
