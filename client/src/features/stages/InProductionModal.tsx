/* ============================================================
   "In production" drill-down — shared across every screen that shows an
   item's in-production boxes (Order detail, Item detail, Production form,
   line-stock chips, Reports). One number, one popup, everywhere.

   The number is the design-wide total (boxes of this design running across
   ALL orders, not just the current line); clicking it lists which orders.
   Fed by `designStock(...).inProductionOrders` (see lib/stock.ts).
   ============================================================ */
import { useEffect } from "react";
import { fmt } from "@/lib/format";
import type { InProductionOrder } from "@/lib/stock";

/* Escape is handled on the capture phase so it dismisses ONLY this popup —
   a parent form's document-level Escape listener (useModalA11y) sits on the
   same node, where stopPropagation wouldn't reach it, so we stop first. */
export function InProductionModal({
  label,
  total,
  orders,
  onClose,
}: {
  label: string;
  total: number;
  orders: InProductionOrder[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel card" role="dialog" aria-modal="true" aria-label={`${label} — in production`} style={{ maxWidth: 520 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{label} — in production</div>
          <span className="muted" style={{ fontSize: 14 }}>{fmt(total)} boxes</span>
          <button className="btn x" onClick={onClose} title="Close" style={{ marginLeft: "auto" }} tabIndex={-1}>✕</button>
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 12 }}>
          Boxes of this design currently in production across all orders (requested, not yet output).
        </div>
        <div className="modal-body" style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Sales Order</th>
                <th className="num" style={{ textAlign: "right" }}>In production</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.salesOrderId || o.soLabel}>
                  <td>{o.customer || "—"}</td>
                  <td>{o.soLabel}</td>
                  <td className="num mono">{fmt(o.qty)}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={3}><span className="dim" style={{ padding: 8, display: "inline-block" }}>Nothing in production right now.</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* The in-production number as a table cell: a link-button when there are boxes
   running (click → popup), a plain "—" otherwise. Render inside a <td>. */
export function InProductionCell({ total, onOpen }: { total: number; onOpen: () => void }) {
  if (total > 0) {
    return (
      <button
        type="button"
        className="linkish mono"
        onClick={onOpen}
        title="See which orders have this design in production"
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
      >
        {fmt(total)}
      </button>
    );
  }
  return <span className="mono">—</span>;
}
