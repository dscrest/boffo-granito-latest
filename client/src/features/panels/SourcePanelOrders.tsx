/* ============================================================
   Panel Orders raised from one Quote / Sales Order (CR-286) — the
   "Panel Orders" tab on QuoteDetail and OrderDetail. Read-only list;
   a row opens the panel order (status is changed there, CR-287).
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { EmptyState } from "@/ui/States";
import { fmt } from "@/lib/format";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { ORDER_STATUS_TONE } from "./pcBits";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedPanelOrders, listPanelOrders, PANEL_ORDER_STATUS_LABEL, type PanelOrderRow } from "./panelOrdersApi";

export function SourcePanelOrders({ salesOrderId, quoteId }: { salesOrderId?: string; quoteId?: string }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  useEffect(() => {
    void listPanelOrders().then((r) => r.ok && setOrders(r.orders));
    void listPanels().then((r) => r.ok && setPanels(r.panels));
  }, []);

  const rows = orders.filter((o) => (salesOrderId && o.salesOrderId === salesOrderId) || (quoteId && o.quoteId === quoteId));
  const panelById = new Map(panels.map((p) => [p.id, p]));

  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <EmptyState title="No panel requests yet" hint="Use More → Request Panels to raise one" />
      </div>
    );
  }
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Panel</th>
              <th className="num" style={{ textAlign: "right" }}>Qty</th>
              <th>Order Date</th>
              <th>Sales Person</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const to = `/panel-orders/${encodeURIComponent(o.id)}`;
              return (
                <tr
                  key={o.id}
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  title="Open panel order"
                  onClick={() => navigate(to)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) navigate(to);
                  }}
                >
                  <td className="mono">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <ImageThumb images={panelById.get(o.panelId)?.images ?? []} alt={o.panelCode} />
                      {o.panelCode}
                    </span>
                  </td>
                  <td className="num mono">{fmt(o.qty)}</td>
                  <td className="mono muted">{o.orderDate || "—"}</td>
                  <td>{o.salesperson || "—"}</td>
                  <td>
                    <Chip tone={ORDER_STATUS_TONE[o.status]} label={codeOf(PANEL_ORDER_STATUS_LABEL[o.status])} title={PANEL_ORDER_STATUS_LABEL[o.status]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
