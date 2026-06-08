/* Production — ported verbatim from prototype/views.jsx. */
import { Icon } from "@/ui/Icon";
import { KPI, ProgressBar } from "@/ui/primitives";
import { fmt, finishClass, pct } from "@/lib/format";
import { ORDERS, type Order } from "@/data";

export function Production() {
  const prodOrders = ORDERS.filter((o) => o.stage === "prod" || o.stage === "packing");
  const grouped: Record<string, Order[]> = {};
  prodOrders.forEach((o) => (grouped[o.size] ||= []).push(o));
  const sizes = Object.keys(grouped);

  const totalProd = prodOrders.reduce((s, o) => s + o.producedQty, 0);
  const totalRem = prodOrders.reduce((s, o) => s + (o.orderQty - o.producedQty), 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Production</div>
          <div className="sub">{prodOrders.length} active jobs · Plant Morbi · Shift A (07:00–15:00)</div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="calendar" size={13} />
            26 May 2026
          </button>
          <button className="hbtn primary">
            <Icon name="plus" size={13} />
            Log Production
          </button>
        </div>
      </div>

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

      {sizes.map((size) => (
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
