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
import { useOrders } from "@/features/orders/useOrders";
import { useMasters } from "@/features/masters/useMasters";
import { designStock, type InProductionOrder } from "@/lib/stock";
import { InProductionModal, InProductionCell } from "@/features/stages/InProductionModal";
import { cachedProductionLogs, listProductionLogs, type ProductionEntry } from "@/features/stages/productionApi";
import { listLoadableBatches, type LoadableBatch } from "@/features/stages/palletisationApi";
import { listAll, type DSRow } from "@/lib/dataOps";
import { cachedQuotes, listQuotes } from "@/features/quotes/quotesApi";
import { STATUS_CHIP, STATUS_LABEL } from "@/features/quotes/QuotesTable";
import type { Order, Quote } from "@/data";

const money = moneyFor("INR");
// ponytail: amount sums assume every order is INR; convert via order.exchangeRate
// if/when multi-currency reporting is needed.
const distinct = (vals: (string | undefined)[]) => [...new Set(vals.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));

const numTh = { textAlign: "right" as const };

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
  useEffect(() => {
    void listProductionLogs().then((r) => r.ok && setProdLogs(r.entries));
  }, []);

  const allRows = useMemo<StockRow[]>(() => {
    return designRows.map((d) => {
      const opening = d.accountingStock ?? 0;
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
  }, [designRows, orders, prodLogs]);

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

/* ─────────────────────────── Ready pallets ─────────────────────────── */

function ReadyReport() {
  const [batches, setBatches] = useState<LoadableBatch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void listLoadableBatches().then((res) => {
      if (!res.ok) setErr(res.error || "Failed to load ready pallets");
      else {
        setErr(null);
        setBatches(res.batches);
      }
    });
  }, []);

  const rows = batches ?? [];
  const totBoxes = rows.reduce((s, b) => s + b.boxes, 0);
  const sort = useSortRows(rows, (r, k) => (k === "batch" ? r.batchId : k === "label" ? r.label : r.boxes), "boxes");
  const pager = usePagination(rows.length, "reportReadyPageSize", `${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Closed batches", value: fmt(rows.length) },
    { label: "Boxes awaiting loading", value: fmt(totBoxes), color: "var(--c-cyan)" },
  ];

  return (
    <ReportShell title="Ready Pallets" subtitle="Closed batches not yet loaded into a container" kpis={kpis} csv={{ name: "report-ready-pallets", rows, columns: [{ header: "Batch", value: (r) => `#${r.batchId.slice(-6)}` }, { header: "Design", value: (r) => r.label }, { header: "Boxes", value: (r) => r.boxes }] }}>
      {err && <ErrorCard message={err} onRetry={() => setBatches(null)} />}
      {batches === null && !err ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="label" label="Design" sort={sort} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((b) => (
                  <tr key={b.batchId}>
                    <td className="mono muted">#{b.batchId.slice(-6)}</td>
                    <td style={{ color: "var(--fg)" }}>{b.label}</td>
                    <td className="num mono">{fmt(b.boxes)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 0 }}>
                      <EmptyState icon="truck" title="No pallets waiting" hint="Close a pallet in Pallet Packing to see it here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted">{rows.length} batches</td>
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
  shade: string;
  design: string;
  boxes: number;
  date: string;
  lines: number;
}

function BatchReport() {
  const [entries, setEntries] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [loaded, setLoaded] = useState(() => cachedProductionLogs() != null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<DateRangeState>({ from: "", to: "" });
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  useEffect(() => {
    void listProductionLogs().then((r) => {
      if (!r.ok) setError(r.error || "Failed to load production log");
      else { setError(null); setEntries(r.entries); }
      setLoaded(true);
    });
  }, []);

  // One row per production batch, summing its dated output records. One batch =
  // one shade, so shade/design are taken from the batch's records.
  const allRows = useMemo<BatchRow[]>(() => {
    const m = new Map<string, BatchRow & { earliest: string }>();
    for (const e of entries) {
      for (const rec of e.records) {
        if (!rec.batchNumber) continue;
        const when = rec.productionDate || rec.createdTime.slice(0, 10);
        const r =
          m.get(rec.batchNumber) ??
          { key: rec.batchNumber, batch: rec.batchNumber, shade: rec.shade || "—", design: rec.design || e.design || "—", boxes: 0, date: when, lines: 0, earliest: when };
        r.boxes += rec.qtyBoxes;
        r.lines += 1;
        if (when && (!r.earliest || when < r.earliest)) { r.earliest = when; r.date = when; }
        if (rec.shade && r.shade === "—") r.shade = rec.shade;
        m.set(rec.batchNumber, r);
      }
    }
    return [...m.values()].map(({ earliest: _e, ...r }) => r);
  }, [entries]);

  const fields = useMemo<FilterField<BatchRow>[]>(
    () => [
      { key: "design", label: "Design", type: "select", options: distinct(allRows.map((r) => r.design)), get: (r) => r.design },
      { key: "shade", label: "Shade", type: "select", options: distinct(allRows.map((r) => r.shade)), get: (r) => r.shade },
      { key: "batch", label: "Batch", type: "text", get: (r) => r.batch },
    ],
    [allRows],
  );
  const rows = useMemo(
    () => applyFilters(allRows.filter((r) => inDateRange(r.date, date)), criteria, fields),
    [allRows, date, criteria, fields],
  );

  const tot = useMemo(() => rows.reduce((a, r) => ({ boxes: a.boxes + r.boxes, lines: a.lines + r.lines }), { boxes: 0, lines: 0 }), [rows]);
  const sort = useSortRows(rows, (r, k) => (r as unknown as Record<string, number | string>)[k], "date", -1);
  const pager = usePagination(rows.length, "reportBatchPageSize", `${date.from}|${date.to}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);

  const kpis: KpiSpec[] = [
    { label: "Batches", value: fmt(rows.length) },
    { label: "Boxes produced", value: fmt(tot.boxes), color: "var(--c-blue)" },
    { label: "Shades", value: fmt(distinct(rows.map((r) => (r.shade === "—" ? "" : r.shade))).length) },
  ];

  return (
    <ReportShell
      title="Production Batches"
      subtitle="Boxes produced per batch and shade — batch/date-wise, live data"
      kpis={kpis}
      date={{ value: date, onChange: setDate }}
      filter={{ title: "batches", fields, criteria, onChange: setCriteria }}
      csv={{
        name: "report-production-batches",
        rows,
        columns: [
          { header: "Batch", value: (r) => r.batch },
          { header: "Shade", value: (r) => r.shade },
          { header: "Design", value: (r) => r.design },
          { header: "Boxes", value: (r) => r.boxes },
          { header: "Date", value: (r) => r.date },
        ],
      }}
    >
      {error && <ErrorCard message={error} onRetry={() => setLoaded(false)} />}
      {!loaded && entries.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="batch" label="Batch" sort={sort} />
                  <SortTh id="shade" label="Shade" sort={sort} />
                  <SortTh id="design" label="Design" sort={sort} />
                  <SortTh id="date" label="Date" sort={sort} />
                  <SortTh id="boxes" label="Boxes" sort={sort} className="num" style={numTh} />
                  <SortTh id="lines" label="Entries" sort={sort} className="num" style={numTh} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.batch}</td>
                    <td>{r.shade}</td>
                    <td>{r.design}</td>
                    <td className="mono muted">{r.date || "—"}</td>
                    <td className="num mono">{fmt(r.boxes)}</td>
                    <td className="num mono">{fmt(r.lines)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <EmptyState icon="factory" title="No batches yet" hint="Record production output to see batches here." />
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <TotalsRow>
                  <td>Total</td>
                  <td className="muted" colSpan={3}>{rows.length} batches</td>
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

/* ─────────────────────────── Registry + dispatcher ─────────────────────────── */

export type ReportSection = "Sales" | "Customer" | "Item" | "Inventory";

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
  { id: "production-batches", title: "Production Batches", subtitle: "Boxes produced per batch and shade, batch/date-wise", icon: "factory", Component: BatchReport },
  { id: "stock", title: "Live Stock", subtitle: "Opening + produced − loaded, per design", icon: "package", Component: StockReport },
  { id: "ready", title: "Ready Pallets", subtitle: "Closed batches awaiting loading", icon: "truck", Component: ReadyReport },
  { id: "aging", title: "Quote Aging", subtitle: "Where quotes are stuck", icon: "clock", Component: AgingReport },
];

/** Which reports show under each landing-page section (a report may appear in more than one). */
export const REPORT_SECTIONS: { section: ReportSection; icon: string; ids: string[] }[] = [
  { section: "Sales", icon: "chart", ids: ["by-po", "salesperson-sales", "size"] },
  { section: "Customer", icon: "users", ids: ["customer-sales", "aging"] },
  { section: "Item", icon: "tile", ids: ["by-item", "size", "production-batches"] },
  { section: "Inventory", icon: "package", ids: ["stock", "ready", "production-batches"] },
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
