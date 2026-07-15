/* ============================================================
   Approvals — one inbox for quotes and sales orders awaiting approval.

   A single flat grid (not sectioned by module) of every PendingApproval
   quote / SO, oldest-first, with a Module column and click-to-sort
   headers. Module / Sales Person / Date advanced filters narrow the list.
   Approve / Reject-with-reason drive the /quote-status and /so-status
   state machines; a reject sets status "Rejected" and notifies the
   salesperson in-app. Rows show only for doc types the role may approve
   (Admin always qualifies); the route is gated the same way in App.tsx.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { ErrorCard } from "@/ui/States";
import { promptDialog } from "@/ui/ConfirmDialog";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { fmt } from "@/lib/format";
import { canApprove } from "@/lib/auth";
import { quoteTotals, type Order, type Quote } from "@/data";
import { cachedQuotes, invalidateQuotes, listQuotes, setQuoteStatus } from "./quotesApi";
import { cachedOrders, invalidateOrders, listOrders, setOrderStatus } from "@/features/orders/ordersApi";
import {
  cachedProductionLogs,
  groupProductionRequests,
  invalidateProductionLogs,
  listProductionLogs,
  setProductionStatus,
  type ProductionEntry,
  type ProductionRequestGroup,
} from "@/features/stages/productionApi";

type Module = "Quote" | "Sales Order" | "Production";
/* Consistent noun for approval/reject toasts across every surface — the record
   number varies per module (and is misleading for Production, which is filed
   under its SO number), so messages name the document type instead. */
const MODULE_NOUN: Record<Module, string> = {
  Quote: "Quote",
  "Sales Order": "Sales order",
  Production: "Production request",
};
interface Row {
  id: string; // quote id | salesOrderId | request_group — also the busy key
  module: Module;
  number: string;
  customer: string;
  salesperson: string;
  date: string;
  total: string;
  link: string;
  quote?: Quote;
  order?: Order;
  production?: ProductionRequestGroup;
}
type SortKey = "module" | "number" | "customer" | "salesperson" | "date";

