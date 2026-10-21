/* ============================================================
   Panel Craft dashboard (CR-311) — the Dashboard.tsx shape over panel
   orders + cut-piece stock: KPIs, the order pipeline strip, orders per
   status, weekly intake, what is short, the most-ordered panels and the
   latest orders. Every number is a useMemo over the three cached lists.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { KPI } from "@/ui/primitives";
import { Chip } from "@/ui/Chip";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { StageBarChart, TrendChart, type TrendPoint } from "@/ui/charts";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { ORDER_STATUS_TONE, READINESS_TONE } from "./pcBits";
import {
  allocatedByKey,
  cachedCutStock,
  cachedCutStockRows,
  cachedPanelOrders,
  demandByKey,
  pendingNeedLines,
  pendingText,
  loadProgress,
  listCutStock,
  listPanelOrders,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_STATUSES,
  readiness,
  requirementsFor,
  type CutStockRow,
  type PanelOrderRow,
  type PanelOrderStatus,
} from "./panelOrdersApi";

const STATUS_COLOR: Record<PanelOrderStatus, string> = { NewRequest: "violet", Received: "amber", InCutting: "blue", Ready: "cyan", Dispatched: "green" };
const OPEN: PanelOrderStatus[] = ["NewRequest", "Received", "InCutting"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function PanelDashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PanelOrderRow[] | null>(() => cachedPanelOrders());
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [stockRows, setStockRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void listPanelOrders().then((r) => (r.ok ? setOrders(r.orders) : setError(r.error || "Failed to load panel orders")));
    void listPanels().then((r) => r.ok && setPanels(r.panels));
    void listCutStock().then((r) => {
      if (r.ok) {
        setStock(r.stock);
        setStockRows(r.rows);
      }
    });
  };
  useEffect(load, []);

  const all = orders ?? [];
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const byStatus = useMemo(() => {
    const m = Object.fromEntries(PANEL_ORDER_STATUSES.map((s) => [s, { count: 0, qty: 0 }])) as Record<PanelOrderStatus, { count: number; qty: number }>;
    for (const o of all) {
      m[o.status].count++;
      m[o.status].qty += o.totalQty;
    }
    return m;
  }, [all]);
  const open = useMemo(() => all.filter((o) => OPEN.includes(o.status)), [all]);
  // CR-312: short = pieces that must still be cut after this order's booking + what nobody has booked.
  const booked = useMemo(() => allocatedByKey(all), [all]);
  const shortagesOf = (o: PanelOrderRow) => requirementsFor(pendingNeedLines(o.lines, o.loads), panelById, stock, { allocation: o.allocation, booked }).filter((r) => r.toCut > 0); // CR-347: pending pieces only
  const shortOrders = useMemo(() => open.filter((o) => shortagesOf(o).length > 0), [open, panelById, stock, booked]); // eslint-disable-line react-hooks/exhaustive-deps
  // CR-313: orders whose checkpoints (four since CR-323) are all Ready.
  const readyForProduction = useMemo(() => all.filter((o) => readiness(o.checkpoints, o.status) === "Ready for Production"), [all]);
  const monthStart = isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const dispatchedThisMonth = all.filter((o) => o.status === "Dispatched" && o.modifiedTime.slice(0, 10) >= monthStart);
  const stockPcs = stockRows.reduce((s, r) => s + r.qty, 0);
  const stockKg = Math.round(stockRows.reduce((s, r) => s + (r.weightKg ?? 0) * r.qty, 0) * 10) / 10;

  // Shortfall across every open order: what the godown must cut, by design × cut size (the Pending Cut Stock page's top rows).
  const pendingOrders = useMemo(() => all.map((o) => ({ ...o, lines: pendingNeedLines(o.lines, o.loads) })), [all]); // CR-347
  const shortages = useMemo(() => demandByKey(pendingOrders, panelById, stock).filter((r) => r.shortage > 0).sort((a, b) => b.shortage - a.shortage).slice(0, 8), [pendingOrders, panelById, stock]);
  // CR-347/348: open orders with something still to load.
  const pendingToLoad = useMemo(() => open.map((o) => pendingText(loadProgress(o.lines, o.loads))).filter(Boolean), [open]);
  const topPanels = useMemo(() => {
    const m = new Map<string, { code: string; qty: number; orders: number }>();
    for (const o of all) for (const l of o.lines) {
      const cur = m.get(l.panelId) ?? { code: l.panelCode, qty: 0, orders: 0 };
      cur.qty += l.qty;
      cur.orders++;
      m.set(l.panelId, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 6);
  }, [all]);
  // Orders raised per week, last 12 weeks (zero-filled).
  const intake = useMemo<TrendPoint[]>(() => {
    const buckets = new Map<string, number>();
    for (const o of all) {
      const d = new Date((o.orderDate || o.createdTime.slice(0, 10)).replace(" ", "T"));
      if (!isNaN(d.getTime())) buckets.set(isoDay(startOfWeek(d)), (buckets.get(isoDay(startOfWeek(d))) || 0) + 1);
    }
    const out: TrendPoint[] = [];
    const w0 = startOfWeek(new Date());
    for (let i = 11; i >= 0; i--) {
      const d = new Date(w0);
      d.setDate(d.getDate() - i * 7);
      out.push({ label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: buckets.get(isoDay(d)) || 0 });
    }
    return out;
  }, [all]);
  const recent = useMemo(() => [...all].sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1)).slice(0, 8), [all]);
  const showSkeleton = orders === null;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Panel Craft</div>
          <div className="sub row"><span className="live-dot" /> Live</div>
        </div>
        <div className="right">
          {can("panel_craft", "create") && (
            <button className="hbtn primary" onClick={() => navigate("/panel-orders/new")}>
              <Icon name="plus" size={13} /> New Order
            </button>
          )}
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}

      {showSkeleton ? (
        <SkeletonRows rows={1} height={88} />
      ) : (
        <div className="kpi-grid">
          <KPI label="Open Orders" value={fmt(open.length)} unit="orders" delta={`${fmt(open.reduce((s, o) => s + o.totalQty, 0))} panels to deliver`} spark={intake.map((p) => p.value)} />
          <KPI label="In Cutting" value={fmt(byStatus.InCutting.count)} unit="orders" delta={`${fmt(byStatus.InCutting.qty)} panels`} color="var(--c-blue)" />
          <KPI label="Ready to Dispatch" value={fmt(byStatus.Ready.count)} unit="orders" delta={`${fmt(byStatus.Ready.qty)} panels`} color="var(--c-cyan)" />
          <KPI label="Short on Pieces" value={fmt(shortOrders.length)} unit="orders" delta={shortOrders.length ? "need a cutting job" : "stock covers every open order"} color={shortOrders.length ? "var(--c-red)" : "var(--c-green)"} />
          <KPI label="Ready for Production" value={fmt(readyForProduction.length)} unit="orders" delta="MDF · vinyl · cut pieces all ready" color="var(--c-green)" />
          <KPI label="Pending to Load" value={fmt(pendingToLoad.length)} unit="orders" delta={pendingToLoad.length ? "panels · MDF · pieces still to leave" : "everything open has left"} color="var(--c-amber)" />
          <KPI label="Cut Piece" value={fmt(stockPcs)} unit="pcs" delta={`${stockKg} kg · ${fmt(dispatchedThisMonth.length)} dispatched this month`} color="var(--c-green)" />
        </div>
      )}

      <div className="sec-title">
        <h2>Pipeline</h2>
        <span className="meta">{all.length} orders · {fmt(all.reduce((s, o) => s + o.totalQty, 0))} panels</span>
      </div>
      {showSkeleton ? (
        <SkeletonRows rows={1} height={72} />
      ) : (
        <div className="stage-strip" style={{ gridTemplateColumns: `repeat(${PANEL_ORDER_STATUSES.length}, 1fr)` }}>
          {PANEL_ORDER_STATUSES.map((s, i) => (
            <div className="stage-tile" key={s} style={{ cursor: "pointer" }} onClick={() => navigate("/panel-orders")} title="Open panel orders">
              <div className="lbl"><span className={`dot ${STATUS_COLOR[s]}`} />{PANEL_ORDER_STATUS_LABEL[s]}</div>
              <div className="val">{byStatus[s].count}</div>
              <div className="sub">{fmt(byStatus[s].qty)} panels</div>
              {i < PANEL_ORDER_STATUSES.length - 1 && <Icon name="chev-r" size={16} className="arrow" />}
            </div>
          ))}
        </div>
      )}

      {!showSkeleton && (
        <>
          <div className="split" style={{ marginTop: 16, alignItems: "stretch" }}>
            <div className="card">
              <div className="card-head"><Icon name="orders" size={13} /><span className="title">Panels by Status</span></div>
              <div className="card-body" style={{ paddingTop: 4 }}>
                <StageBarChart data={PANEL_ORDER_STATUSES.map((s) => ({ label: PANEL_ORDER_STATUS_LABEL[s], value: byStatus[s].qty, color: STATUS_COLOR[s], count: byStatus[s].count }))} />
              </div>
            </div>
            <div className="card">
              <div className="card-head"><Icon name="calendar" size={13} /><span className="title">Orders per Week</span><span className="muted">· last 12 weeks</span></div>
              <div className="card-body" style={{ paddingTop: 4 }}>
                <TrendChart data={intake} unit="orders" />
              </div>
            </div>
          </div>

          <div className="split" style={{ marginTop: 16, alignItems: "stretch" }}>
            <div className="card">
              <div className="card-head"><Icon name="tile" size={13} /><span className="title">Short on Cut Pieces</span><span className="muted">· open orders</span>
                <span className="right"><Link className="linkish" to="/pending-cut-stock">Pending Cut Piece</Link></span>
              </div>
              <table className="tbl">
                <thead><tr><th>Design</th><th>Cut Piece Size</th><th className="num" style={{ textAlign: "right" }}>Required</th><th className="num" style={{ textAlign: "right" }}>On Hand</th><th className="num" style={{ textAlign: "right" }}>Short</th></tr></thead>
                <tbody>
                  {shortages.map((r) => (
                    <tr key={r.key}>
                      <td><span className="design-name">{r.designName}</span></td>
                      <td className="mono">{r.cutSizeName || "—"}</td>
                      <td className="num mono">{fmt(r.required)}</td>
                      <td className="num mono">{fmt(r.onHand)}</td>
                      <td className="num mono" style={{ color: "var(--c-red)", fontWeight: 600 }}>{fmt(r.shortage)}</td>
                    </tr>
                  ))}
                  {shortages.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>Stock covers every open order.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-head"><Icon name="tile" size={13} /><span className="title">Most Ordered Panels</span>
                <span className="right"><Link className="linkish" to="/panels">Panel Master</Link></span>
              </div>
              <table className="tbl">
                <thead><tr><th>Panel</th><th>Designs</th><th className="num" style={{ textAlign: "right" }}>Orders</th><th className="num" style={{ textAlign: "right" }}>Panels</th></tr></thead>
                <tbody>
                  {topPanels.map(([id, t]) => (
                    <tr key={id}>
                      <td className="mono"><Link className="linkish" to={`/panels/${encodeURIComponent(id)}`}>{t.code}</Link></td>
                      <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{panelById.get(id)?.lines.map((l) => l.designName).join(", ") || "—"}</td>
                      <td className="num mono">{fmt(t.orders)}</td>
                      <td className="num mono">{fmt(t.qty)}</td>
                    </tr>
                  ))}
                  {topPanels.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No panel orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><Icon name="orders" size={13} /><span className="title">Latest Orders</span>
              <span className="right"><Link className="linkish" to="/panel-orders">All panel orders</Link></span>
            </div>
            <table className="tbl">
              <thead><tr><th>Customer</th><th>Date</th><th>Status</th><th>Readiness</th><th className="num" style={{ textAlign: "right" }}>Panels</th><th>Stock</th><th>Order</th></tr></thead>
              <tbody>
                {recent.map((o) => {
                  const short = shortagesOf(o);
                  const ready = readiness(o.checkpoints, o.status);
                  return (
                    <tr
                      key={o.id}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/panel-orders/${encodeURIComponent(o.id)}`)}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/panel-orders/${encodeURIComponent(o.id)}`); }}
                    >
                      <td>{o.customerName}</td>
                      <td className="mono muted">{o.orderDate || "—"}</td>
                      <td><Chip tone={ORDER_STATUS_TONE[o.status]} label={PANEL_ORDER_STATUS_LABEL[o.status]} /></td>
                      <td>{ready === "—" ? <span className="dim">—</span> : <Chip tone={READINESS_TONE[ready]} label={ready} />}</td>
                      <td className="num mono">{fmt(o.totalQty)}</td>
                      <td>{o.status === "Dispatched" ? <span className="dim">—</span> : short.length ? <Chip tone="red" label={`Unavailable · ${short.length}`} /> : <Chip tone="green" label="Available" />}</td>
                      <td className="mono dim">{o.orderNumber || "—"}</td>
                    </tr>
                  );
                })}
                {recent.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>No panel orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
