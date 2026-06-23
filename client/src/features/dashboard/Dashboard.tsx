/* Dashboard — live orders (useOrders) + live activity feed
   (OperationLog). Ready-to-Load is derived from the live pipeline. */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { KPI, ProgressBar, StageBadge } from "@/ui/primitives";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt, pct } from "@/lib/format";
import { exportCsv } from "@/lib/csv";
import { STAGES } from "@/data";
import type { Order } from "@/data";
import { list } from "@/lib/dataOps";
import { useOrders } from "@/features/orders/useOrders";
import { cachedInvoices, listInvoices, type InvoiceRow } from "@/features/invoices/invoicesApi";

interface FeedItem {
  time: string;
  who: string;
  action: string;
  detail: string;
  tag: string;
}

const str = (v: unknown) => (v == null ? "" : String(v));

const OP_VERB: Record<string, string> = { INSERT: "created", UPDATE: "updated", DELETE: "deleted" };
const TABLE_LABEL: Record<string, string> = {
  Quote: "quote",
  SalesOrder: "order",
  OrderItem: "order line",
  Customer: "customer",
  Design: "design",
  Pallet: "pallet",
  PalletisedBatch: "pallet batch",
  PalletisedBatchLine: "batch line",
  Container: "container",
  ContainerLoading: "container load",
};
const TABLE_TAG: Record<string, string> = {
  Quote: "po",
  SalesOrder: "po",
  OrderItem: "po",
  PalletisedBatch: "packing",
  PalletisedBatchLine: "packing",
  Container: "loading",
  ContainerLoading: "loading",
};

/** "yyyy-MM-dd HH:mm:ss" (OperationLog.occurred_at) → relative label. */
function feedTime(occurredAt: string): string {
  const d = new Date(occurredAt.replace(" ", "T"));
  if (isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return "Yest.";
  return `${days}d`;
}

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

/** Latest successful operations, shaped for the activity feed. */
function useActivityFeed(): { feed: FeedItem[]; loading: boolean } {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void list("OperationLog", { order: "ROWID desc", limit: 50 }).then((res) => {
      if (!alive) return;
      setLoading(false);
      const items = (res.rows || [])
        .filter((r) => str(r.status) === "success")
        .slice(0, 10)
        .map((r) => {
          const table = str(r.table_name);
          const op = str(r.operation).toUpperCase();
          return {
            time: feedTime(str(r.occurred_at)),
            who: str(r.actor) || "system",
            action: `${OP_VERB[op] || op.toLowerCase()} ${TABLE_LABEL[table] || table}`,
            detail: str(r.payload_summary) || (r.entity_rowid ? `#${str(r.entity_rowid)}` : "—"),
            tag: TABLE_TAG[table] || "production",
          };
        });
      setFeed(items);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { feed, loading };
}

/** Live invoices for the KPI strip (cache-first, refreshed on mount). */
function useInvoiceKpi(): InvoiceRow[] {
  const [invoices, setInvoices] = useState<InvoiceRow[]>(() => cachedInvoices() ?? []);
  useEffect(() => {
    let alive = true;
    void listInvoices().then((r) => {
      if (alive && r.ok) setInvoices(r.invoices);
    });
    return () => {
      alive = false;
    };
  }, []);
  return invoices;
}

export function Dashboard() {
  const { orders: allOrders, loading, error, reload } = useOrders();
  const { feed, loading: feedLoading } = useActivityFeed();
  const invoices = useInvoiceKpi();
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
        { header: "Party", value: (o) => o.party },
        { header: "Country", value: (o) => o.country },
        { header: "Design", value: (o) => o.design },
        { header: "Size", value: (o) => o.size },
        { header: "Finish", value: (o) => o.finish },
        { header: "Stage", value: (o) => o.stage },
        { header: "Order Qty (sqm)", value: (o) => o.orderQty },
        { header: "Produced Qty", value: (o) => o.producedQty },
        { header: "Pallets", value: (o) => (o.boxesPerPallet > 0 ? Math.ceil(o.palletizedQty / o.boxesPerPallet) : 0) },
        { header: "Boxes", value: (o) => o.totalBoxes },
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

  // Invoiced this month, summed only when every invoice shares one currency.
  const now = new Date();
  const monthInvoices = invoices.filter((i) => {
    const d = new Date(i.invoiceDate.replace(" ", "T"));
    return !isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const invCurrencies = new Set(monthInvoices.map((i) => i.currency).filter(Boolean));
  const invTotal = monthInvoices.reduce((s, i) => s + i.totalAmount, 0);
  const invDelta =
    monthInvoices.length === 0
      ? "no invoices yet"
      : invCurrencies.size === 1
        ? `${[...invCurrencies][0]} ${fmt(invTotal)} total`
        : `${fmt(invTotal)} total (mixed currency)`;
  const monthLabel = now.toLocaleDateString("en-GB", { month: "short" });

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
            <span className="dim">·</span>
            <span>Plant: Morbi · Shift A</span>
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
        <KPI label="Total Order Qty" value={fmt(totalQty)} unit="sqm" delta={`${orders.length} active orders`} />
        <KPI label="In Production" value={fmt(totalProd)} unit="sqm" delta={`${pct(totalProd, totalQty)}% of ordered`} color="var(--c-blue)" />
        <KPI label="Pallets Packed" value={fmt(packedPallets)} unit="pallets" delta={`${fmt(totalPal)} boxes total`} color="var(--c-violet)" />
        <KPI label="Ready to Load" value={fmt(readyPallets)} unit="pallets" delta={`${fmt(readyBoxes)} boxes ready`} color="var(--c-cyan)" />
        <KPI label="Loaded" value={fmt(loadedPallets)} unit="pallets" delta={`${fmt(loadedBoxes)} boxes loaded`} color="var(--c-green)" />
        <KPI label={`Invoiced (${monthLabel})`} value={String(monthInvoices.length)} unit="invoices" delta={invDelta} color="var(--c-amber)" />
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
        <div className="card">
          <div className="card-head">
            <Icon name="truck" size={13} />
            <span className="title">Ready to Load Today</span>
            <span className="muted">· {readyToLoad.length} shipment{readyToLoad.length === 1 ? "" : "s"}</span>
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
            {feedLoading && feed.length === 0 && <SkeletonRows rows={6} />}
            {!feedLoading && feed.length === 0 && (
              <div className="muted" style={{ textAlign: "center", padding: 18 }}>
                No activity yet.
              </div>
            )}
            {feed.map((a, i) => {
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
