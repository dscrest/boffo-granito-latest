/* ============================================================
   Reports — Phase 5 quantity reports, all from live data.

   · By Item  — per design: ordered / produced / remaining / palletized / loaded
   · By PO    — same rollup per PO (party scoped)
   · Ready pallets — closed batches not yet loaded into a container

   Pure client-side aggregation over the live orders cache (useOrders)
   and the palletisation feed; no extra backend.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { can } from "@/lib/auth";
import { exportCsv } from "@/lib/csv";
import { fmt, pct, fmtDuration, fmtLocalDateTime, parseDbTime } from "@/lib/format";
import { ProgressBar } from "@/ui/primitives";
import { useOrders } from "@/features/orders/useOrders";
import { useMasters } from "@/features/masters/useMasters";
import { listLoadableBatches, type LoadableBatch } from "@/features/stages/palletisationApi";
import { listAll, type DSRow } from "@/lib/dataOps";
import { cachedQuotes, listQuotes } from "@/features/quotes/quotesApi";
import { STATUS_CHIP, STATUS_LABEL } from "@/features/quotes/QuotesTable";
import type { Quote } from "@/data";

type Tab = "item" | "po" | "stock" | "customer" | "salesperson" | "size" | "ready" | "aging";

interface QtyRow {
  key: string;
  label: string;
  sub: string;
  ordered: number;
  produced: number;
  palletized: number;
  loaded: number;
}

interface StockReportRow {
  key: string;
  label: string;
  sub: string;
  opening: number;
  inProduction: number;
  inLoading: number;
  available: number;
}

interface SalesRow {
  key: string;
  label: string;
  orders: number;
  boxes: number;
  amount: number;
}

interface SizeRow {
  key: string;
  label: string;
  orders: number;
  boxes: number;
}

export function Reports() {
  const { orders, loading, error, reload } = useOrders();
  const { designRows } = useMasters();
  const [tab, setTab] = useState<Tab>("item");
  const [batches, setBatches] = useState<LoadableBatch[] | null>(null);
  const [batchErr, setBatchErr] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "ready" || batches !== null) return;
    void listLoadableBatches().then((res) => {
      if (!res.ok) {
        setBatchErr(res.error || "Failed to load ready pallets");
        return;
      }
      setBatchErr(null);
      setBatches(res.batches);
    });
  }, [tab, batches]);

  const byItem = useMemo<QtyRow[]>(() => {
    const m = new Map<string, QtyRow>();
    orders.forEach((o) => {
      const k = o.design || "—";
      const r = m.get(k) ?? {
        key: k,
        label: o.design || "—",
        sub: `${o.size} · ${o.finish}`,
        ordered: 0,
        produced: 0,
        palletized: 0,
        loaded: 0,
      };
      r.ordered += o.orderQty;
      r.produced += o.producedQty;
      r.palletized += o.palletizedQty;
      r.loaded += o.loadedQty;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.ordered - b.produced - (a.ordered - a.produced));
  }, [orders]);

  const byPo = useMemo<QtyRow[]>(() => {
    const m = new Map<string, QtyRow>();
    orders.forEach((o) => {
      const k = `${o.poNumber}__${o.partyCode}`;
      const r = m.get(k) ?? {
        key: k,
        label: o.poNumber || "—",
        sub: `${o.flag} ${o.party}`,
        ordered: 0,
        produced: 0,
        palletized: 0,
        loaded: 0,
      };
      r.ordered += o.orderQty;
      r.produced += o.producedQty;
      r.palletized += o.palletizedQty;
      r.loaded += o.loadedQty;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.ordered - b.produced - (a.ordered - a.produced));
  }, [orders]);

  // Live stock per design: opening (accounting_stock) + produced − loaded.
  const byStock = useMemo<StockReportRow[]>(() => {
    return designRows
      .map((d) => {
        const forD = orders.filter((o) => o.design === d.designName);
        const produced = forD.reduce((s, o) => s + o.producedQty, 0);
        const loaded = forD.reduce((s, o) => s + o.loadedQty, 0);
        const opening = d.accountingStock ?? 0;
        return {
          key: d.id,
          label: d.designName || "—",
          sub: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · "),
          opening,
          inProduction: forD.reduce((s, o) => s + Math.max(0, o.orderQty - o.producedQty), 0),
          inLoading: forD.reduce((s, o) => s + Math.max(0, o.palletizedQty - o.loadedQty), 0),
          available: opening + produced - loaded,
        };
      })
      .sort((a, b) => b.available - a.available);
  }, [designRows, orders]);

  // One row per Sales Order (totalAmount repeats on every line — take it once).
  const soRows = useMemo(() => {
    const m = new Map<string, { customer: string; salesperson: string; amount: number; boxes: number }>();
    orders.forEach((o) => {
      if (!o.salesOrderId) return;
      const r = m.get(o.salesOrderId) ?? { customer: o.party || "—", salesperson: o.salesperson || "—", amount: 0, boxes: 0 };
      r.boxes += o.orderQty;
      r.amount = o.totalAmount ?? r.amount;
      m.set(o.salesOrderId, r);
    });
    return [...m.values()];
  }, [orders]);

  const bySalesGroup = (pick: (s: (typeof soRows)[number]) => string): SalesRow[] => {
    const m = new Map<string, SalesRow>();
    soRows.forEach((s) => {
      const k = pick(s) || "—";
      const r = m.get(k) ?? { key: k, label: k, orders: 0, boxes: 0, amount: 0 };
      r.orders += 1;
      r.boxes += s.boxes;
      r.amount += s.amount;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const byCustomer = useMemo(() => bySalesGroup((s) => s.customer), [soRows]);
  const bySalesperson = useMemo(() => bySalesGroup((s) => s.salesperson), [soRows]);

  const bySize = useMemo<SizeRow[]>(() => {
    const m = new Map<string, { key: string; label: string; boxes: number; orders: Set<string> }>();
    orders.forEach((o) => {
      const k = o.size || "—";
      const r = m.get(k) ?? { key: k, label: o.size || "—", boxes: 0, orders: new Set<string>() };
      r.boxes += o.orderQty;
      if (o.salesOrderId) r.orders.add(o.salesOrderId);
      m.set(k, r);
    });
    return [...m.values()].map((r) => ({ key: r.key, label: r.label, boxes: r.boxes, orders: r.orders.size })).sort((a, b) => b.boxes - a.boxes);
  }, [orders]);

  const rows = tab === "item" ? byItem : byPo;
  const readyBoxes = (batches ?? []).reduce((s, b) => s + b.boxes, 0);
  const showSkeleton = loading && orders.length === 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Quantity Reports</div>
          <div className="sub">Ordered vs produced vs remaining · ready pallets — live data</div>
        </div>
        {(tab === "item" || tab === "po") && can("reports", "export") && (
          <div className="right">
            <button
              className="hbtn"
              title="Export the current report as CSV"
              onClick={() =>
                exportCsv(tab === "item" ? "report-by-item" : "report-by-po", rows, [
                  { header: tab === "item" ? "Design" : "PO Number", value: (r) => r.label },
                  { header: tab === "item" ? "Spec" : "Customer", value: (r) => r.sub },
                  { header: "Ordered", value: (r) => r.ordered },
                  { header: "Produced", value: (r) => r.produced },
                  { header: "Remaining", value: (r) => r.ordered - r.produced },
                  { header: "Palletized", value: (r) => r.palletized },
                  { header: "Loaded", value: (r) => r.loaded },
                ])
              }
            >
              <Icon name="docs" size={13} />
              Export
            </button>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
        <TabBtn active={tab === "item"} onClick={() => setTab("item")} label="By Item" />
        <TabBtn active={tab === "po"} onClick={() => setTab("po")} label="By PO" />
        <TabBtn active={tab === "stock"} onClick={() => setTab("stock")} label="Stock" />
        <TabBtn active={tab === "customer"} onClick={() => setTab("customer")} label="Customer Sales" />
        <TabBtn active={tab === "salesperson"} onClick={() => setTab("salesperson")} label="Salesperson Sales" />
        <TabBtn active={tab === "size"} onClick={() => setTab("size")} label="Size-wise" />
        <TabBtn active={tab === "ready"} onClick={() => setTab("ready")} label="Ready Pallets" />
        <TabBtn active={tab === "aging"} onClick={() => setTab("aging")} label="Quote Aging" />
      </div>

      {tab === "aging" && <QuoteAging />}
      {tab === "stock" && <StockTable rows={byStock} loading={showSkeleton} error={error} onRetry={reload} />}
      {tab === "customer" && <SalesTable rows={byCustomer} headLabel="Customer" name="report-customer-sales" loading={showSkeleton} error={error} onRetry={reload} />}
      {tab === "salesperson" && <SalesTable rows={bySalesperson} headLabel="Salesperson" name="report-salesperson-sales" loading={showSkeleton} error={error} onRetry={reload} />}
      {tab === "size" && <SizeTable rows={bySize} loading={showSkeleton} error={error} onRetry={reload} />}

      {(tab === "item" || tab === "po") && (
        <>
          {error && <ErrorCard message={error} onRetry={reload} />}
          {showSkeleton ? (
            <SkeletonRows rows={8} />
          ) : (
            <div className="card">
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{tab === "item" ? "Design" : "PO Number"}</th>
                      <th>{tab === "item" ? "Spec" : "Customer"}</th>
                      <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                      <th className="num" style={{ textAlign: "right" }}>Produced</th>
                      <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                      <th className="num" style={{ textAlign: "right" }}>Palletized</th>
                      <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                      <th style={{ width: 150 }}>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const remaining = r.ordered - r.produced;
                      return (
                        <tr key={r.key}>
                          <td style={{ color: "var(--fg)" }}>{r.label}</td>
                          <td className="muted">{r.sub}</td>
                          <td className="num mono">{fmt(r.ordered)}</td>
                          <td className="num mono">{fmt(r.produced)}</td>
                          <td className="num mono" style={{ color: remaining > 0 ? "var(--c-amber)" : "var(--c-green)" }}>
                            {fmt(remaining)}
                          </td>
                          <td className="num mono">{fmt(r.palletized)}</td>
                          <td className="num mono">{fmt(r.loaded)}</td>
                          <td>
                            <div className="row" style={{ gap: 8, alignItems: "center" }}>
                              <ProgressBar value={r.produced} max={r.ordered} color="var(--c-blue)" height={4} />
                              <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.produced, r.ordered)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <EmptyState icon="orders" title="No order data yet" hint="Create a sales order to populate the report." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "ready" && (
        <>
          {batchErr && <ErrorCard message={batchErr} onRetry={() => setBatches(null)} />}
          {batches === null && !batchErr ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="card">
              <div className="card-head">
                <Icon name="truck" size={13} />
                <span className="title">Ready pallets</span>
                <span className="muted">
                  · {(batches ?? []).length} closed batch{(batches ?? []).length === 1 ? "" : "es"} · {fmt(readyBoxes)} boxes awaiting loading
                </span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Design</th>
                      <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batches ?? []).map((b) => (
                      <tr key={b.batchId}>
                        <td className="mono muted">#{b.batchId.slice(-6)}</td>
                        <td style={{ color: "var(--fg)" }}>{b.label}</td>
                        <td className="num mono">{fmt(b.boxes)}</td>
                      </tr>
                    ))}
                    {(batches ?? []).length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: 0 }}>
                          <EmptyState icon="truck" title="No pallets waiting" hint="Close a pallet in Pallet Packing to see it here." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Quote Aging — "where is my work stuck": every non-converted quote with
   its current status and how long it has sat there (since the last
   StatusTransition, else since creation). Longest-stuck first. */
