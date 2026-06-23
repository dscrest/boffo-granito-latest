/* Item (Design) detail — read-only record page for a Design,
   hydrated from the live Design master + live orders. */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { SkeletonRows } from "@/ui/States";
import { useOrders } from "@/features/orders/useOrders";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { listDesigns, type DesignRow } from "./designsApi";
import { designImageUrl } from "@/lib/api";

export function ItemDetail() {
  const { id = "" } = useParams();
  const name = decodeURIComponent(id);
  const { orders: allOrders } = useOrders();
  const [designs, setDesigns] = useState<DesignRow[] | null>(null);

  useEffect(() => {
    void listDesigns().then((res) => setDesigns(res.ok ? res.designs : []));
  }, []);

  if (designs === null) {
    return <SkeletonRows rows={6} />;
  }

  const design = designs.find((d) => d.designName === name) ?? null;
  if (!design) {
    return <RecordDetail backTo="/design" title="Item not found" fields={[]} hiddenStorageKey="itemDetailFields" />;
  }

  const orders = allOrders.filter((o) => o.design === design.designName);
  const openQty = orders.reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);

  const fields: RecordField[] = [
    { key: "name", label: "Design Name", value: design.designName },
    { key: "sku", label: "SKU", value: design.sku || "—" },
    { key: "size", label: "Size", value: design.sizeLabel || "—" },
    { key: "finish", label: "Finish", value: design.finishLabel || "—" },
    { key: "brand", label: "Brand", value: design.brandLabel || "—" },
    { key: "category", label: "Category", value: design.categoryLabel || "—" },
    { key: "pos", label: "Active POs", value: String(orders.length) },
    { key: "openQty", label: "Open Qty", value: fmt(openQty) },
  ];

  return (
    <RecordDetail
      backTo="/design"
      title={design.designName}
      subtitle={`${design.sizeLabel} · ${design.finishLabel} · ${design.brandLabel}`}
      fields={fields}
      hiddenStorageKey="itemDetailFields"
      activityTable="Design"
      entityId={design.id}
    >
      {design.images.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {design.images.map((imgId, i) => (
            <img
              key={imgId + i}
              src={designImageUrl(imgId)}
              alt={`${design.designName} ${i + 1}`}
              style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      )}
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