export function Approvals() {
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [prod, setProd] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // quote/SO id | request_group being acted on
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "asc" });

  const showQuotes = canApprove("Quote");
  const showOrders = canApprove("SalesOrder");
  const showProduction = canApprove("Production");

  const load = async () => {
    setLoading(true);
    const [q, o, p] = await Promise.all([
      showQuotes ? listQuotes() : Promise.resolve({ ok: true, quotes: [] as Quote[] }),
      showOrders ? listOrders() : Promise.resolve({ ok: true, orders: [] as Order[] }),
      showProduction ? listProductionLogs() : Promise.resolve({ ok: true, entries: [] as ProductionEntry[] }),
    ]);
    setLoading(false);
    const err =
      (!q.ok && (q as { error?: string }).error) ||
      (!o.ok && (o as { error?: string }).error) ||
      (!p.ok && (p as { error?: string }).error);
    if (err) {
      setError(err || "Failed to load approvals");
      return;
    }
    setError(null);
    if ("quotes" in q) setQuotes(q.quotes);
    if ("orders" in o) setOrders(o.orders);
    if ("entries" in p) setProd(p.entries);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo<Row[]>(() => {
    const pending = quotes.filter((q) => q.status === "PendingApproval");
    // ordersApi rows are per line item — collapse to one row per SalesOrder.
    const pendingSOs = [...new Map(
      orders.filter((o) => o.status === "PendingApproval" && o.salesOrderId).map((o) => [o.salesOrderId!, o]),
    ).values()];
    return [
      ...pending.map<Row>((q) => ({
        id: q.id,
        module: "Quote",
        number: q.quoteNo,
        customer: q.customer,
        salesperson: q.salesperson || "",
        date: q.quoteDate || "",
        total: `${q.currency} ${fmt(quoteTotals(q).final)}`,
        link: `/quotes/${q.id}`,
        quote: q,
      })),
      ...pendingSOs.map<Row>((o) => ({
        id: o.salesOrderId!,
        module: "Sales Order",
        number: o.orderNumber || o.poNumber,
        customer: `${o.flag} ${o.party}`,
        salesperson: o.salesperson || "",
        date: o.orderDate || "",
        total: "—",
        link: `/orders/${o.salesOrderId}`,
        order: o,
      })),
      ...groupProductionRequests(prod.filter((e) => e.status === "PendingApproval")).map<Row>((g) => ({
        id: g.group,
        module: "Production",
        number: g.orderNumber || g.poNumber || "Independent",
        customer: g.customer || "—",
        salesperson: g.performedBy || "",
        date: g.date || "",
        total: `${fmt(g.totalRequested)} boxes · ${g.lineCount} item${g.lineCount > 1 ? "s" : ""}`,
        link: g.salesOrderId ? `/orders/${g.salesOrderId}` : "/prod",
        production: g,
      })),
    ];
  }, [quotes, orders, prod]);

  const salespeople = useMemo(
    () => [...new Set(rows.map((r) => r.salesperson).filter(Boolean))].sort(),
    [rows],
  );
  const filterFields: FilterField<Row>[] = [
    { key: "module", label: "Module", type: "select", options: ["Quote", "Sales Order", "Production"], get: (r) => r.module },
    { key: "customer", label: "Customer", type: "text", get: (r) => r.customer },
    { key: "salesperson", label: "Sales Person", type: "select", options: salespeople, get: (r) => r.salesperson },
    { key: "date", label: "Date", type: "daterange", get: (r) => r.date },
  ];

  const visible = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return applyFilters(rows, criteria, filterFields).sort(
      (a, b) => String(a[sort.key]).localeCompare(String(b[sort.key])) * dir,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, criteria, sort, salespeople]);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  const act = async (row: Row, approve: boolean) => {
    let reason = "";
    if (!approve) {
      const r = await promptDialog({
        title: `Reject ${row.module.toLowerCase()}`,
        message: `Reason for rejecting ${row.number}:`,
        placeholder: "Rejection reason",
        confirmLabel: "Reject",
        danger: true,
        required: true,
      });
      if (r === null) return;
      reason = r;
    }
    setBusy(row.id);
    const res =
      row.module === "Quote"
        ? await setQuoteStatus(row.id, approve ? "Approved" : "Rejected", reason || undefined)
        : row.module === "Production"
          ? await setProductionStatus(row.id, approve ? "Approved" : "Rejected", reason || undefined)
          : await setOrderStatus(row.id, approve ? "Confirmed" : "Rejected", reason || undefined);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || "Action failed");
      return;
    }
    toast.success(`${MODULE_NOUN[row.module]} ${approve ? "approved" : "rejected"}`);
    if (row.module === "Quote") invalidateQuotes();
    else if (row.module === "Production") invalidateProductionLogs();
    else invalidateOrders();
    await load();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Approvals</div>
          <div className="sub">Quotes and sales orders submitted for approval — approve to release, or reject with a reason.</div>
        </div>
        <div className="right">
          <AdvancedFilterButton title="approvals" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ cursor: "pointer" }} onClick={() => onSort("module")}>Module{arrow("module")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => onSort("number")}>Number{arrow("number")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => onSort("customer")}>Customer{arrow("customer")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => onSort("salesperson")}>Salesperson{arrow("salesperson")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => onSort("date")}>Date{arrow("date")}</th>
                <th className="num" style={{ textAlign: "right" }}>Total</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={`${r.module}-${r.id}`}>
                  <td><span className="chip">{r.module}</span></td>
                  <td>
                    <Link className="linkish" to={r.link} title={`Open ${r.module.toLowerCase()}`}>
                      {r.number || "—"}
                    </Link>
                  </td>
                  <td>{r.customer}</td>
                  <td className="muted">{r.salesperson || "—"}</td>
                  <td className="mono muted">{r.date || "—"}</td>
                  <td className="num mono">{r.total}</td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <button className="hbtn primary" disabled={busy === r.id} onClick={() => void act(r, true)} title="Approve">
                        <Icon name="check" size={13} /> Approve
                      </button>
                      <button className="hbtn" disabled={busy === r.id} onClick={() => void act(r, false)} title="Reject with reason" style={{ color: "var(--c-red)" }}>
                        <Icon name="x" size={13} /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Nothing waiting for approval.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