function QuoteAging() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [transitions, setTransitions] = useState<DSRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listQuotes().then((res) => {
      if (!res.ok) setError(res.error || "Failed to load quotes");
      else setQuotes(res.quotes);
    });
    void listAll("StatusTransition").then((res) => {
      if (!res.ok) setError(res.error || "Failed to load transitions");
      else setTransitions(res.rows || []);
    });
  }, []);

  const rows = useMemo(() => {
    if (transitions === null) return null;
    // Latest transition per quote (rows come in insertion order; keep max ROWID).
    const latest = new Map<string, DSRow>();
    for (const t of transitions) {
      if (String(t.entity_type) !== "Quote") continue;
      const k = String(t.entity_rowid);
      const prev = latest.get(k);
      if (!prev || BigInt(String(t.ROWID)) > BigInt(String(prev.ROWID))) latest.set(k, t);
    }
    const now = Date.now();
    return quotes
      .filter((q) => q.status !== "Converted")
      .map((q) => {
        const t = latest.get(q.id);
        const since = String(t?.occurred_at || t?.CREATEDTIME || q.createdTime || "");
        const ms = now - parseDbTime(since);
        return { q, since, ms: Number.isFinite(ms) ? ms : 0 };
      })
      .sort((a, b) => b.ms - a.ms);
  }, [quotes, transitions]);

  if (error) return <ErrorCard message={error} />;
  if (rows === null) return <SkeletonRows rows={8} />;
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Quote No</th>
              <th>Customer</th>
              <th>Status</th>
              <th>In Status Since</th>
              <th className="num" style={{ textAlign: "right" }}>Time in Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ q, since, ms }) => (
              <tr key={q.id} onClick={() => navigate(`/quotes/${q.id}`)} style={{ cursor: "pointer" }} title="Open quote">
                <td className="mono">
                  <Link className="linkish" to={`/quotes/${q.id}`} onClick={(e) => e.stopPropagation()} title="Open quote">
                    {q.quoteNo}
                  </Link>
                </td>
                <td>{q.customer}</td>
                <td><span className={`chip qstatus ${STATUS_CHIP[q.status]}`}>{STATUS_LABEL[q.status]}</span></td>
                <td className="muted">{fmtLocalDateTime(since)}</td>
                <td className="num mono">{fmtDuration(ms)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 0 }}>
                  <EmptyState icon="clock" title="No open quotes" hint="Every quote is converted — nothing is aging." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportExport<T>({ name, rows, columns }: { name: string; rows: T[]; columns: { header: string; value: (r: T) => string | number }[] }) {
  if (!can("reports", "export")) return null;
  return (
    <button className="hbtn" title="Export as CSV" onClick={() => exportCsv(name, rows, columns)} style={{ marginLeft: "auto" }}>
      <Icon name="docs" size={13} /> Export
    </button>
  );
}

