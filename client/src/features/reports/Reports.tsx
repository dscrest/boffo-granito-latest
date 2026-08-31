/* ============================================================
   Reports — Zoho-Books-style reporting. Each report is its own
   URL (/reports/:id), rendered through ReportShell: title, a
   filter bar (date range + advanced search), KPI summary
   tiles, then a sortable/paginated table with a highlighted grand-
   total row. The /reports landing (ReportsHome) links to these by
   section (Sales / Customer / Item / Inventory).

   Pure client-side aggregation over the live orders cache (useOrders),
   the design masters, the palletisation feed and quotes — no extra
   backend. The REPORTS registry below is the single source of truth
   for both the landing cards and the route dispatcher.
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt, pct, fmtDuration, fmtLocalDateTime, parseDbTime } from "@/lib/format";
import { moneyFor } from "@/features/quotes/quoteTemplate";
import { ProgressBar } from "@/ui/primitives";
import { usePagination, useSortRows, SortTh, GridFooter } from "@/ui/GridFooter";
import { applyFilters, type FilterField, type FilterCriteria } from "@/ui/AdvancedFilter";
import { ReportShell, TotalsRow, inDateRange, type DateRangeState, type KpiSpec } from "./ReportShell";
import { PivotTable, BUCKETS, bucketOf, bucketLabel, type Bucket } from "./PivotTable";
import { useOrders } from "@/features/orders/useOrders";
import { useMasters } from "@/features/masters/useMasters";
import { usePersistedState } from "@/lib/usePersistedState";
import { designStock, openingStockFor, type InProductionOrder } from "@/lib/stock";
import { cachedBatchStock, cachedOpeningByDesign, listBatchStock, type BatchStockRow } from "@/features/stages/batchStockApi";
import { batchLedger, type BatchMoveRow } from "@/features/stages/batchLedger";
import { InProductionModal, InProductionCell } from "@/features/stages/InProductionModal";
import { cachedProductionLogs, listProductionLogs, type ProductionEntry } from "@/features/stages/productionApi";
import {
  boxFill,
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  listPalPlans,
  sealed,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
} from "@/features/stages/palPlansApi";
import { listAll, type DSRow } from "@/lib/dataOps";
import { cachedQuotes, listQuotes } from "@/features/quotes/quotesApi";
import { STATUS_CHIP, STATUS_LABEL } from "@/features/quotes/QuotesTable";
import type { Order, Quote } from "@/data";

const money = moneyFor("INR");
// ponytail: amount sums assume every order is INR; convert via order.exchangeRate
// if/when multi-currency reporting is needed.
const distinct = (vals: (string | undefined)[]) => [...new Set(vals.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));

const numTh = { textAlign: "right" as const };

/** Segmented toggle for the report filter bar (view, axis, date grouping).
    Uses the shared .seg control — no bespoke one-off. */
