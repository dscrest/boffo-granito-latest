/* Production — active jobs + Log Production entry form. Logged
   entries kept in local `logs` state (frontend-only, not persisted). */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { KPI, ProgressBar } from "@/ui/primitives";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt, finishClass, pct } from "@/lib/format";
import { type Order } from "@/data";
import { useOrders } from "@/features/orders/useOrders";
import { ProductionForm, type ProductionLog } from "./ProductionForm";

export function Production() {
  const { orders, loading, error, reload } = useOrders();
  const [showForm, setShowForm] = useState(false);
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  const addLog = (l: ProductionLog) => {
    setLogs((p) => [l, ...p]);
    setShowForm(false);
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
            {prodOrders.length} active jobs · Plant Morbi · Shift A (07:00–15:00)
            {logs.length > 0 && (
              <>
                {" · "}
                <span className="dim">{logs.length} unsaved log{logs.length > 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="calendar" size={13} />
            26 May 2026
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            Log Production
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={reload} />}

      {logs.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--accent)" }}>
          <div className="card-head">
            <Icon name="factory" size={13} className="ic" />
            <span style={{ fontWeight: 600 }}>Recent production logs</span>
            <span className="muted">· {logs.length} this session (local draft)</span>
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

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPI label="Produced Today" value={fmt(totalProd / 1000) + "k"} unit="sqm" delta="+4.2k vs target" trend="up" spark={[5, 6, 7, 9, 8, 10, 12]} color="var(--c-blue)" />
        <KPI label="Remaining" value={fmt(totalRem / 1000) + "k"} unit="sqm" delta="across 25 SKUs" spark={[12, 10, 9, 8, 7, 6, 5]} color="var(--c-amber)" />
        <KPI label="On-Time %" value="94" unit="%" delta="+2.1% MoM" trend="up" spark={[6, 7, 8, 9, 8, 9, 10]} color="var(--c-green)" />
        <KPI label="Yield (Premium)" value="88.4" unit="%" delta="-0.8% vs avg" trend="down" spark={[9, 8, 9, 7, 8, 7, 8]} color="var(--c-violet)" />
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
              · {grouped[size].length} jobs · {fmt(grouped[size].reduce((s, o) => s + o.orderQty, 0))} sqm
            </span>
            <div className="right muted">Tap a row to log production</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Design</th>
                <th>Finish</th>
                <th>Party</th>
                <th>PO</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Ordered
                </th>
                <th className="num" style={{ textAlign: "right" }}>
                  Produced
                </th>
                <th className="num" style={{ textAlign: "right" }}>
                  Today
                </th>
                <th>Progress</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {grouped[size].slice(0, 8).map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="design-name">{o.design}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span>
                  </td>
                  <td>
                    {o.flag} {o.party}
                  </td>
                  <td className="mono">{o.poNumber}</td>
                  <td className="num">{fmt(o.orderQty)}</td>
                  <td className="num" style={{ color: "var(--c-blue)" }}>
                    {fmt(o.producedQty)}
                  </td>
                  <td className="num" style={{ color: "var(--c-green)" }}>
                    +{fmt(Math.round(o.producedQty * 0.12))}
                  </td>
                  <td style={{ width: 160 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <ProgressBar value={o.producedQty} max={o.orderQty} color="var(--c-blue)" height={5} />
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                        {pct(o.producedQty, o.orderQty)}%
                      </span>
                    </div>
                  </td>
                  <td className="muted mono">26/4 · 14:32</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
