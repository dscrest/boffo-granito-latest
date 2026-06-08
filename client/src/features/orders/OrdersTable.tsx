/* All Orders table — ported verbatim from prototype/views.jsx. */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass } from "@/lib/format";
import { ORDERS, STAGES } from "@/data";

export function OrdersTable() {
  const [tab, setTab] = useState("all");
  const filtered = useMemo(() => {
    if (tab === "all") return ORDERS;
    return ORDERS.filter((o) => o.stage === tab);
  }, [tab]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">All Orders</div>
          <div className="sub">
            {filtered.length} of {ORDERS.length} orders · grouped by stage
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            Export CSV
          </button>
          <button className="hbtn primary">
            <Icon name="plus" size={13} />
            New Order
          </button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          All{" "}
          <span className="muted mono" style={{ marginLeft: 4 }}>
            {ORDERS.length}
          </span>
        </div>
        {STAGES.map((s) => (
          <div key={s.id} className={`tab ${tab === s.id ? "active" : ""}`} onClick={() => setTab(s.id)}>
            {s.label}{" "}
            <span className="muted mono" style={{ marginLeft: 4 }}>
              {ORDERS.filter((o) => o.stage === s.id).length}
            </span>
          </div>
        ))}
      </div>

      <div className="fbar">
        <button className="btn">
          <Icon name="filter" size={12} />
          Filters · 0
        </button>
        <button className="btn">Group: Stage</button>
        <button className="btn">Sort: Due date</button>
        <button className="btn">Color</button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Find any order, design, party…" />
        <button className="btn">Save view</button>
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>ID</th>
                <th>PO Number</th>
                <th>Party</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Order Qty
                </th>
                <th>Progress</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Remaining
                </th>
                <th>Stage</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const remaining = o.orderQty - o.loadedQty;
                return (
                  <tr key={o.id}>
                    <td className="muted mono" style={{ textAlign: "center" }}>
                      {i + 1}
                    </td>
                    <td className="mono muted">{o.id}</td>
                    <td className="mono" style={{ color: "var(--fg)" }}>
                      {o.poNumber}
                    </td>
                    <td>
                      <span style={{ marginRight: 6 }}>{o.flag}</span>
                      {o.party}
                    </td>
                    <td>
                      <span className="design-name">{o.design}</span>
                    </td>
                    <td>
                      <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                    </td>
                    <td>
                      <span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span>
                    </td>
                    <td>
                      <span className={`chip brand ${o.brand === "BIG" ? "big" : ""}`}>{o.brand}</span>
                    </td>
                    <td className="num">{fmt(o.orderQty)}</td>
                    <td style={{ width: 140 }}>
                      <SplitBar produced={o.producedQty} palletized={o.palletizedQty} loaded={o.loadedQty} total={o.orderQty} />
                    </td>
                    <td className="num">{fmt(remaining)}</td>
                    <td>
                      <StageBadge stage={o.stage} />
                    </td>
                    <td className="mono muted">{o.dueDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
