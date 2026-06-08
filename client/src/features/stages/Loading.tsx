/* Loading — ported verbatim from prototype/views2.jsx. */
import { Icon } from "@/ui/Icon";
import { ProgressBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass } from "@/lib/format";
import { ORDERS } from "@/data";

export function Loading() {
  const items = ORDERS.filter((o) => o.stage === "loading" || o.stage === "packing");

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Loading</div>
          <div className="sub">4 trucks at dock · 7 shipments queued · next loading 14:30</div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="docs" size={13} />
            Loading list
          </button>
          <button className="hbtn primary">
            <Icon name="truck" size={13} />
            Schedule truck
          </button>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: "1fr 1fr 1fr", display: "grid", gap: 10 }}>
        {["Dock 1", "Dock 2", "Dock 3"].map((dock, i) => (
          <div className="card" key={dock}>
            <div className="card-head">
              <span className={`dot ${i === 1 ? "green" : i === 0 ? "amber" : "blue"}`} />
              <span className="title">{dock}</span>
              <span className="muted">· {["Idle since 12:10", "Loading EX-14/2026-27", "Truck arriving 14:30"][i]}</span>
              <div className="right muted">{["—", "38%", "queued"][i]}</div>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 11 }}>
                  {["Awaiting next shipment", "Merkury Market", "AB Specializuota"][i]}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>
                  {["—", "TR-MH-04 GH 2384", "TR-MH-04 GH 2391"][i]}
                </span>
              </div>
              <div className="row" style={{ gap: 8, fontSize: 11 }}>
                <span className="inline-stat">
                  <span className="l">Pallets</span>
                  <span className="v">{["—", "13/34", "0/22"][i]}</span>
                </span>
                <span className="inline-stat">
                  <span className="l">Boxes</span>
                  <span className="v">{["—", "494/1,292", "0/836"][i]}</span>
                </span>
                <span className="inline-stat">
                  <span className="l">ETA done</span>
                  <span className="v">{["—", "13:50", "15:20"][i]}</span>
                </span>
              </div>
              {i === 1 && (
                <div style={{ marginTop: 10 }}>
                  <ProgressBar value={38} max={100} color="var(--c-cyan)" height={5} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sec-title">
        <h2>Loading Queue</h2>
        <span className="meta">Ready to load · sorted by priority</span>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Sequence</th>
              <th>PO / Invoice</th>
              <th>Party</th>
              <th>Design</th>
              <th>Size</th>
              <th className="num" style={{ textAlign: "right" }}>
                Pallets
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Boxes
              </th>
              <th>Truck</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 12).map((o, i) => {
              const pallets = Math.ceil(o.palletizedQty / 60 / o.boxesPerPallet);
              const truck = `TR-MH-04 GH ${2380 + i}`;
              const status = i === 0 ? "loading" : i < 3 ? "packing" : "packing";
              return (
                <tr key={o.id}>
                  <td className="mono muted">#{(i + 1).toString().padStart(2, "0")}</td>
                  <td>
                    <div className="mono">{o.poNumber}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>
                      {o.invoice || "pending"}
                    </div>
                  </td>
                  <td>
                    {o.flag} {o.party}
                  </td>
                  <td>
                    <span className="design-name">{o.design}</span>
                  </td>
                  <td>
                    <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                  </td>
                  <td className="num">{pallets}</td>
                  <td className="num">{fmt(o.palletizedQty)}</td>
                  <td className="mono muted">{i < 4 ? truck : "—"}</td>
                  <td>
                    <StageBadge stage={status} />
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
