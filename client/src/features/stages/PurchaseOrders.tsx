/* Purchase Orders — ported verbatim from prototype/views2.jsx. */
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ProgressBar, StageBadge } from "@/ui/primitives";
import { fmt, pct } from "@/lib/format";
import { ORDERS, type Order } from "@/data";

export function PurchaseOrders() {
  const navigate = useNavigate();
  const groups: Record<string, Order[]> = {};
  ORDERS.forEach((o) => (groups[o.poNumber] ||= []).push(o));
  const pos = Object.entries(groups)
    .map(([po, items]) => ({
      po,
      items,
      party: items[0].party,
      flag: items[0].flag,
      country: items[0].country,
      totalQty: items.reduce((s, o) => s + o.orderQty, 0),
      skus: items.length,
      date: items[0].orderDate,
      dueDate: items[0].dueDate,
      daysFromPI: items[0].daysFromPI,
      stage: items[0].stage,
      progress: pct(
        items.reduce((s, o) => s + o.producedQty, 0),
        items.reduce((s, o) => s + o.orderQty, 0),
      ),
    }))
    .sort((a, b) => b.totalQty - a.totalQty);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Purchase Orders</div>
          <div className="sub">
            {pos.length} POs · {fmt(pos.reduce((s, p) => s + p.totalQty, 0))} sqm total
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            Export
          </button>
          <button className="hbtn primary">
            <Icon name="plus" size={13} />
            Create PO
          </button>
        </div>
      </div>

      <div className="fbar">
        <button className="btn active">All POs</button>
        <button className="btn">Open</button>
        <button className="btn">Partially shipped</button>
        <button className="btn">Closed</button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search PO number, party…" />
        <button className="btn">
          <Icon name="filter" size={12} />
          Filter
        </button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>#</th>
              <th>PO Number</th>
              <th>Party</th>
              <th>Date</th>
              <th className="num" style={{ textAlign: "right" }}>
                Days from PI
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Order Qty
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                SKUs
              </th>
              <th>Progress</th>
              <th>Stage</th>
              <th>Docs</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p, i) => (
              <tr key={p.po + i}>
                <td className="muted mono" style={{ textAlign: "center" }}>
                  {i + 1}
                </td>
                <td className="mono">
                  <button
                    className="linkish"
                    style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                    onClick={() => navigate(`/po/${encodeURIComponent(p.po)}`)}
                    title="Open details"
                  >
                    {p.po}
                  </button>
                </td>
                <td>
                  {p.flag} {p.party}{" "}
                  <span className="muted" style={{ fontSize: 10.5 }}>
                    ({p.country})
                  </span>
                </td>
                <td className="mono muted">{p.date}</td>
                <td className="num">{p.daysFromPI}</td>
                <td className="num">{fmt(p.totalQty)}</td>
                <td className="num">{p.skus}</td>
                <td style={{ width: 160 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <ProgressBar
                      value={p.progress}
                      max={100}
                      color={p.progress > 75 ? "var(--c-green)" : p.progress > 30 ? "var(--c-amber)" : "var(--c-blue)"}
                      height={5}
                    />
                    <span className="mono" style={{ fontSize: 11, color: "var(--muted)", minWidth: 32 }}>
                      {p.progress}%
                    </span>
                  </div>
                </td>
                <td>
                  <StageBadge stage={p.stage} />
                </td>
                <td>
                  <span className="row" style={{ gap: 4 }}>
                    <span title="PI" className="pill" style={{ height: 16, padding: "0 4px", fontSize: 10 }}>
                      PI
                    </span>
                    <span title="PO" className="pill" style={{ height: 16, padding: "0 4px", fontSize: 10 }}>
                      PO
                    </span>
                    {p.stage === "final" && (
                      <span
                        title="Invoice"
                        className="pill"
                        style={{ height: 16, padding: "0 4px", fontSize: 10, color: "var(--c-green)", borderColor: "oklch(0.78 0.16 145 / 0.4)" }}
                      >
                        INV
                      </span>
                    )}
                  </span>
                </td>
                <td className="mono muted">{p.dueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