/* Live stock report — opening + produced − loaded per design. */
function StockTable({ rows, loading, error, onRetry }: { rows: StockReportRow[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) return <ErrorCard message={error} onRetry={onRetry} />;
  if (loading) return <SkeletonRows rows={8} />;
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="package" size={13} />
        <span className="title">Live stock</span>
        <ReportExport
          name="report-stock"
          rows={rows}
          columns={[
            { header: "Design", value: (r) => r.label },
            { header: "Spec", value: (r) => r.sub },
            { header: "Opening", value: (r) => r.opening },
            { header: "In production", value: (r) => r.inProduction },
            { header: "In loading", value: (r) => r.inLoading },
            { header: "Available", value: (r) => r.available },
          ]}
        />
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Design</th>
              <th>Spec</th>
              <th className="num" style={{ textAlign: "right" }}>Opening</th>
              <th className="num" style={{ textAlign: "right" }}>In production</th>
              <th className="num" style={{ textAlign: "right" }}>In loading</th>
              <th className="num" style={{ textAlign: "right" }}>Available</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ color: "var(--fg)" }}>{r.label}</td>
                <td className="muted">{r.sub || "—"}</td>
                <td className="num mono">{fmt(r.opening)}</td>
                <td className="num mono">{fmt(r.inProduction)}</td>
                <td className="num mono">{fmt(r.inLoading)}</td>
                <td className="num mono" style={{ fontWeight: 600, color: r.available < 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(r.available)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 0 }}><EmptyState icon="package" title="No items yet" hint="Add items to see live stock." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Sales grouped by customer or salesperson (one row per Sales Order). */
