/* ============================================================
   Panel Orders raised from one Quote / Sales Order (CR-286) — the
   "Panel Orders" tab on QuoteDetail and OrderDetail. Read-only list,
   one row per order (CR-302: an order holds several panels); a row
   opens the panel order (status is changed there, CR-287).
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
              <th>Panels</th>
              <th className="num" style={{ textAlign: "right" }}>Qty</th>
              <th>Order Date</th>
              <th>Status</th>
              <th>Order No</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const to = `/panel-orders/${encodeURIComponent(o.id)}`;
              const codes = o.lines.map((l) => l.panelCode).join(", ");
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
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <ImageThumb images={panelById.get(o.lines[0]?.panelId ?? "")?.images ?? []} alt={codes} />
                      <span className="mono" title={codes}>{codes || "—"}</span>
                    </span>
                  </td>
                  <td className="num mono">{fmt(o.totalQty)}</td>
                  <td className="mono muted">{o.orderDate || "—"}</td>
                  <td>
                    <Chip tone={ORDER_STATUS_TONE[o.status]} label={codeOf(PANEL_ORDER_STATUS_LABEL[o.status])} title={PANEL_ORDER_STATUS_LABEL[o.status]} />
                  </td>
                  <td className="mono dim">{o.orderNumber || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
