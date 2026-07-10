/* Production — active jobs + Log Production entry form. Entries write
   through the production-log saga (OrderItemEvent + produced bump);
   local `logs` is just this session's receipt list. */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { KPI, ProgressBar } from "@/ui/primitives";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { fmt, finishClass, pct } from "@/lib/format";
import { type Order } from "@/data";
import { useOrders } from "@/features/orders/useOrders";
import { logProduction } from "./palletisationApi";
import { ProductionForm, type ProductionLog } from "./ProductionForm";

export function Production() {
  const { orders, loading, error, reload } = useOrders();
  const [showForm, setShowForm] = useState(false);
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  const addLog = async (l: ProductionLog) => {
    const res = await logProduction({
      order_item: l.order,
      qty_boxes: parseInt(l.qty_delta, 10) || 0,
      production_date: l.production_date,
      shift: l.shift,
      performed_by: l.performed_by,
      note: l.note,
    });
    if (!res.ok) {
      toast.error(res.error || "Production log failed");
      return; // keep the form open — nothing was recorded
    }
    toast.success(`+${l.qty_delta} boxes logged — ${l.design}`);
    setLogs((p) => [l, ...p]);
    setShowForm(false);
    reload();
  };

  const prodOrders = useMemo(
    () => orders.filter((o) => o.stage === "prod" || o.stage === "packing"),
    [orders],
  );
  const grouped = useMemo(() => {
    const g: Record<string, Order[]> = {};
    prodOrders.forEach((o) => (g[o.size] ||= []).push(o));
    return g;
  }, [prodOrders]);
  const sizes = Object.keys(grouped);

  const totalProd = prodOrders.reduce((s, o) => s + o.producedQty, 0);
  const totalRem = prodOrders.reduce((s, o) => s + (o.orderQty - o.producedQty), 0);

  const showSkeleton = loading && orders.length === 0;

  return (
    <div>
      {showForm && <ProductionForm jobs={prodOrders} onSave={addLog} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Production</div>
          <div className="sub">
            {prodOrders.length} active jobs · orders in Production or Packing
            {logs.length > 0 && (
              <>
                {" · "}
                <span className="muted">{logs.length} log{logs.length > 1 ? "s" : ""} this session</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            Log Production
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={reload} />}

      {logs.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <Icon name="factory" size={13} className="ic" />
            <span style={{ fontWeight: 600 }}>Recent production logs</span>
            <span className="muted">· {logs.length} saved this session</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Design</th>
                <th>Order</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Produced
                </th>
                <th>Date</th>
                <th>Shift</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l._id}>
                  <td>
                    <span className="design-name">{l.design}</span>
                  </td>
                  <td className="mono muted">{l.orderLabel}</td>
                  <td className="num" style={{ color: "var(--c-blue)" }}>
                    +{fmt(parseInt(l.qty_delta, 10) || 0)}
                  </td>
                  <td className="mono muted">{l.production_date || "—"}</td>
                  <td className="muted">{l.shift.split(" ")[0]}</td>
                  <td className="muted">{l.performed_by || "—"}</td>
                  <td className="muted">{l.note || <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Live-computed only — no daily/on-time/yield tracking exists yet. */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <KPI label="Produced (active jobs)" value={fmt(totalProd)} unit="boxes" color="var(--c-blue)" />
        <KPI label="Remaining" value={fmt(totalRem)} unit="boxes" delta={`across ${prodOrders.length} jobs`} color="var(--c-amber)" />
        <KPI label="Active jobs" value={String(prodOrders.length)} color="var(--c-green)" />
      </div>

      <div className="sec-title">
        <h2>Active jobs</h2>
        <span className="meta">Grouped by size</span>
      </div>

      {showSkeleton && <SkeletonRows rows={8} />}

      {!showSkeleton && sizes.length === 0 && (
        <EmptyState
          icon="factory"
          title="No production jobs"
          hint="Orders in the Production or Packing stage will appear here."
        />
      )}

      {!showSkeleton && sizes.map((size) => (
        <div key={size} className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <span className={`chip size ${size.startsWith("200") || size.startsWith("75") ? "b" : ""}`}>{size}</span>
            <span className="muted">
              · {grouped[size].length} jobs · {fmt(grouped[size].reduce((s, o) => s + o.orderQty, 0))} boxes
            </span>
            <div className="right muted">Tap a row to log production</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Design</th>
                <th>Finish</th>
                <th>Customer</th>
                <th>PO</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Ordered (boxes)
                </th>
                <th className="num" style={{ textAlign: "right" }}>
                  Produced (boxes)
                </th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {grouped[size].map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="design-name">{o.design}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span>
                  </td>
                  <td>{o.party}</td>
                  <td className="mono">{o.poNumber}</td>
                  <td className="num">{fmt(o.orderQty)}</td>
                  <td className="num" style={{ color: "var(--c-blue)" }}>
                    {fmt(o.producedQty)}
                  </td>
                  <td style={{ width: 160 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <ProgressBar value={o.producedQty} max={o.orderQty} color="var(--c-blue)" height={5} />
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                        {pct(o.producedQty, o.orderQty)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