function SalesTable({ rows, headLabel, name, loading, error, onRetry }: { rows: SalesRow[]; headLabel: string; name: string; loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) return <ErrorCard message={error} onRetry={onRetry} />;
  if (loading) return <SkeletonRows rows={8} />;
  const totalAmt = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="chart" size={13} />
        <span className="title">{headLabel} sales</span>
        <span className="muted">· {fmt(totalAmt)} total</span>
        <ReportExport
          name={name}
          rows={rows}
          columns={[
            { header: headLabel, value: (r) => r.label },
            { header: "Orders", value: (r) => r.orders },
            { header: "Boxes", value: (r) => r.boxes },
            { header: "Amount", value: (r) => r.amount },
          ]}
        />
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>{headLabel}</th>
              <th className="num" style={{ textAlign: "right" }}>Orders</th>
              <th className="num" style={{ textAlign: "right" }}>Boxes</th>
              <th className="num" style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ color: "var(--fg)" }}>{r.label}</td>
                <td className="num mono">{fmt(r.orders)}</td>
                <td className="num mono">{fmt(r.boxes)}</td>
                <td className="num mono">{fmt(r.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 0 }}><EmptyState icon="chart" title="No sales yet" hint="Confirm a sales order to populate this report." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Ordered boxes grouped by size. */
function SizeTable({ rows, loading, error, onRetry }: { rows: SizeRow[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) return <ErrorCard message={error} onRetry={onRetry} />;
  if (loading) return <SkeletonRows rows={8} />;
  const totalBoxes = rows.reduce((s, r) => s + r.boxes, 0);
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="chart" size={13} />
        <span className="title">Size-wise orders</span>
        <span className="muted">· {fmt(totalBoxes)} boxes</span>
        <ReportExport
          name="report-size"
          rows={rows}
          columns={[
            { header: "Size", value: (r) => r.label },
            { header: "Orders", value: (r) => r.orders },
            { header: "Boxes", value: (r) => r.boxes },
          ]}
        />
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Size</th>
              <th className="num" style={{ textAlign: "right" }}>Orders</th>
              <th className="num" style={{ textAlign: "right" }}>Boxes</th>
              <th style={{ width: 200 }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ color: "var(--fg)" }}>{r.label}</td>
                <td className="num mono">{fmt(r.orders)}</td>
                <td className="num mono">{fmt(r.boxes)}</td>
                <td>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <ProgressBar value={r.boxes} max={totalBoxes} color="var(--c-blue)" height={4} />
                    <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.boxes, totalBoxes)}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 0 }}><EmptyState icon="chart" title="No orders yet" hint="Create a sales order to see size split." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        background: "none",
        border: 0,
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        color: active ? "var(--accent)" : "var(--fg-2)",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