function Seg<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <span className="seg" role="group" aria-label={label} title={label}>
      {options.map((o) => (
        <button
          key={o.id}
          className={`seg-btn${value === o.id ? " active" : ""}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/* ─────────────────────────── Qty reports (By Item / By PO) ─────────────────────────── */

interface QtyRow {
  key: string;
  label: string;
  sub: string;
  ordered: number;
  produced: number;
  remaining: number;
  palletized: number;
  loaded: number;
}

function QtyReport({ mode }: { mode: "item" | "po" }) {
  const { orders, loading, error, reload } = useOrders();
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  const fields = useMemo<FilterField<Order>[]>(
    () =>
      mode === "item"
        ? [
            { key: "design", label: "Design", type: "select", options: distinct(orders.map((o) => o.design)), get: (o) => o.design },
            { key: "size", label: "Size", type: "select", options: distinct(orders.map((o) => o.size)), get: (o) => o.size },
            { key: "finish", label: "Finish", type: "text", get: (o) => o.finish },
          ]
        : [
            { key: "party", label: "Customer", type: "select", options: distinct(orders.map((o) => o.party)), get: (o) => o.party },
            { key: "poNumber", label: "PO Number", type: "text", get: (o) => o.poNumber },
            { key: "salesperson", label: "Sales Person", type: "select", options: distinct(orders.map((o) => o.salesperson)), get: (o) => o.salesperson || "" },
          ],
    [orders, mode],
  );

  const rows = useMemo<QtyRow[]>(() => {
    const base = applyFilters(orders.filter((o) => inDateRange(o.orderDate, date)), criteria, fields);
    const m = new Map<string, QtyRow>();
    base.forEach((o) => {
      const k = mode === "item" ? o.design || "—" : `${o.poNumber}__${o.partyCode}`;
      const r =
        m.get(k) ??
        ({
          key: k,
          label: mode === "item" ? o.design || "—" : o.poNumber || "—",
          sub: mode === "item" ? `${o.size} · ${o.finish}` : `${o.flag} ${o.party}`,
          ordered: 0,
          produced: 0,
          remaining: 0,
          palletized: 0,
          loaded: 0,
        } as QtyRow);
      r.ordered += o.orderQty;
      r.produced += o.producedQty;
      r.palletized += o.palletizedQty;
      r.loaded += o.loadedQty;
      r.remaining = r.ordered - r.produced;
      m.set(k, r);
    });
    return [...m.values()];
  }, [orders, date, criteria, fields, mode]);

  const tot = useMemo(
    () => rows.reduce((a, r) => ({ ordered: a.ordered + r.ordered, produced: a.produced + r.produced, palletized: a.palletized + r.palletized, loaded: a.loaded + r.loaded }), { ordered: 0, produced: 0, palletized: 0, loaded: 0 }),
    [rows],
  );
  const remaining = tot.ordered - tot.produced;

  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "remaining");
  const pager = usePagination(rows.length, "reportQtyPageSize", `${mode}|${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Ordered", value: fmt(tot.ordered), unit: "boxes" },
    { label: "Produced", value: fmt(tot.produced), unit: "boxes", color: "var(--c-blue)" },
    { label: "Remaining", value: fmt(remaining), unit: "boxes", color: remaining > 0 ? "var(--c-amber)" : "var(--c-green)" },
    { label: "Completion", value: `${pct(tot.produced, tot.ordered)}`, unit: "%" },
    { label: mode === "item" ? "Designs" : "POs", value: fmt(rows.length) },
  ];

  return (
    <ReportShell
      title={mode === "item" ? "By Item" : "By PO"}
      subtitle="Ordered vs produced vs remaining — live data"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: mode === "item" ? "items" : "POs", fields, criteria, onChange: setCriteria }}
      csv={{
        name: mode === "item" ? "report-by-item" : "report-by-po",
        rows,
        columns: [
          { header: mode === "item" ? "Design" : "PO Number", value: (r) => r.label },
          { header: mode === "item" ? "Spec" : "Customer", value: (r) => r.sub },
          { header: "Ordered", value: (r) => r.ordered },
          { header: "Produced", value: (r) => r.produced },
          { header: "Remaining", value: (r) => r.remaining },
          { header: "Palletized", value: (r) => r.palletized },
          { header: "Loaded", value: (r) => r.loaded },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && orders.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="label" label={mode === "item" ? "Design" : "PO Number"} sort={sort} />
                  <th>{mode === "item" ? "Spec" : "Customer"}</th>
                  <SortTh id="ordered" label="Ordered" sort={sort} className="num" style={numTh} />
                  <SortTh id="produced" label="Produced" sort={sort} className="num" style={numTh} />
                  <SortTh id="remaining" label="Remaining" sort={sort} className="num" style={numTh} />
                  <SortTh id="palletized" label="Palletized" sort={sort} className="num" style={numTh} />
                  <SortTh id="loaded" label="Loaded" sort={sort} className="num" style={numTh} />
                  <th style={{ width: 150 }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ color: "var(--fg)" }}>{r.label}</td>
                    <td className="muted">{r.sub}</td>
                    <td className="num mono">{fmt(r.ordered)}</td>
                    <td className="num mono">{fmt(r.produced)}</td>
                    <td className="num mono" style={{ color: r.remaining > 0 ? "var(--c-amber)" : "var(--c-green)" }}>{fmt(r.remaining)}</td>
                    <td className="num mono">{fmt(r.palletized)}</td>
                    <td className="num mono">{fmt(r.loaded)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <ProgressBar value={r.produced} max={r.ordered} color="var(--c-blue)" height={4} />
                        <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.produced, r.ordered)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <EmptyState icon="orders" title="No order data" hint="Adjust the filters, or create a sales order." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted">{rows.length} {mode === "item" ? "designs" : "POs"}</td>
                  <td className="num mono">{fmt(tot.ordered)}</td>
                  <td className="num mono">{fmt(tot.produced)}</td>
                  <td className="num mono" style={{ color: remaining > 0 ? "var(--c-amber)" : "var(--c-green)" }}>{fmt(remaining)}</td>
                  <td className="num mono">{fmt(tot.palletized)}</td>
                  <td className="num mono">{fmt(tot.loaded)}</td>
                  <td className="num mono">{pct(tot.produced, tot.ordered)}%</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Sales reports (Customer / Salesperson) ─────────────────────────── */

interface SalesRow {
  key: string;
  label: string;
  orders: number;
  boxes: number;
  amount: number;
}

function SalesReport({ groupBy }: { groupBy: "customer" | "salesperson" }) {
  const { orders, loading, error, reload } = useOrders();
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const headLabel = groupBy === "customer" ? "Customer" : "Sales Person";

  const fields = useMemo<FilterField<Order>[]>(
    () => [
      { key: "party", label: "Customer", type: "select", options: distinct(orders.map((o) => o.party)), get: (o) => o.party },
      { key: "salesperson", label: "Sales Person", type: "select", options: distinct(orders.map((o) => o.salesperson)), get: (o) => o.salesperson || "" },
      { key: "status", label: "Status", type: "select", options: distinct(orders.map((o) => o.status)), get: (o) => o.status || "" },
    ],
    [orders],
  );

  const rows = useMemo<SalesRow[]>(() => {
    const base = applyFilters(orders.filter((o) => inDateRange(o.orderDate, date)), criteria, fields);
    // One row per Sales Order (totalAmount repeats on every line — take it once).
    const so = new Map<string, { customer: string; salesperson: string; amount: number; boxes: number }>();
    base.forEach((o) => {
      if (!o.salesOrderId) return;
      const r = so.get(o.salesOrderId) ?? { customer: o.party || "—", salesperson: o.salesperson || "—", amount: 0, boxes: 0 };
      r.boxes += o.orderQty;
      r.amount = o.totalAmount ?? r.amount;
      so.set(o.salesOrderId, r);
    });
    const m = new Map<string, SalesRow>();
    [...so.values()].forEach((s) => {
      const k = (groupBy === "customer" ? s.customer : s.salesperson) || "—";
      const r = m.get(k) ?? { key: k, label: k, orders: 0, boxes: 0, amount: 0 };
      r.orders += 1;
      r.boxes += s.boxes;
      r.amount += s.amount;
      m.set(k, r);
    });
    return [...m.values()];
  }, [orders, date, criteria, fields, groupBy]);

  const tot = useMemo(() => rows.reduce((a, r) => ({ orders: a.orders + r.orders, boxes: a.boxes + r.boxes, amount: a.amount + r.amount }), { orders: 0, boxes: 0, amount: 0 }), [rows]);

  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "amount");
  const pager = usePagination(rows.length, "reportSalesPageSize", `${groupBy}|${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Revenue", value: money(tot.amount) },
    { label: "Orders", value: fmt(tot.orders), color: "var(--c-blue)" },
    { label: "Boxes", value: fmt(tot.boxes) },
    { label: "Avg / order", value: money(tot.orders ? tot.amount / tot.orders : 0) },
    { label: headLabel === "Customer" ? "Customers" : "Sales persons", value: fmt(rows.length) },
  ];

  return (
    <ReportShell
      title={`${headLabel} Sales`}
      subtitle="Revenue and volume per sales order — live data"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "sales", fields, criteria, onChange: setCriteria }}
      csv={{
        name: groupBy === "customer" ? "report-customer-sales" : "report-salesperson-sales",
        rows,
        columns: [
          { header: headLabel, value: (r) => r.label },
          { header: "Orders", value: (r) => r.orders },
          { header: "Boxes", value: (r) => r.boxes },
          { header: "Amount", value: (r) => r.amount },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && orders.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="label" label={headLabel} sort={sort} />
                  <SortTh id="orders" label="Orders" sort={sort} className="num" style={numTh} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                  <SortTh id="amount" label="Amount" sort={sort} className="num" style={numTh} />
                  <th style={{ width: 200 }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ color: "var(--fg)" }}>{r.label}</td>
                    <td className="num mono">{fmt(r.orders)}</td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{money(r.amount)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <ProgressBar value={r.amount} max={tot.amount} color="var(--accent)" height={4} />
                        <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.amount, tot.amount)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <EmptyState icon="chart" title="No sales" hint="Adjust the filters, or confirm a sales order." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="num mono">{fmt(tot.orders)}</td>
                  <td className="num mono">{fmt(tot.boxes)}</td>
                  <td className="num mono">{money(tot.amount)}</td>
                  <td className="muted">100%</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Size-wise ─────────────────────────── */

interface SizeRow {
  key: string;
  label: string;
  orders: number;
  boxes: number;
}

function SizeReport() {
  const { orders, loading, error, reload } = useOrders();
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  const fields = useMemo<FilterField<Order>[]>(
    () => [
      { key: "size", label: "Size", type: "select", options: distinct(orders.map((o) => o.size)), get: (o) => o.size },
      { key: "party", label: "Customer", type: "select", options: distinct(orders.map((o) => o.party)), get: (o) => o.party },
    ],
    [orders],
  );

  const rows = useMemo<SizeRow[]>(() => {
    const base = applyFilters(orders.filter((o) => inDateRange(o.orderDate, date)), criteria, fields);
    const m = new Map<string, { key: string; label: string; boxes: number; orders: Set<string> }>();
    base.forEach((o) => {
      const k = o.size || "—";
      const r = m.get(k) ?? { key: k, label: o.size || "—", boxes: 0, orders: new Set<string>() };
      r.boxes += o.orderQty;
      if (o.salesOrderId) r.orders.add(o.salesOrderId);
      m.set(k, r);
    });
    return [...m.values()].map((r) => ({ key: r.key, label: r.label, boxes: r.boxes, orders: r.orders.size }));
  }, [orders, date, criteria, fields]);

  const tot = useMemo(() => rows.reduce((a, r) => ({ orders: a.orders + r.orders, boxes: a.boxes + r.boxes }), { orders: 0, boxes: 0 }), [rows]);
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "boxes");
  const pager = usePagination(rows.length, "reportSizePageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Boxes", value: fmt(tot.boxes) },
    { label: "Sizes", value: fmt(rows.length), color: "var(--c-blue)" },
    { label: "Top size", value: sort.sorted[0]?.label ?? "—" },
  ];

  return (
    <ReportShell
      title="Size-wise"
      subtitle="Ordered boxes grouped by size — live data"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "sizes", fields, criteria, onChange: setCriteria }}
      csv={{ name: "report-size", rows, columns: [{ header: "Size", value: (r) => r.label }, { header: "Orders", value: (r) => r.orders }, { header: "Boxes", value: (r) => r.boxes }] }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && orders.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="label" label="Size" sort={sort} />
                  <SortTh id="orders" label="Orders" sort={sort} className="num" style={numTh} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                  <th style={{ width: 220 }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ color: "var(--fg)" }}>{r.label}</td>
                    <td className="num mono">{fmt(r.orders)}</td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <ProgressBar value={r.boxes} max={tot.boxes} color="var(--c-blue)" height={4} />
                        <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.boxes, tot.boxes)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 0 }}>
                      <EmptyState icon="chart" title="No orders" hint="Adjust the filters, or create a sales order." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="num mono">{fmt(tot.orders)}</td>
                  <td className="num mono">{fmt(tot.boxes)}</td>
                  <td className="muted">100%</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Live stock ─────────────────────────── */

interface StockRow {
  key: string;
  label: string;
  sub: string;
  opening: number;
  inProduction: number;
  inProductionOrders: InProductionOrder[];
  inLoading: number;
  available: number;
}

function StockReport() {
  const { orders, loading, error, reload } = useOrders();
  const { designRows } = useMasters();
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [ipRow, setIpRow] = useState<StockRow | null>(null); // in-production drill-down
  // Production log folds into In production / Available (same lib/stock.ts basis
  // as the Item detail) — fetch once.
  const [prodLogs, setProdLogs] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [openingByDesign, setOpeningByDesign] = useState<Map<string, number>>(() => cachedOpeningByDesign());
  useEffect(() => {
    void listProductionLogs().then((r) => r.ok && setProdLogs(r.entries));
    void listBatchStock().then((r) => r.ok && setOpeningByDesign(r.openingByDesign));
  }, []);

  const allRows = useMemo<StockRow[]>(() => {
    return designRows.map((d) => {
      const opening = openingStockFor(d, openingByDesign);
      const s = designStock(d.designName, { openingStock: opening, orders, prodLogs });
      return {
        key: d.id,
        label: d.designName || "—",
        sub: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · "),
        opening,
        inProduction: s.inProduction,
        inProductionOrders: s.inProductionOrders,
        inLoading: s.inLoading,
        available: s.available,
      };
    });
  }, [designRows, orders, prodLogs, openingByDesign]);

  const fields = useMemo<FilterField<StockRow>[]>(
    () => [
      { key: "label", label: "Design", type: "text", get: (r) => r.label },
      { key: "available", label: "Available", type: "numrange", get: (r) => r.available },
    ],
    [],
  );
  const rows = useMemo(() => applyFilters(allRows, criteria, fields), [allRows, criteria, fields]);
  const tot = useMemo(() => rows.reduce((a, r) => ({ opening: a.opening + r.opening, inProduction: a.inProduction + r.inProduction, inLoading: a.inLoading + r.inLoading, available: a.available + r.available }), { opening: 0, inProduction: 0, inLoading: 0, available: 0 }), [rows]);

  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "available");
  const pager = usePagination(rows.length, "reportStockPageSize", `${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Opening", value: fmt(tot.opening), unit: "boxes" },
    { label: "In production", value: fmt(tot.inProduction), unit: "boxes", color: "var(--c-blue)" },
    { label: "In loading", value: fmt(tot.inLoading), unit: "boxes", color: "var(--c-violet)" },
    { label: "Available", value: fmt(tot.available), unit: "boxes", color: tot.available < 0 ? "var(--c-red)" : "var(--c-green)" },
    { label: "Items", value: fmt(rows.length) },
  ];

  return (
    <ReportShell
      title="Live Stock"
      subtitle="Opening + produced − loaded, per design"
      kpis={kpis}
      filter={{ title: "stock", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-stock",
        rows,
        columns: [
          { header: "Design", value: (r) => r.label },
          { header: "Spec", value: (r) => r.sub },
          { header: "Opening", value: (r) => r.opening },
          { header: "In production", value: (r) => r.inProduction },
          { header: "In loading", value: (r) => r.inLoading },
          { header: "Available", value: (r) => r.available },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && orders.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="label" label="Design" sort={sort} />
                  <th>Spec</th>
                  <SortTh id="opening" label="Opening" sort={sort} className="num" style={numTh} />
                  <SortTh id="inProduction" label="In production" sort={sort} className="num" style={numTh} />
                  <SortTh id="inLoading" label="In loading" sort={sort} className="num" style={numTh} />
                  <SortTh id="available" label="Available" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ color: "var(--fg)" }}>{r.label}</td>
                    <td className="muted">{r.sub || "—"}</td>
                    <td className="num mono">{fmt(r.opening)}</td>
                    <td className="num"><InProductionCell total={r.inProduction} onOpen={() => setIpRow(r)} /></td>
                    <td className="num mono">{fmt(r.inLoading)}</td>
                    <td className="num mono" style={{ fontWeight: 600, color: r.available < 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(r.available)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <EmptyState icon="package" title="No items" hint="Adjust the filters, or add items." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted">{rows.length} items</td>
                  <td className="num mono">{fmt(tot.opening)}</td>
                  <td className="num mono">{fmt(tot.inProduction)}</td>
                  <td className="num mono">{fmt(tot.inLoading)}</td>
                  <td className="num mono" style={{ color: tot.available < 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(tot.available)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
      {ipRow && (
        <InProductionModal label={ipRow.label} total={ipRow.inProduction} orders={ipRow.inProductionOrders} onClose={() => setIpRow(null)} />
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Dispatch feed (shared) ─────────────────────────── */

/** The palletization/loading feed every dispatch report reads. One cached
    fetch (listPalPlans) serves plans, their lines and the load boxes. */
function usePalPlanFeed() {
  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    void listPalPlans().then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) {
        setError(null);
        setPlans(r.plans);
        setBoxes(r.boxes);
      } else setError(r.error || "Failed to load the palletization feed");
    });
    return () => {
      alive = false;
    };
  }, [nonce]);
  return { plans, boxes, loading, error, reload: () => setNonce((n) => n + 1) };
}

/** Every plan line paired with its plan and load box — the flat row the
    dispatch reports filter over. */
interface LineRow {
  plan: PalPlan;
  line: PalPlanLine;
  box?: LoadBox;
}
const flatLines = (plans: PalPlan[], boxes: LoadBox[]): LineRow[] => {
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  return plans.flatMap((plan) =>
    plan.lines.map((line) => ({ plan, line, box: line.loadBoxId ? boxById.get(line.loadBoxId) : undefined })),
  );
};

/** Derived loading stage of a line — the SAME rule the loading board uses
    (LoadingBay.stageOf): no box = Ready, Open box = In Loading, sealed Open box
    = Ready for Dispatch, Dispatched box = done. "" = still pre-loading. */
const loadStageOf = (r: LineRow): string => {
  if (r.box?.status === "Dispatched") return "Dispatched";
  if (r.box) return sealed(r.box) ? "Ready for Dispatch" : "In Loading";
  if (r.line.status === "ReadyToLoad") return "Ready for Loading";
  return r.line.status === "Palletizing" ? "Palletizing" : "Ready for Palletization";
};

/* ─────────────────────────── Ready pallets ─────────────────────────── */

interface ReadyRow {
  key: string;
  batch: string;
  item: string;
  customer: string;
  so: string;
  pal: string;
  pallet: string;
  boxes: number;
  since: string;
}

function ReadyReport() {
  const { plans, boxes, loading, error, reload } = usePalPlanFeed();
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  // Palletised and waiting: ReadyToLoad with no load box yet.
  const allRows = useMemo<ReadyRow[]>(
    () =>
      flatLines(plans, boxes)
        .filter((r) => r.line.status === "ReadyToLoad" && !r.box)
        .map((r) => ({
          key: r.line.id,
          batch: r.line.batchNumber || "—",
          item: r.line.designLabel,
          customer: r.line.customerName || "—",
          so: r.line.soNumber,
          pal: r.plan.palNumber,
          pallet: r.line.palletName,
          boxes: r.line.boxes,
          since: r.line.createdTime.slice(0, 10),
        })),
    [plans, boxes],
  );

  const fields = useMemo<FilterField<ReadyRow>[]>(
    () => [
      { key: "item", label: "Item", type: "select", options: distinct(allRows.map((r) => r.item)), get: (r) => r.item },
      { key: "customer", label: "Customer", type: "select", options: distinct(allRows.map((r) => r.customer)), get: (r) => r.customer },
      { key: "so", label: "Order", type: "select", options: distinct(allRows.map((r) => r.so)), get: (r) => r.so },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batch },
    ],
    [allRows],
  );
  const rows = useMemo(() => applyFilters(allRows, criteria, fields), [allRows, criteria, fields]);
  const totBoxes = rows.reduce((s, b) => s + b.boxes, 0);
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "since");
  const pager = usePagination(rows.length, "reportReadyPageSize", `${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Pallet lines", value: fmt(rows.length) },
    { label: "Boxes awaiting loading", value: fmt(totBoxes), unit: "boxes", color: "var(--c-cyan)" },
    { label: "Customers", value: fmt(distinct(rows.map((r) => (r.customer === "—" ? "" : r.customer))).length) },
  ];

  return (
    <ReportShell
      title="Ready Pallets"
      subtitle="Palletised and waiting — not yet in a loading"
      kpis={kpis}
      filter={{ title: "ready pallets", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-ready-pallets",
        rows,
        columns: [
          { header: "Batch", value: (r) => r.batch },
          { header: "Item", value: (r) => r.item },
          { header: "Customer", value: (r) => r.customer },
          { header: "Order", value: (r) => r.so },
          { header: "Plan", value: (r) => r.pal },
          { header: "Pallet", value: (r) => r.pallet },
          { header: "Boxes", value: (r) => r.boxes },
          { header: "Ready since", value: (r) => r.since },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && plans.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="item" label="Item" sort={sort} />
                  <SortTh id="customer" label="Customer" sort={sort} />
                  <SortTh id="so" label="Order" sort={sort} />
                  <SortTh id="pal" label="Plan" sort={sort} />
                  <SortTh id="pallet" label="Pallet" sort={sort} />
                  <SortTh id="since" label="Ready since" sort={sort} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((b) => (
                  <tr key={b.key}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{b.batch}</td>
                    <td className="nw"><span className="clip" title={b.item}>{b.item}</span></td>
                    <td className="nw"><span className="clip" title={b.customer}>{b.customer}</span></td>
                    <td className="mono muted">{b.so}</td>
                    <td className="mono muted">{b.pal}</td>
                    <td className="muted">{b.pallet}</td>
                    <td className="mono muted">{b.since || "—"}</td>
                    <td className="num mono">{fmt(b.boxes)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <EmptyState icon="truck" title="No pallets waiting" hint="Palletise a line on the Palletization board to see it here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={6}>{rows.length} pallet lines</td>
                  <td className="num mono">{fmt(totBoxes)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Quote aging ─────────────────────────── */

interface AgingRow {
  q: Quote;
  since: string;
  ms: number;
}

function AgingReport() {
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [transitions, setTransitions] = useState<DSRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<FilterCriteria>({});

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

  const allRows = useMemo<AgingRow[] | null>(() => {
    if (transitions === null) return null;
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
      });
  }, [quotes, transitions]);

  const fields = useMemo<FilterField<AgingRow>[]>(
    () => [
      { key: "status", label: "Status", type: "select", options: distinct((allRows ?? []).map((r) => STATUS_LABEL[r.q.status])), get: (r) => STATUS_LABEL[r.q.status] },
      { key: "customer", label: "Customer", type: "text", get: (r) => r.q.customer },
    ],
    [allRows],
  );
  const rows = useMemo(() => applyFilters(allRows ?? [], criteria, fields), [allRows, criteria, fields]);

  const sort = useSortRows(rows, (r, k) => (k === "quoteNo" ? r.q.quoteNo : k === "customer" ? r.q.customer : k === "status" ? STATUS_LABEL[r.q.status] : r.ms), "ms");
  const pager = usePagination(rows.length, "reportAgingPageSize", `${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const longest = rows.reduce((m, r) => Math.max(m, r.ms), 0);
  const avg = rows.length ? rows.reduce((s, r) => s + r.ms, 0) / rows.length : 0;
  const kpis: KpiSpec[] = [
    { label: "Open quotes", value: fmt(rows.length) },
    { label: "Longest wait", value: fmtDuration(longest), color: "var(--c-amber)" },
    { label: "Average wait", value: fmtDuration(avg) },
  ];

  if (error) return <ReportShell title="Quote Aging"><ErrorCard message={error} /></ReportShell>;
  if (allRows === null) return <ReportShell title="Quote Aging"><SkeletonRows rows={8} /></ReportShell>;

  return (
    <ReportShell
      title="Quote Aging"
      subtitle="Where quotes are stuck — longest first"
      kpis={kpis}
      filter={{ title: "quotes", fields, criteria, onChange: setCriteria }}
      csv={{ name: "report-quote-aging", rows, columns: [{ header: "Quote No", value: (r) => r.q.quoteNo }, { header: "Customer", value: (r) => r.q.customer }, { header: "Status", value: (r: AgingRow) => STATUS_LABEL[r.q.status] }, { header: "Since", value: (r) => fmtLocalDateTime(r.since) }, { header: "Time in status", value: (r) => fmtDuration(r.ms) }] }}
    >
      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <SortTh id="quoteNo" label="Quote No" sort={sort} />
                <SortTh id="customer" label="Customer" sort={sort} />
                <SortTh id="status" label="Status" sort={sort} />
                <th>In Status Since</th>
                <SortTh id="ms" label="Time in Status" sort={sort} className="num" style={numTh} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ q, since, ms }) => (
                <tr key={q.id}>
                  <td className="mono">
                    <Link className="linkish" to={`/quotes/${q.id}`} onClick={(e) => e.stopPropagation()} title="Open quote">{q.quoteNo}</Link>
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
        <GridFooter {...pager} />
      </div>
    </ReportShell>
  );
}

/* ─────────────────────────── Production batches (batch/date-wise) ─────────────────────────── */

interface BatchRow {
  key: string;
  batch: string;
  design: string;
  boxes: number;
  date: string;
  lines: number;
}

/** One recorded output row — the matrix plots these (a batch can span dates). */
interface BatchRecRow {
  batch: string;
  design: string;
  date: string;
  boxes: number;
}

function BatchReport() {
  const [entries, setEntries] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [loaded, setLoaded] = useState(() => cachedProductionLogs() != null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [view, setView] = usePersistedState<"list" | "matrix">("reportBatchView", "list");
  const [axis, setAxis] = usePersistedState<"date" | "batch">("reportBatchAxis", "date");
  const [bucket, setBucket] = usePersistedState<Bucket>("reportBatchBucket", "month");

  useEffect(() => {
    void listProductionLogs().then((r) => {
      if (!r.ok) setError(r.error || "Failed to load production log");
      else { setError(null); setEntries(r.entries); }
      setLoaded(true);
    });
  }, []);

  // Every dated output record, flattened once. Both views read this — the list
  // rolls it up per batch, the matrix keeps the dates apart.
  const recs = useMemo<BatchRecRow[]>(() => {
    const out: BatchRecRow[] = [];
    for (const e of entries) {
      for (const rec of e.records) {
        if (!rec.batchNumber) continue;
        out.push({
          batch: rec.batchNumber,
          design: rec.design || e.design || "—",
          date: rec.productionDate || rec.createdTime.slice(0, 10),
          boxes: rec.qtyBoxes,
        });
      }
    }
    return out;
  }, [entries]);

  // One row per production batch; the date is its first output.
  const allRows = useMemo<BatchRow[]>(() => {
    const m = new Map<string, BatchRow>();
    for (const rec of recs) {
      const r =
        m.get(rec.batch) ??
        { key: rec.batch, batch: rec.batch, design: rec.design, boxes: 0, date: rec.date, lines: 0 };
      r.boxes += rec.boxes;
      r.lines += 1;
      if (rec.date && (!r.date || rec.date < r.date)) r.date = rec.date;
      m.set(rec.batch, r);
    }
    return [...m.values()];
  }, [recs]);

  const fields = useMemo<FilterField<BatchRow>[]>(
    () => [
      { key: "design", label: "Item", type: "select", options: distinct(allRows.map((r) => r.design)), get: (r) => r.design },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batch },
    ],
    [allRows],
  );
  const rows = useMemo(
    () => applyFilters(allRows.filter((r) => inDateRange(r.date, date)), criteria, fields),
    [allRows, date, criteria, fields],
  );

  // The matrix filters the raw records with the SAME criteria, so its grand
  // total matches the list's "Boxes produced" KPI.
  const recFields = useMemo<FilterField<BatchRecRow>[]>(
    () => [
      { key: "design", label: "Item", type: "select", options: distinct(allRows.map((r) => r.design)), get: (r) => r.design },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batch },
    ],
    [allRows],
  );
  const matrixRecs = useMemo(
    () => applyFilters(recs.filter((r) => inDateRange(r.date, date)), criteria, recFields),
    [recs, date, criteria, recFields],
  );

  const tot = useMemo(() => rows.reduce((a, r) => ({ boxes: a.boxes + r.boxes, lines: a.lines + r.lines }), { boxes: 0, lines: 0 }), [rows]);
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "date", -1);
  const pager = usePagination(rows.length, "reportBatchPageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Batches", value: fmt(rows.length) },
    { label: "Boxes produced", value: fmt(tot.boxes), color: "var(--c-blue)" },
    { label: "Items", value: fmt(distinct(rows.map((r) => r.design)).length) },
  ];

  return (
    <ReportShell
      title="Production Batches"
      subtitle="Boxes produced per batch — batch/date-wise, live data"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "batches", fields, criteria, onChange: setCriteria }}
      bar={
        <>
          {view === "matrix" && (
            <>
              <Seg
                value={axis}
                onChange={setAxis}
                label="Matrix columns"
                options={[{ id: "date", label: "By date" }, { id: "batch", label: "By batch" }]}
              />
              {axis === "date" && <Seg value={bucket} onChange={setBucket} label="Date grouping" options={BUCKETS} />}
            </>
          )}
          <Seg
            value={view}
            onChange={setView}
            label="View"
            options={[{ id: "list", label: "List" }, { id: "matrix", label: "Matrix" }]}
          />
        </>
      }
      csv={{
        name: "report-production-batches",
        rows,
        columns: [
          { header: "Batch", value: (r) => r.batch },
          { header: "Item", value: (r) => r.design },
          { header: "Boxes", value: (r) => r.boxes },
          { header: "Date", value: (r) => r.date },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={() => setLoaded(false)} />}
      {!loaded && entries.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : view === "matrix" ? (
        <div className="card">
          <PivotTable
            rows={matrixRecs}
            rowKey={(r) => r.design}
            colKey={(r) => (axis === "date" ? bucketOf(r.date, bucket) : r.batch)}
            colLabel={(k) => (axis === "date" ? bucketLabel(k, bucket) : k)}
            value={(r) => r.boxes}
            rowHeader="Item"
            emptyTitle="No production in range"
            emptyHint="Widen the date range, or record production output."
          />
        </div>
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="design" label="Item" sort={sort} />
                  <SortTh id="date" label="Date" sort={sort} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                  <SortTh id="lines" label="Entries" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.batch}</td>
                    <td>{r.design}</td>
                    <td className="mono muted">{r.date || "—"}</td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                    <td className="num mono">{fmt(r.lines)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <EmptyState icon="factory" title="No batches yet" hint="Record production output to see batches here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={2}>{rows.length} batches</td>
                  <td className="num mono">{fmt(tot.boxes)}</td>
                  <td className="num mono">{fmt(tot.lines)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Batch-wise stock ─────────────────────────── */

function BatchStockReport() {
  const [rowsRaw, setRowsRaw] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [loading, setLoading] = useState(() => cachedBatchStock() == null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  useEffect(() => {
    let alive = true;
    void listBatchStock().then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) { setError(null); setRowsRaw(r.rows); }
      else setError(r.error || "Failed to load batch stock");
    });
    return () => { alive = false; };
  }, [nonce]);

  const fields = useMemo<FilterField<BatchStockRow>[]>(
    () => [
      { key: "item", label: "Item", type: "select", options: distinct(rowsRaw.map((r) => r.designLabel)), get: (r) => r.designLabel },
      { key: "size", label: "Size", type: "select", options: distinct(rowsRaw.map((r) => r.sizeCode)), get: (r) => r.sizeCode },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batchNumber },
      { key: "current", label: "On hand", type: "numrange", get: (r) => r.current },
    ],
    [rowsRaw],
  );
  // Date range filters on the batch's mfg date; batches with no date always show
  // (excluding them would silently hide legacy stock).
  const rows = useMemo(
    () => applyFilters(rowsRaw.filter((r) => !r.mfgDate || inDateRange(r.mfgDate, date)), criteria, fields),
    [rowsRaw, date, criteria, fields],
  );

  const tot = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          opening: a.opening + r.opening,
          produced: a.produced + r.produced,
          palletised: a.palletised + r.palletised,
          dispatched: a.dispatched + r.dispatched,
          current: a.current + r.current,
        }),
        { opening: 0, produced: 0, palletised: 0, dispatched: 0, current: 0 },
      ),
    [rows],
  );
  const sort = useSortRows(
    rows,
    (r, k) =>
      k === "item" ? r.designLabel
      : k === "batch" ? r.batchNumber
      : k === "size" ? r.sizeCode
      : k === "mfg" ? r.mfgDate
      : (r as unknown as Record<string, number>)[k],
    "current",
  );
  const pager = usePagination(rows.length, "reportBatchStockPageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Batches", value: fmt(rows.length) },
    { label: "Items", value: fmt(distinct(rows.map((r) => r.designLabel)).length) },
    { label: "Produced", value: fmt(tot.produced + tot.opening), unit: "boxes", color: "var(--c-blue)" },
    { label: "Dispatched", value: fmt(tot.dispatched), unit: "boxes", color: "var(--c-violet)" },
    { label: "On hand", value: fmt(tot.current), unit: "boxes", color: "var(--c-green)" },
  ];

  return (
    <ReportShell
      title="Batch-wise Stock"
      subtitle="On-hand boxes per item and batch"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "batch stock", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-batch-stock",
        rows,
        columns: [
          { header: "Item", value: (r) => r.designLabel },
          { header: "Size", value: (r) => r.sizeCode },
          { header: "Batch", value: (r) => r.batchNumber },
          { header: "Mfg date", value: (r) => r.mfgDate },
          { header: "Opening", value: (r) => r.opening },
          { header: "Produced", value: (r) => r.produced },
          { header: "Palletised", value: (r) => r.palletised },
          { header: "Dispatched", value: (r) => r.dispatched },
          { header: "On hand", value: (r) => r.current },
          { header: "Over-consumed", value: (r) => r.over },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={() => setNonce((n) => n + 1)} />}
      {loading && rowsRaw.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="item" label="Item" sort={sort} />
                  <SortTh id="size" label="Size" sort={sort} />
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="mfg" label="Mfg date" sort={sort} />
                  <SortTh id="opening" label="Opening" sort={sort} className="num" style={numTh} />
                  <SortTh id="produced" label="Produced" sort={sort} className="num" style={numTh} />
                  <SortTh id="palletised" label="Palletised" sort={sort} className="num" style={numTh} />
                  <SortTh id="dispatched" label="Dispatched" sort={sort} className="num" style={numTh} />
                  <SortTh id="current" label="On hand" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={`${r.designId} ${r.batchNumber}`}>
                    <td className="nw">
                      <Link className="linkish clip" to={`/design/${r.designId}?tab=stock`} title={r.designLabel}>{r.designLabel}</Link>
                    </td>
                    <td>{r.sizeCode ? <span className="chip size">{r.sizeCode}</span> : <span className="dim">—</span>}</td>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.batchNumber || <span className="dim" title="Unattributed — legacy production, non-batched stock, and boxes palletised before recording">—</span>}</td>
                    <td className="mono muted">{r.mfgDate || "—"}</td>
                    <td className="num mono">{fmt(r.opening)}</td>
                    <td className="num mono">{fmt(r.produced)}</td>
                    <td className="num mono">{fmt(r.palletised)}</td>
                    <td className="num mono">{fmt(r.dispatched)}</td>
                    <td
                      className="num mono"
                      style={{ fontWeight: 600, color: r.over > 0 ? "var(--c-amber)" : "var(--c-green)" }}
                      title={r.over > 0 ? `${fmt(r.over)} more boxes consumed than this batch ever supplied — check the batch numbers` : undefined}
                    >
                      {fmt(r.current)}{r.over > 0 ? " ⚠" : ""}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      <EmptyState icon="package" title="No batch stock" hint="Record production output or opening stock to see batches here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={3}>{rows.length} batches</td>
                  <td className="num mono">{fmt(tot.opening)}</td>
                  <td className="num mono">{fmt(tot.produced)}</td>
                  <td className="num mono">{fmt(tot.palletised)}</td>
                  <td className="num mono">{fmt(tot.dispatched)}</td>
                  <td className="num mono" style={{ color: "var(--c-green)" }}>{fmt(tot.current)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Batch movement (consumption) ─────────────────────────── */

const MOVE_CHIP: Record<string, string> = {
  "On hand": "p-ready",
  Palletised: "p-palletized",
  Loaded: "p-loading",
  Dispatched: "p-completed",
};

function BatchMovementReport() {
  const { plans, boxes, loading, error, reload } = usePalPlanFeed();
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [view, setView] = usePersistedState<"list" | "matrix">("reportMoveView", "list");
  const [axis, setAxis] = usePersistedState<"customer" | "stage">("reportMoveAxis", "customer");

  useEffect(() => {
    void listBatchStock().then((r) => r.ok && setStock(r.rows));
  }, []);

  const allRows = useMemo<BatchMoveRow[]>(() => batchLedger(stock, plans, boxes), [stock, plans, boxes]);

  const fields = useMemo<FilterField<BatchMoveRow>[]>(
    () => [
      { key: "item", label: "Item", type: "select", options: distinct(allRows.map((r) => r.itemLabel)), get: (r) => r.itemLabel },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batchNumber },
      { key: "stage", label: "Stage", type: "multiselect", options: ["On hand", "Palletised", "Loaded", "Dispatched"], get: (r) => r.stage },
      { key: "customer", label: "Customer", type: "select", options: distinct(allRows.map((r) => r.customerName)), get: (r) => r.customerName },
      { key: "so", label: "Order", type: "select", options: distinct(allRows.map((r) => r.soNumber)), get: (r) => r.soNumber },
    ],
    [allRows],
  );
  // The date range narrows DISPATCHES; rows with no dispatch date (still on hand,
  // palletised, loaded) always show — they are the "not yet consumed" side.
  const rows = useMemo(
    () => applyFilters(allRows.filter((r) => !r.dispatchDate || inDateRange(r.dispatchDate, date)), criteria, fields),
    [allRows, date, criteria, fields],
  );

  const tot = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          boxes: a.boxes + r.boxes,
          dispatched: a.dispatched + (r.stage === "Dispatched" ? r.boxes : 0),
          onHand: a.onHand + (r.stage === "On hand" ? r.boxes : 0),
        }),
        { boxes: 0, dispatched: 0, onHand: 0 },
      ),
    [rows],
  );
  const sort = useSortRows(
    rows,
    (r, k) =>
      k === "batch" ? r.batchNumber
      : k === "item" ? r.itemLabel
      : k === "stage" ? r.stage
      : k === "customer" ? r.customerName
      : k === "so" ? r.soNumber
      : k === "box" ? r.boxName
      : k === "date" ? r.dispatchDate
      : r.boxes,
    "batch",
    -1,
  );
  const pager = usePagination(rows.length, "reportMovePageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Batches", value: fmt(distinct(rows.map((r) => r.batchNumber)).length) },
    { label: "Boxes accounted", value: fmt(tot.boxes), unit: "boxes" },
    { label: "Dispatched", value: fmt(tot.dispatched), unit: "boxes", color: "var(--c-violet)" },
    { label: "Still on hand", value: fmt(tot.onHand), unit: "boxes", color: "var(--c-green)" },
  ];

  return (
    <ReportShell
      title="Batch Movement"
      subtitle="Where each production batch went — palletised, loaded, dispatched, on hand"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "batch movement", fields, criteria, onChange: setCriteria }}
      bar={
        <>
          {view === "matrix" && (
            <Seg
              value={axis}
              onChange={setAxis}
              label="Matrix columns"
              options={[{ id: "customer", label: "By customer" }, { id: "stage", label: "By stage" }]}
            />
          )}
          <Seg
            value={view}
            onChange={setView}
            label="View"
            options={[{ id: "list", label: "List" }, { id: "matrix", label: "Matrix" }]}
          />
        </>
      }
      csv={{
        name: "report-batch-movement",
        rows,
        columns: [
          { header: "Batch", value: (r) => r.batchNumber },
          { header: "Item", value: (r) => r.itemLabel },
          { header: "Mfg date", value: (r) => r.mfgDate },
          { header: "Batch total", value: (r) => r.batchTotal },
          { header: "Stage", value: (r) => r.stage },
          { header: "Boxes", value: (r) => r.boxes },
          { header: "Customer", value: (r) => r.customerName },
          { header: "Order", value: (r) => r.soNumber },
          { header: "Plan", value: (r) => r.palNumber },
          { header: "Loading", value: (r) => r.boxName },
          { header: "Container", value: (r) => r.containerNumber },
          { header: "Vehicle", value: (r) => r.vehicleNumber },
          { header: "Dispatch date", value: (r) => r.dispatchDate },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && plans.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : view === "matrix" ? (
        <div className="card">
          <PivotTable
            rows={rows}
            rowKey={(r) => r.batchNumber || "—"}
            colKey={(r) => (axis === "customer" ? r.customerName || r.stage : r.stage)}
            value={(r) => r.boxes}
            rowHeader="Batch"
            emptyTitle="Nothing to plot"
            emptyHint="Adjust the filters or the date range."
          />
        </div>
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="item" label="Item" sort={sort} />
                  <SortTh id="stage" label="Stage" sort={sort} />
                  <SortTh id="customer" label="Customer" sort={sort} />
                  <SortTh id="so" label="Order" sort={sort} />
                  <SortTh id="box" label="Loading" sort={sort} />
                  <SortTh id="date" label="Dispatched" sort={sort} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.batchNumber || <span className="dim">—</span>}</td>
                    <td className="nw"><span className="clip" title={r.itemLabel}>{r.itemLabel}</span></td>
                    <td><span className={`chip ${MOVE_CHIP[r.stage] || ""}`}>{r.stage}</span></td>
                    <td className="nw"><span className="clip" title={r.customerName}>{r.customerName || <span className="dim">—</span>}</span></td>
                    <td className="mono muted">{r.soNumber || "—"}</td>
                    <td className="nw muted">
                      <span className="clip" title={[r.boxName, r.containerNumber].filter(Boolean).join(" · ")}>
                        {r.containerNumber || r.boxName || "—"}
                      </span>
                    </td>
                    <td className="mono muted">{r.dispatchDate || "—"}</td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <EmptyState icon="factory" title="No batch movement" hint="Record production output to see batches here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={6}>{rows.length} movements</td>
                  <td className="num mono">{fmt(tot.boxes)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Palletization status ─────────────────────────── */

interface PalStatusRow {
  key: string;
  pal: string;
  status: string;
  customer: string;
  so: string;
  planned: string;
  dispatchDate: string;
  queued: number; // Ready for Palletization + Palletizing
  ready: number; // palletised, awaiting a loading
  loaded: number; // in an open box
  dispatched: number;
  total: number;
  pct: number;
}

function PalStatusReport() {
  const { plans, boxes, loading, error, reload } = usePalPlanFeed();
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  const allRows = useMemo<PalStatusRow[]>(() => {
    const rowsByPlan = new Map<string, LineRow[]>();
    for (const r of flatLines(plans, boxes)) {
      (rowsByPlan.get(r.plan.id) ?? rowsByPlan.set(r.plan.id, []).get(r.plan.id)!).push(r);
    }
    return plans.map((p) => {
      const lines = rowsByPlan.get(p.id) || [];
      const bucket = { queued: 0, ready: 0, loaded: 0, dispatched: 0 };
      for (const r of lines) {
        const s = loadStageOf(r);
        if (s === "Dispatched") bucket.dispatched += r.line.boxes;
        else if (r.box) bucket.loaded += r.line.boxes;
        else if (s === "Ready for Loading") bucket.ready += r.line.boxes;
        else bucket.queued += r.line.boxes;
      }
      const total = bucket.queued + bucket.ready + bucket.loaded + bucket.dispatched;
      return {
        key: p.id,
        pal: p.palNumber,
        status: p.status,
        customer: p.customerNames.join(", ") || "—",
        so: p.soNumbers.join(", ") || "—",
        planned: p.plannedDate,
        dispatchDate: p.dispatchDate,
        ...bucket,
        total,
        pct: total > 0 ? Math.round((bucket.dispatched / total) * 100) : 0,
      };
    });
  }, [plans, boxes]);

  const fields = useMemo<FilterField<PalStatusRow>[]>(
    () => [
      { key: "status", label: "Status", type: "multiselect", options: distinct(allRows.map((r) => r.status)), get: (r) => r.status },
      { key: "customer", label: "Customer", type: "select", options: distinct(allRows.flatMap((r) => r.customer.split(", "))), get: (r) => r.customer },
      { key: "so", label: "Order", type: "text", get: (r) => r.so },
      { key: "pal", label: "Plan", type: "text", get: (r) => r.pal },
    ],
    [allRows],
  );
  // Range on the planned date, falling back to the dispatch date.
  const rows = useMemo(
    () => applyFilters(allRows.filter((r) => !(r.planned || r.dispatchDate) || inDateRange(r.planned || r.dispatchDate, date)), criteria, fields),
    [allRows, date, criteria, fields],
  );

  const tot = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          queued: a.queued + r.queued, ready: a.ready + r.ready,
          loaded: a.loaded + r.loaded, dispatched: a.dispatched + r.dispatched, total: a.total + r.total,
        }),
        { queued: 0, ready: 0, loaded: 0, dispatched: 0, total: 0 },
      ),
    [rows],
  );
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "planned", -1);
  const pager = usePagination(rows.length, "reportPalStatusPageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Plans", value: fmt(rows.length) },
    { label: "Awaiting palletization", value: fmt(tot.queued), unit: "boxes" },
    { label: "Ready to load", value: fmt(tot.ready), unit: "boxes", color: "var(--c-cyan)" },
    { label: "In loading", value: fmt(tot.loaded), unit: "boxes", color: "var(--c-blue)" },
    { label: "Dispatched", value: fmt(tot.dispatched), unit: "boxes", color: "var(--c-green)" },
  ];

  return (
    <ReportShell
      title="Palletization Status"
      subtitle="Every plan and how far its boxes have moved"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "plans", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-palletization-status",
        rows,
        columns: [
          { header: "Plan", value: (r) => r.pal },
          { header: "Status", value: (r) => r.status },
          { header: "Customer", value: (r) => r.customer },
          { header: "Order", value: (r) => r.so },
          { header: "Planned", value: (r) => r.planned },
          { header: "Dispatched on", value: (r) => r.dispatchDate },
          { header: "Awaiting palletization", value: (r) => r.queued },
          { header: "Ready to load", value: (r) => r.ready },
          { header: "In loading", value: (r) => r.loaded },
          { header: "Dispatched", value: (r) => r.dispatched },
          { header: "Total", value: (r) => r.total },
          { header: "% dispatched", value: (r) => r.pct },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && plans.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="pal" label="Plan" sort={sort} />
                  <SortTh id="status" label="Status" sort={sort} />
                  <SortTh id="customer" label="Customer" sort={sort} />
                  <SortTh id="so" label="Order" sort={sort} />
                  <SortTh id="planned" label="Planned" sort={sort} />
                  <SortTh id="queued" label="Awaiting" sort={sort} className="num" style={numTh} />
                  <SortTh id="ready" label="Ready" sort={sort} className="num" style={numTh} />
                  <SortTh id="loaded" label="In loading" sort={sort} className="num" style={numTh} />
                  <SortTh id="dispatched" label="Dispatched" sort={sort} className="num" style={numTh} />
                  <SortTh id="pct" label="Progress" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono"><Link className="linkish" to={`/packing/${r.key}`}>{r.pal || "—"}</Link></td>
                    <td><span className="chip">{r.status}</span></td>
                    <td className="nw"><span className="clip" title={r.customer}>{r.customer}</span></td>
                    <td className="nw mono muted"><span className="clip" title={r.so}>{r.so}</span></td>
                    <td className="mono muted">{r.planned || "—"}</td>
                    <td className="num mono">{fmt(r.queued)}</td>
                    <td className="num mono">{fmt(r.ready)}</td>
                    <td className="num mono">{fmt(r.loaded)}</td>
                    <td className="num mono">{fmt(r.dispatched)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <ProgressBar value={r.dispatched} max={r.total} color="var(--c-green)" height={4} />
                        <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{r.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: 0 }}>
                      <EmptyState icon="truck" title="No plans" hint="Palletization plans appear here once production is recorded." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={4}>{rows.length} plans</td>
                  <td className="num mono">{fmt(tot.queued)}</td>
                  <td className="num mono">{fmt(tot.ready)}</td>
                  <td className="num mono">{fmt(tot.loaded)}</td>
                  <td className="num mono">{fmt(tot.dispatched)}</td>
                  <td className="muted">{tot.total > 0 ? pct(tot.dispatched, tot.total) : "—"}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Loading & dispatch ─────────────────────────── */

interface LoadingRow {
  key: string;
  box: string;
  container: string;
  containerSize: string;
  vehicle: string;
  transporter: string;
  lr: string;
  seal: string;
  destination: string;
  supervisor: string;
  stage: string;
  dispatchDate: string;
  customers: string;
  boxes: number;
  fillPct: number;
}

const LOAD_CHIP: Record<string, string> = {
  "In Loading": "p-loading",
  "Ready for Dispatch": "p-palletized",
  Dispatched: "p-completed",
};

function LoadingStatusReport() {
  const { plans, boxes, loading, error, reload } = usePalPlanFeed();
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  const allRows = useMemo<LoadingRow[]>(() => {
    const linesByBox = new Map<string, PalPlanLine[]>();
    for (const p of plans) {
      for (const l of p.lines) {
        if (!l.loadBoxId) continue;
        (linesByBox.get(l.loadBoxId) ?? linesByBox.set(l.loadBoxId, []).get(l.loadBoxId)!).push(l);
      }
    }
    return boxes.map((b) => {
      const lines = linesByBox.get(b.id) || [];
      return {
        key: b.id,
        box: boxLabel(b),
        container: b.containerNumber,
        containerSize: b.containerSize,
        vehicle: b.vehicleNumber,
        transporter: b.transporter,
        lr: b.lrNumber,
        seal: [b.lineSeal, b.electronicSeal].filter(Boolean).join(" / "),
        destination: b.destination,
        supervisor: b.loadingSupervisor,
        stage: b.status === "Dispatched" ? "Dispatched" : sealed(b) ? "Ready for Dispatch" : "In Loading",
        dispatchDate: b.dispatchDate,
        customers: distinct(lines.map((l) => l.customerName)).join(", ") || "—",
        boxes: lines.reduce((s, l) => s + l.boxes, 0),
        fillPct: Math.round(boxFill(lines) * 100),
      };
    });
  }, [plans, boxes]);

  const fields = useMemo<FilterField<LoadingRow>[]>(
    () => [
      { key: "stage", label: "Status", type: "multiselect", options: ["In Loading", "Ready for Dispatch", "Dispatched"], get: (r) => r.stage },
      { key: "customers", label: "Customer", type: "select", options: distinct(allRows.flatMap((r) => r.customers.split(", "))), get: (r) => r.customers },
      { key: "container", label: "Container", type: "text", get: (r) => r.container },
      { key: "vehicle", label: "Vehicle", type: "text", get: (r) => r.vehicle },
      { key: "transporter", label: "Transporter", type: "select", options: distinct(allRows.map((r) => r.transporter)), get: (r) => r.transporter },
      { key: "destination", label: "Destination", type: "select", options: distinct(allRows.map((r) => r.destination)), get: (r) => r.destination },
    ],
    [allRows],
  );
  const rows = useMemo(
    () => applyFilters(allRows.filter((r) => !r.dispatchDate || inDateRange(r.dispatchDate, date)), criteria, fields),
    [allRows, date, criteria, fields],
  );

  const totBoxes = rows.reduce((s, r) => s + r.boxes, 0);
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "dispatchDate", -1);
  const pager = usePagination(rows.length, "reportLoadingPageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Loadings", value: fmt(rows.length) },
    { label: "In loading", value: fmt(rows.filter((r) => r.stage === "In Loading").length) },
    { label: "Ready for dispatch", value: fmt(rows.filter((r) => r.stage === "Ready for Dispatch").length), color: "var(--c-cyan)" },
    { label: "Dispatched", value: fmt(rows.filter((r) => r.stage === "Dispatched").length), color: "var(--c-green)" },
    { label: "Boxes", value: fmt(totBoxes), unit: "boxes" },
  ];

  return (
    <ReportShell
      title="Loading & Dispatch"
      subtitle="Every loading, its container, vehicle and seals"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "loadings", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-loading-dispatch",
        rows,
        columns: [
          { header: "Loading", value: (r) => r.box },
          { header: "Container", value: (r) => r.container },
          { header: "Container size", value: (r) => r.containerSize },
          { header: "Vehicle", value: (r) => r.vehicle },
          { header: "Transporter", value: (r) => r.transporter },
          { header: "LR no.", value: (r) => r.lr },
          { header: "Seals", value: (r) => r.seal },
          { header: "Destination", value: (r) => r.destination },
          { header: "Supervisor", value: (r) => r.supervisor },
          { header: "Customers", value: (r) => r.customers },
          { header: "Status", value: (r) => r.stage },
          { header: "Dispatch date", value: (r) => r.dispatchDate },
          { header: "Boxes", value: (r) => r.boxes },
          { header: "Fill %", value: (r) => r.fillPct },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && boxes.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="box" label="Loading" sort={sort} />
                  <SortTh id="container" label="Container" sort={sort} />
                  <SortTh id="vehicle" label="Vehicle" sort={sort} />
                  <SortTh id="transporter" label="Transporter" sort={sort} />
                  <SortTh id="lr" label="LR no." sort={sort} />
                  <SortTh id="destination" label="Destination" sort={sort} />
                  <SortTh id="customers" label="Customers" sort={sort} />
                  <SortTh id="stage" label="Status" sort={sort} />
                  <SortTh id="dispatchDate" label="Dispatched" sort={sort} />
                  <SortTh id="fillPct" label="Fill" sort={sort} className="num" style={numTh} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td className="nw"><Link className="linkish" to={`/loading/${r.key}`}>{r.box}</Link></td>
                    <td className="mono">{r.container || <span className="dim">—</span>}</td>
                    <td className="mono muted">{r.vehicle || "—"}</td>
                    <td className="nw muted"><span className="clip" title={r.transporter}>{r.transporter || "—"}</span></td>
                    <td className="mono muted">{r.lr || "—"}</td>
                    <td className="nw muted"><span className="clip" title={r.destination}>{r.destination || "—"}</span></td>
                    <td className="nw"><span className="clip" title={r.customers}>{r.customers}</span></td>
                    <td><span className={`chip ${LOAD_CHIP[r.stage] || ""}`}>{r.stage}</span></td>
                    <td className="mono muted">{r.dispatchDate || "—"}</td>
                    <td className="num mono">{r.fillPct}%</td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ padding: 0 }}>
                      <EmptyState icon="truck" title="No loadings" hint="Start a loading on the Loading board to see it here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={9}>{rows.length} loadings</td>
                  <td className="num mono">{fmt(totBoxes)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Dispatch register ─────────────────────────── */

interface DispatchRow {
  key: string;
  date: string;
  box: string;
  container: string;
  vehicle: string;
  lr: string;
  destination: string;
  customer: string;
  so: string;
  pal: string;
  item: string;
  batch: string;
  boxes: number;
}

function DispatchRegisterReport() {
  const { plans, boxes, loading, error, reload } = usePalPlanFeed();
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  // Ground truth = a plan line whose load box has been dispatched (the same
  // rule DispatchTab uses), one register line each.
  const allRows = useMemo<DispatchRow[]>(
    () =>
      flatLines(plans, boxes)
        .filter((r) => r.box?.status === "Dispatched")
        .map((r) => ({
          key: r.line.id,
          date: r.box!.dispatchDate,
          box: boxLabel(r.box!),
          container: r.box!.containerNumber,
          vehicle: r.box!.vehicleNumber,
          lr: r.box!.lrNumber,
          destination: r.box!.destination,
          customer: r.line.customerName || "—",
          so: r.line.soNumber,
          pal: r.plan.palNumber,
          item: r.line.designLabel,
          batch: r.line.batchNumber || "—",
          boxes: r.line.boxes,
        })),
    [plans, boxes],
  );

  const fields = useMemo<FilterField<DispatchRow>[]>(
    () => [
      { key: "customer", label: "Customer", type: "select", options: distinct(allRows.map((r) => r.customer)), get: (r) => r.customer },
      { key: "so", label: "Order", type: "select", options: distinct(allRows.map((r) => r.so)), get: (r) => r.so },
      { key: "item", label: "Item", type: "select", options: distinct(allRows.map((r) => r.item)), get: (r) => r.item },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batch },
      { key: "container", label: "Container", type: "text", get: (r) => r.container },
      { key: "destination", label: "Destination", type: "select", options: distinct(allRows.map((r) => r.destination)), get: (r) => r.destination },
    ],
    [allRows],
  );
  const rows = useMemo(
    () => applyFilters(allRows.filter((r) => inDateRange(r.date, date)), criteria, fields),
    [allRows, date, criteria, fields],
  );

  const totBoxes = rows.reduce((s, r) => s + r.boxes, 0);
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "date", -1);
  const pager = usePagination(rows.length, "reportDispatchPageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Dispatch lines", value: fmt(rows.length) },
    { label: "Boxes dispatched", value: fmt(totBoxes), unit: "boxes", color: "var(--c-green)" },
    { label: "Loadings", value: fmt(distinct(rows.map((r) => r.box)).length) },
    { label: "Customers", value: fmt(distinct(rows.map((r) => (r.customer === "—" ? "" : r.customer))).length) },
  ];

  return (
    <ReportShell
      title="Dispatch Register"
      subtitle="Every dispatched line — date, container, customer, item and batch"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "dispatches", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-dispatch-register",
        rows,
        columns: [
          { header: "Dispatch date", value: (r) => r.date },
          { header: "Loading", value: (r) => r.box },
          { header: "Container", value: (r) => r.container },
          { header: "Vehicle", value: (r) => r.vehicle },
          { header: "LR no.", value: (r) => r.lr },
          { header: "Destination", value: (r) => r.destination },
          { header: "Customer", value: (r) => r.customer },
          { header: "Order", value: (r) => r.so },
          { header: "Plan", value: (r) => r.pal },
          { header: "Item", value: (r) => r.item },
          { header: "Batch", value: (r) => r.batch },
          { header: "Boxes", value: (r) => r.boxes },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={reload} />}
      {loading && plans.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="date" label="Dispatched" sort={sort} />
                  <SortTh id="container" label="Container" sort={sort} />
                  <SortTh id="vehicle" label="Vehicle" sort={sort} />
                  <SortTh id="customer" label="Customer" sort={sort} />
                  <SortTh id="so" label="Order" sort={sort} />
                  <SortTh id="item" label="Item" sort={sort} />
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="destination" label="Destination" sort={sort} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.date || "—"}</td>
                    <td className="mono">{r.container || <span className="dim">{r.box}</span>}</td>
                    <td className="mono muted">{r.vehicle || "—"}</td>
                    <td className="nw"><span className="clip" title={r.customer}>{r.customer}</span></td>
                    <td className="mono muted">{r.so}</td>
                    <td className="nw"><span className="clip" title={r.item}>{r.item}</span></td>
                    <td className="mono muted">{r.batch}</td>
                    <td className="nw muted"><span className="clip" title={r.destination}>{r.destination || "—"}</span></td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      <EmptyState icon="truck" title="Nothing dispatched" hint="Dispatch a loading to see it in the register." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={7}>{rows.length} lines</td>
                  <td className="num mono">{fmt(totBoxes)}</td>
                </TotalsRow>
              )}
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </ReportShell>
  );
}

