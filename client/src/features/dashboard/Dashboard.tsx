/* Dashboard — ported verbatim from prototype/views.jsx. Markup unchanged. */
import { useMemo } from "react";
import { Icon } from "@/ui/Icon";
import { KPI, ProgressBar, StageBadge } from "@/ui/primitives";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt, pct } from "@/lib/format";
import { ACTIVITY, READY_TO_LOAD, STAGES } from "@/data";
import { useOrders } from "@/features/orders/useOrders";

export function Dashboard() {
  const { orders, loading, error, reload } = useOrders();
  const showSkeleton = loading && orders.length === 0;

  const byStage = useMemo(() => {
    const m: Record<string, { count: number; qty: number }> = {};
    STAGES.forEach((s) => (m[s.id] = { count: 0, qty: 0 }));
    orders.forEach((o) => {
      m[o.stage].count++;
      m[o.stage].qty += o.orderQty;
    });
    return m;
  }, [orders]);

  const totalQty = orders.reduce((s, o) => s + o.orderQty, 0);
  const totalProd = orders.reduce((s, o) => s + o.producedQty, 0);
  const totalPal = orders.reduce((s, o) => s + o.palletizedQty, 0);

  const byDesign = useMemo(() => {
    const m: Record<string, { design: string; size: string; finish: string; ordered: number; produced: number }> = {};
    orders.forEach((o) => {
      const k = o.design;
      if (!m[k]) m[k] = { design: k, size: o.size, finish: o.finish, ordered: 0, produced: 0 };
      m[k].ordered += o.orderQty;
      m[k].produced += o.producedQty;
    });
    return Object.values(m)
      .map((d) => ({ ...d, remaining: d.ordered - d.produced }))
      .sort((a, b) => b.remaining - a.remaining)
      .slice(0, 7);
  }, [orders]);

  const todayProd = useMemo(
    () => orders.filter((o) => o.stage === "prod" || o.stage === "packing").slice(0, 6),
    [orders],
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Today, 26 May 2026 · Tuesday</div>
          <div className="sub row">
            <span className="live-dot" />
            Live
            <span className="dim">·</span>
            <span>Last refresh 3s ago</span>
            <span className="dim">·</span>
            <span>Plant: Morbi · Shift A</span>
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            Export
          </button>
          <button className="hbtn">
            <Icon name="calendar" size={13} />
            This week
          </button>
          <button className="hbtn primary" onClick={() => { location.hash = "#/orders"; }}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={reload} />}

      {showSkeleton ? (
        <SkeletonRows rows={1} height={88} />
      ) : (
      <div className="kpi-grid">
        <KPI label="Total Order Qty" value={fmt(totalQty)} unit="sqm" delta="+12,724 this week" trend="up" spark={[6, 8, 7, 10, 9, 11, 12]} />
        <KPI label="In Production" value={fmt(totalProd)} unit="sqm" delta="60.4k of 170.6k target" spark={[3, 4, 5, 7, 8, 9, 11]} color="var(--c-blue)" />
        <KPI label="Pallets Packed" value={fmt(totalPal / 60)} unit="pallets" delta="6,284 boxes total" spark={[2, 4, 5, 8, 9, 10, 12]} color="var(--c-violet)" />
        <KPI label="Ready to Load" value="1,625" unit="pallets" delta="58,140 boxes ready" spark={[7, 9, 10, 12, 11, 13, 14]} color="var(--c-cyan)" />
        <KPI label="Loaded Today" value="347" unit="pallets" delta="EX-14/2026-27 · 8 trucks" spark={[5, 6, 4, 9, 8, 11, 12]} color="var(--c-green)" />
        <KPI label="Invoiced (May)" value="22" unit="invoices" delta="₹4.62 Cr · +18% MoM" trend="up" spark={[3, 5, 4, 6, 7, 8, 9]} color="var(--c-amber)" />
      </div>
      )}

      <div className="sec-title">
        <h2>Pipeline</h2>
        <span className="meta">
          {orders.length} active orders · {fmt(totalQty)} sqm in flight
        </span>
        <div className="right row" style={{ gap: 14 }}>
          <span className="row">
            <span className="dot blue" />
            <span className="muted">Produced</span>
          </span>
          <span className="row">
            <span className="dot violet" />
            <span className="muted">Palletized</span>
          </span>
          <span className="row">
            <span className="dot green" />
            <span className="muted">Loaded</span>
          </span>
        </div>
      </div>

      {showSkeleton ? (
        <SkeletonRows rows={1} height={72} />
      ) : (
      <div className="stage-strip">
        {STAGES.map((s, i) => (
          <div className="stage-tile" key={s.id}>
            <div className="lbl">
              <span className={`dot ${s.color}`} />
              {s.label}
            </div>
            <div className="val">{byStage[s.id].count}</div>
            <div className="sub">{fmt(byStage[s.id].qty)} sqm</div>
            {i < STAGES.length - 1 && <Icon name="chev-r" size={16} className="arrow" />}
          </div>
        ))}
      </div>
      )}

      <div className="split" style={{ marginTop: 16 }}>
        {/* still mock — migrate with Activity/loading tables */}
        <div className="card">
          <div className="card-head">
            <Icon name="truck" size={13} />
            <span className="title">Ready to Load Today</span>
            <span className="muted">· 7 shipments · 4 trucks at dock</span>
            <div className="right">
              <span className="pill">
                <span className="dot green" />
                Dock 2 active
              </span>
              <button className="hbtn" style={{ height: 26, padding: "0 8px" }}>
                View all
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 326, overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {READY_TO_LOAD.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className="mono" style={{ color: "var(--fg)" }}>
                        {o.poNumber}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                        {o.invoice || "pending invoice"}
                      </div>
                    </td>
                    <td>
                      <div>{o.party}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {o.country}
                      </div>
                    </td>
                    <td>
                      <span className="design-name">{o.design}</span>
                    </td>
                    <td>
                      <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>
                        {o.size}
                      </span>
                    </td>
                    <td className="num">{Math.ceil(o.palletizedQty / o.boxesPerPallet)}</td>
                    <td className="num">{fmt(o.palletizedQty)}</td>
                    <td>
                      <StageBadge stage={o.stage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon name="factory" size={13} />
            <span className="title">Production Progress</span>
            <div className="right">
              <span className="muted">Today · Plant Morbi</span>
            </div>
          </div>
          {showSkeleton ? (
            <SkeletonRows rows={6} />
          ) : (
          <div>
            {todayProd.map((o) => {
              const p = pct(o.producedQty, o.orderQty);
              return (
                <div className="prod-progress" key={o.id}>
                  <div className="name">
                    <span>{o.design}</span>
                    <small>
                      {o.size} · {o.finish}
                    </small>
                  </div>
                  <ProgressBar value={o.producedQty} max={o.orderQty} color="var(--c-blue)" height={5} />
                  <div className="pct" style={{ color: p > 80 ? "var(--c-green)" : "var(--fg-2)" }}>
                    {p}%
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>

      <div className="split" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-head">
            <Icon name="tile" size={13} />
            <span className="title">Remaining Qty by Design</span>
            <span className="muted">· Top 7 outstanding</span>
            <div className="right">
              <button className="hbtn" style={{ height: 26, padding: "0 8px" }}>
                By party
              </button>
              <button
                className="hbtn"
                style={{ height: 26, padding: "0 8px", background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                By design
              </button>
            </div>
          </div>
          {showSkeleton ? (
            <SkeletonRows rows={7} />
          ) : (
          <div>
            {byDesign.map((d) => {
              const p = pct(d.produced, d.ordered);
              return (
                <div className="design-row" key={d.design}>
                  <div className="label">
                    {d.design}
                    <small>
                      {d.size} · {d.finish}
                    </small>
                  </div>
                  <div className="barwrap" style={{ width: 180 }}>
                    <ProgressBar
                      value={d.produced}
                      max={d.ordered}
                      color={p > 75 ? "var(--c-green)" : p > 40 ? "var(--c-amber)" : "var(--c-red)"}
                      height={5}
                    />
                  </div>
                  <div className="qty">{fmt(d.remaining)}</div>
                  <div className="qty muted" style={{ fontSize: 11 }}>
                    {p}%
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>

        {/* still mock — migrate with Activity/loading tables */}
        <div className="card">
          <div className="card-head">
            <Icon name="bell" size={13} />
            <span className="title">Activity</span>
            <div className="right">
              <span className="muted">Live</span>
              <span className="live-dot" />
            </div>
          </div>
          <div className="activity">
            {ACTIVITY.map((a, i) => {
              const stageColor =
                ({ production: "blue", packing: "violet", loading: "cyan", po: "amber", final: "green" } as Record<string, string>)[
                  a.tag
                ] || "blue";
              return (
                <div className="item" key={i}>
                  <div className="time">{a.time}</div>
                  <div className="indicator">
                    <span className={`dot ${stageColor}`} />
                  </div>
                  <div className="body">
                    <div>
                      <span className="who">{a.who}</span> <span className="action">{a.action}</span>
                    </div>
                    <div className="detail">{a.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
