/* Purchase Order detail — read-only record page for a PO (grouped ORDERS). */
import { useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { ORDERS } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";

export function PurchaseOrderDetail() {
  const { id = "" } = useParams();
  const poNumber = decodeURIComponent(id);
  const items = ORDERS.filter((o) => o.poNumber === poNumber);
  const head = items[0] ?? null;

  if (!head) {
    return <RecordDetail backTo="/po" title="PO not found" fields={[]} hiddenStorageKey="poDetailFields" />;
  }

  const totalQty = items.reduce((s, o) => s + o.orderQty, 0);

  const fields: RecordField[] = [
    { key: "po", label: "PO Number", value: poNumber },
    { key: "party", label: "Party", value: `${head.flag} ${head.party}` },
    { key: "country", label: "Country", value: head.country },
    { key: "date", label: "Order Date", value: head.orderDate },
    { key: "dueDate", label: "Due Date", value: head.dueDate },
    { key: "stage", label: "Stage", value: head.stage },
    { key: "skus", label: "SKUs", value: String(items.length) },
    { key: "totalQty", label: "Total Qty (sqm)", value: fmt(totalQty) },
  ];

  return (
    <RecordDetail
      backTo="/po"
      title={poNumber}
      subtitle={`${head.flag} ${head.party} · ${items.length} SKUs`}
      fields={fields}
      hiddenStorageKey="poDetailFields"
    >
      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td><span className="design-name">{o.design}</span></td>
                  <td>{o.size}</td>
                  <td>{o.finish}</td>
                  <td className="num mono">{fmt(o.orderQty)}</td>
                  <td className="num mono">{fmt(o.loadedQty)}</td>
                  <td>{o.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </RecordDetail>
  );
}
