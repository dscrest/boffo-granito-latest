/* ============================================================
   Panels — "which showcase panels touch this record?", one component
   for the Item (Design) detail tab and the Customer detail section.

   Design scope: panels whose Product Showcase lines contain the design.
   Customer scope: that customer's panel orders, lifecycle status shown
   (Received → In Cutting → Ready → Dispatched) — the order IS the
   "sent panel" record once dispatched.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fmt } from "@/lib/format";
import { EmptyState } from "@/ui/States";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedPanelOrders, listPanelOrders, PANEL_ORDER_STATUS_LABEL, type PanelOrderRow } from "./panelOrdersApi";

export type PanelsScope =
  | { kind: "design"; designId: string }
  | { kind: "customer"; customerId: string };

export function PanelsPanel({ scope }: { scope: PanelsScope }) {
  // Seed from the module caches so switching records never flashes a skeleton.
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [loading, setLoading] = useState(() => cachedPanels() == null);

  useEffect(() => {
    let alive = true;
    void Promise.all([listPanels(), listPanelOrders()]).then(([p, o]) => {
      if (!alive) return;
      setLoading(false);
      if (p.ok) setPanels(p.panels);
      if (o.ok) setOrders(o.orders);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Hosts pass `scope` as an inline literal, so key the memos on its contents.
  const scopeKey = JSON.stringify(scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const myPanels = useMemo(
    () => (scope.kind === "design" ? panels.filter((p) => p.lines.some((l) => l.designId === scope.designId)) : []),
    [panels, scopeKey],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const myOrders = useMemo(
    () => (scope.kind === "customer" ? orders.filter((o) => o.customerId === scope.customerId) : []),
    [orders, scopeKey],
  );

  if (loading && panels.length === 0) return <div className="muted mono" style={{ padding: 18 }}>Loading panels…</div>;

  if (scope.kind === "design") {
    if (myPanels.length === 0) {
      return (
        <div className="card" style={{ padding: 14 }}>
          <EmptyState title="Not on any panel yet" hint="Panels using this design show here (Sales ▸ Panel Craft)" />
        </div>
      );
    }
    return (
      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Panel Code</th>
                <th>Panel Size</th>
                <th>Cut Piece Size</th>
                <th className="num" style={{ textAlign: "right" }}>Cut Piece Qty</th>
              </tr>
            </thead>
            <tbody>
              {myPanels.map((p) => {
                const line = p.lines.find((l) => l.designId === scope.designId)!;
                return (
                  <tr key={p.id}>
                    <td className="mono">
                      <Link className="linkish" to={`/panels/${encodeURIComponent(p.id)}`} title="Open panel">{p.panelCode}</Link>
                    </td>
                    <td className="mono muted">{p.panelSize || "—"}</td>
                    <td className="mono">{line.cutSizeName || "—"}</td>
                    <td className="num mono">{fmt(line.qty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (myOrders.length === 0) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <EmptyState title="No showcase panels yet" hint="Panel orders for this customer show here (Sales ▸ Panel Craft)" />
      </div>
    );
  }
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Panel Code</th>
              <th className="num" style={{ textAlign: "right" }}>Qty</th>
              <th>Order Date</th>
              <th>Sales Person</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {myOrders.map((o) => (
              <tr key={o.id}>
                <td className="mono">
                  <Link className="linkish" to={`/panels/${encodeURIComponent(o.panelId)}`} title="Open panel">{o.panelCode}</Link>
                </td>
                <td className="num mono">{fmt(o.qty)}</td>
                <td className="mono muted">{o.orderDate || "—"}</td>
                <td>{o.salesperson || "—"}</td>
                <td>{PANEL_ORDER_STATUS_LABEL[o.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
