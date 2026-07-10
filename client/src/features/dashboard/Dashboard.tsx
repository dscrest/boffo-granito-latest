/* Dashboard — live orders (useOrders). Ready-to-Load is derived from
   the live pipeline. */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { KPI, ProgressBar, StageBadge } from "@/ui/primitives";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt, pct } from "@/lib/format";
import { exportCsv } from "@/lib/csv";
import { STAGES } from "@/data";
import type { Order } from "@/data";
import { useOrders } from "@/features/orders/useOrders";

/** Monday 00:00 of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const mondayOffset = (x.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0 …
  x.setDate(x.getDate() - mondayOffset);
  return x;
}

/** True when a "yyyy-MM-dd[ HH:mm:ss]" order date falls in the current week. */
function inThisWeek(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr.replace(" ", "T"));
  if (isNaN(d.getTime())) return false;
  const start = startOfWeek(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return d >= start && d < end;
}

export function Dashboard() {
  const { orders: allOrders, loading, error, reload } = useOrders();
  const [range, setRange] = useState<"all" | "week">("all");

  // "This week" toggle scopes every KPI + table below to the current week.
  const orders = useMemo(
    () => (range === "week" ? allOrders.filter((o) => inThisWeek(o.orderDate)) : allOrders),
    [allOrders, range],
  );
  const showSkeleton = loading && allOrders.length === 0;

  const onExport = () => {
    exportCsv<Order>(
      `boffo-orders-${range === "week" ? "this-week" : "all"}-${new Date().toISOString().slice(0, 10)}`,
      orders,
      [
        { header: "PO Number", value: (o) => o.poNumber },
        { header: "Customer", value: (o) => o.party },
        { header: "Country", value: (o) => o.country },
        { header: "Design", value: (o) => o.design },
        { header: "Size", value: (o) => o.size },
        { header: "Finish", value: (o) => o.finish },
        { header: "Stage", value: (o) => o.stage },
        { header: "Order Qty (boxes)", value: (o) => o.orderQty },
        { header: "Produced Qty (boxes)", value: (o) => o.producedQty },
        { header: "Pallets", value: (o) => (o.boxesPerPallet > 0 ? Math.ceil(o.palletizedQty / o.boxesPerPallet) : 0) },
        { header: "Order Date", value: (o) => o.orderDate },
        { header: "Due Date", value: (o) => o.dueDate },
      ],
    );
  };

  // Same rule as the old mock READY_TO_LOAD, over live orders.
  const readyToLoad = useMemo(
    () =>
      orders
        .filter((o) => o.stage === "loading" || (o.stage === "packing" && o.palletizedQty >= o.orderQty * 0.85))
        .slice(0, 7),
    [orders],
  );
  const readyPallets = readyToLoad.reduce((s, o) => s + Math.ceil(o.palletizedQty / o.boxesPerPallet), 0);
  const readyBoxes = readyToLoad.reduce((s, o) => s + o.palletizedQty, 0);

  const byStage = useMemo(() => {
    const m: Record<string, { count: number; qty: number }> = {};
    STAGES.forEach((s) => (m[s.id] = { count: 0, qty: 0 }));
    orders.forEach((o) => {
      // Live rows can carry stage values outside STAGES — bucket them on the fly.
      const b = (m[o.stage] ??= { count: 0, qty: 0 });
      b.count++;
      b.qty += o.orderQty;
    });
    return m;
  }, [orders]);

  const totalQty = orders.reduce((s, o) => s + o.orderQty, 0);
  const totalProd = orders.reduce((s, o) => s + o.producedQty, 0);
  const totalPal = orders.reduce((s, o) => s + o.palletizedQty, 0);
  const packedPallets = orders.reduce(
    (s, o) => s + (o.boxesPerPallet > 0 ? Math.ceil(o.palletizedQty / o.boxesPerPallet) : 0),
    0,
  );
  const loadedBoxes = orders.reduce((s, o) => s + o.loadedQty, 0);
  const loadedPallets = orders.reduce(
    (s, o) => s + (o.boxesPerPallet > 0 ? Math.ceil(o.loadedQty / o.boxesPerPallet) : 0),
    0,
  );

  const now = new Date();
  const dateLabel = `Today, ${now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · ${now.toLocaleDateString("en-GB", { weekday: "long" })}`;

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
          <div className="title">{dateLabel}</div>
          <div className="sub row">
            <span className="live-dot" />
            Live
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={onExport} title="Export current orders to CSV">
            <Icon name="download" size={13} />
            Export
          </button>
          <button
            className={`hbtn${range === "week" ? " primary" : ""}`}
            onClick={() => setRange((r) => (r === "week" ? "all" : "week"))}
            title="Toggle current-week filter"
          >
            <Icon name="calendar" size={13} />
            {range === "week" ? "This week ✓" : "This week"}
          </button>
          <button className="hbtn primary" onClick={() => { location.hash = "#/byorder?new=1"; }}>
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
        <KPI label="Total Order Qty" value={fmt(totalQty)} unit="boxes" delta={`${orders.length} active orders`} />
        <KPI label="In Production" value={fmt(totalProd)} unit="boxes" delta={`${pct(totalProd, totalQty)}% of ordered`} color="var(--c-blue)" />
        <KPI label="Pallets Packed" value={fmt(packedPallets)} unit="pallets" delta={`${fmt(totalPal)} boxes total`} color="var(--c-violet)" />
        <KPI label="Ready to Load" value={fmt(readyPallets)} unit="pallets" delta={`${fmt(readyBoxes)} boxes ready`} color="var(--c-cyan)" />
        <KPI label="Loaded" value={fmt(loadedPallets)} unit="pallets" delta={`${fmt(loadedBoxes)} boxes loaded`} color="var(--c-green)" />
      </div>
      )}

      <div className="sec-title">
        <h2>Pipeline</h2>
        <span className="meta">
          {orders.length} active orders · {fmt(totalQty)} boxes in flight
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
            <div className="sub">{fmt(byStage[s.id].qty)} boxes</div>
            {i < STAGES.length - 1 && <Icon name="chev-r" size={16} className="arrow" />}
          </div>
        ))}
      </div>
      )}

      <div className="split" style={{ marginTop: 16, alignItems: "stretch" }}>
        <div className="card">
          <div className="card-head">
            <Icon name="truck" size={13} />
            <span className="title">Ready to Load Today</span>
            <span className="muted">· {readyToLoad.length} shipment{readyToLoad.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ maxHeight: 326, overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>PO / Invoice</th>
                  <th>Customer</th>
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
                {readyToLoad.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>
                      Nothing ready to load yet.
                    </td>
                  </tr>
                )}
                {readyToLoad.map((o) => (
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
              <span className="muted">Active jobs</span>
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

      <div style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-head">
            <Icon name="tile" size={13} />
            <span className="title">Remaining Qty by Design</span>
            <span className="muted">· Top 7 outstanding</span>
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
      </div>
    </div>
  );
}