/* ─────────────────────────── Registry + dispatcher ─────────────────────────── */

export type ReportSection = "Sales" | "Customer" | "Item" | "Inventory" | "Dispatch";

export interface ReportDef {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  Component: ComponentType;
}

export const REPORTS: ReportDef[] = [
  { id: "by-item", title: "By Item", subtitle: "Ordered vs produced vs remaining, per design", icon: "tile", Component: () => <QtyReport mode="item" /> },
  { id: "by-po", title: "By PO", subtitle: "Same rollup per purchase order", icon: "orders", Component: () => <QtyReport mode="po" /> },
  { id: "customer-sales", title: "Customer Sales", subtitle: "Revenue and volume per customer", icon: "users", Component: () => <SalesReport groupBy="customer" /> },
  { id: "salesperson-sales", title: "Salesperson Sales", subtitle: "Revenue and volume per sales person", icon: "user", Component: () => <SalesReport groupBy="salesperson" /> },
  { id: "size", title: "Size-wise", subtitle: "Ordered boxes grouped by size", icon: "tile", Component: SizeReport },
  { id: "production-batches", title: "Production Batches", subtitle: "Boxes produced per batch — list or item × date matrix", icon: "factory", Component: BatchReport },
  { id: "stock", title: "Live Stock", subtitle: "Opening + produced − loaded, per design", icon: "package", Component: StockReport },
  { id: "stock-batch", title: "Batch-wise Stock", subtitle: "On-hand boxes per item and batch", icon: "package", Component: BatchStockReport },
  { id: "batch-movement", title: "Batch Movement", subtitle: "Where each batch went — palletised, loaded, dispatched, on hand", icon: "factory", Component: BatchMovementReport },
  { id: "ready", title: "Ready Pallets", subtitle: "Palletised and waiting, not yet in a loading", icon: "truck", Component: ReadyReport },
  { id: "pal-status", title: "Palletization Status", subtitle: "Every plan and how far its boxes have moved", icon: "truck", Component: PalStatusReport },
  { id: "loading-status", title: "Loading & Dispatch", subtitle: "Every loading, its container, vehicle and seals", icon: "truck", Component: LoadingStatusReport },
  { id: "dispatch-register", title: "Dispatch Register", subtitle: "Every dispatched line — date, container, customer, item, batch", icon: "orders", Component: DispatchRegisterReport },
  { id: "aging", title: "Quote Aging", subtitle: "Where quotes are stuck", icon: "clock", Component: AgingReport },
];

/** Which reports show under each landing-page section (a report may appear in more than one). */
export const REPORT_SECTIONS: { section: ReportSection; icon: string; ids: string[] }[] = [
  { section: "Sales", icon: "chart", ids: ["by-po", "salesperson-sales", "size"] },
  { section: "Customer", icon: "users", ids: ["customer-sales", "aging"] },
  { section: "Item", icon: "tile", ids: ["by-item", "size", "production-batches"] },
  { section: "Inventory", icon: "package", ids: ["stock", "stock-batch", "batch-movement", "ready", "production-batches"] },
  { section: "Dispatch", icon: "truck", ids: ["pal-status", "loading-status", "dispatch-register", "ready"] },
];

const BY_ID = Object.fromEntries(REPORTS.map((r) => [r.id, r]));

/** Route element for /reports/:id — looks up the report and renders it. */
export function ReportView() {
  const { id } = useParams<{ id: string }>();
  const def = id ? BY_ID[id] : undefined;
  if (!def) return <Navigate to="/reports" replace />;
  const C = def.Component;
  return <C />;
}
