/* Design Master — ported verbatim from prototype/views2.jsx. */
import { Icon } from "@/ui/Icon";
import { fmt, finishClass } from "@/lib/format";
import { DESIGNS, FINISHES, ORDERS, SIZES } from "@/data";

export function DesignMaster() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Design Master</div>
          <div className="sub">
            {DESIGNS.length} designs · {SIZES.length} sizes · {FINISHES.length} finishes
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            Export
          </button>
          <button className="hbtn primary">
            <Icon name="plus" size={13} />
            New design
          </button>
        </div>
      </div>

      <div className="fbar">
        <button className="btn active">All</button>
        <button className="btn">600x1200</button>
        <button className="btn">200x1200</button>
        <button className="btn">600x600</button>
        <button className="btn">75x600</button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search design…" />
        <button className="btn">Group by Brand</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>#</th>
              <th>Design Name</th>
              <th>Base Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th>Brand</th>
              <th>Glaze</th>
              <th className="num" style={{ textAlign: "right" }}>
                Active POs
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Open Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {DESIGNS.map((d, i) => {
              const open = ORDERS.filter((o) => o.design === d.name).reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);
              const pos = ORDERS.filter((o) => o.design === d.name).length;
              return (
                <tr key={d.name}>
                  <td className="muted mono" style={{ textAlign: "center" }}>
                    {i + 1}
                  </td>
                  <td>
                    <span className="design-name">{d.name}</span>
                  </td>
                  <td className="muted">{d.name}</td>
                  <td>
                    <span className={`chip size ${d.size.startsWith("200") || d.size.startsWith("75") ? "b" : ""}`}>{d.size}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(d.finish)}`}>{d.finish}</span>
                  </td>
                  <td>
                    <span className={`chip brand ${d.brand === "BIG" ? "big" : ""}`}>{d.brand}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(d.finish)}`}>{d.finish}</span>
                  </td>
                  <td className="num">{pos}</td>
                  <td className="num">{open > 0 ? fmt(open) : <span className="dim">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
