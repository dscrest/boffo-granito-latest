/* Sales Orders grid — one row per SalesOrder, styled like the quotes
   master grid (checkbox selection + bulk bar, ColumnPicker, advanced
   filter, footer pager). Row click / SO-number link opens the detail. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog, promptDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { fmt, fmtDateTime, isRowId } from "@/lib/format";

/** User-friendly SO number, never the raw ROWID fallback. */
const soLabel = (r: SORow) => (r.head.orderNumber && !isRowId(r.head.orderNumber) ? r.head.orderNumber : "—");
import { type Order } from "@/data";
import type { OrderDraft } from "./OrderForm";
import { ViewToggle } from "./ViewToggle";
import {
  cachedOrders,
  deleteSalesOrder,
  listOrders,
  setOrderStatus,
  loadStatus,
  palStatus,
  soLiveStatus,
  soStatusLabel,
  SO_STATUSES,
  type NewSalesOrderInput,
  type SoChip,
} from "./ordersApi";

/** One grid row = one SalesOrder: the first hydrated line item carries the
    header fields; `items` is every line of that order. */
interface SORow {
  id: string; // salesOrderId
  head: Order;
  items: Order[];
}

// The status the row reads by — shared by the chip, the filter and the sort.
const statusKey = (r: SORow) => soLiveStatus(r.head.status || "Confirmed", r.items).key;
const soChip = (c: SoChip, title?: string) => (
  <span className={`chip qstatus nw ${c.cls}`} title={title ?? c.title}>{c.label}</span>
);

export function draftToInput(dr: OrderDraft): NewSalesOrderInput {
  return {
    customer: dr.customer,
    order_number: "", // blank → data-ops assigns the next SO number server-side
    po_number: dr.po_number,
    order_date: dr.order_date,
    shipment_date: dr.shipment_date,
    payment_term: dr.payment_term,
    port_of_discharge: dr.port_of_discharge,
    // status omitted — every order is born Draft server-side (/so-status machine).
    currency: dr.currency,
    exchange_rate: dr.exchange_rate,
    remarks: dr.remarks,
    address: dr.address,
    shipping_address: dr.shipping_address,
    salesperson: dr.salesperson,
    box_brand: dr.box_brand,
    customer_notes: dr.customer_notes,
    terms: dr.terms,
    discount: parseFloat(dr.docDiscount) || 0,
    adjustment: parseFloat(dr.adjustment) || 0,
    tax_type: dr.taxType,
    tax_pct: parseFloat(dr.taxPct) || 0,
    lines: dr.lines.map((l) => ({
      id: l.id, // edit in place (CR-232); undefined on create/clone
      item: l.design,
      qty: parseInt(l.ordered_qty_boxes, 10) || 0,
      rate: parseFloat(l.rate) || 0,
      pallet: l.pallet || "",
      discount: parseFloat(l.discount) || 0,
      description: l.description || "",
      stage: "po",
    })),
  };
}

// Toggleable + reorderable columns (SO Number pinned outside the map).
function soColumns(): ColumnDef<SORow>[] {
  return [
    {
      key: "party",
      label: "Customer",
      render: (r) => r.head.party,
    },
    { key: "po", label: "PO Number", className: "mono", render: (r) => r.head.poNumber || "—" },
    { key: "date", label: "Order Date", className: "mono muted", render: (r) => r.head.orderDate || "—" },
    { key: "items", label: "Items", className: "num mono", style: { textAlign: "right" }, render: (r) => r.items.length },
    {
      key: "qty",
      label: "Total Qty (boxes)",
      className: "num mono",
      style: { textAlign: "right" },
      render: (r) => fmt(r.items.reduce((s, o) => s + o.orderQty, 0)),
    },
    {
      key: "total",
      label: "Total",
      className: "num mono",
      style: { textAlign: "right" },
      render: (r) => <>{r.head.currency} {fmt(r.head.totalAmount || 0)}</>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        // Same function as the SO detail header — order lifecycle, full words (CR-233).
        const s = r.head.status || "Confirmed";
        return soChip(soLiveStatus(s, r.items), s === "Rejected" && r.head.rejectReason ? `Rejected: ${r.head.rejectReason}` : undefined);
      },
    },
    // Where the order's boxes are (CR-233) — from the items' recounted counters.
    { key: "palStatus", label: "Palletization Status", render: (r) => soChip(palStatus(r.items)) },
    { key: "loadStatus", label: "Loading Status", render: (r) => soChip(loadStatus(r.items)) },
    { key: "salesperson", label: "Salesperson", className: "muted", render: (r) => r.head.salesperson || "—" },
    { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.head.createdTime) },
    { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.head.modifiedTime) },
  ];
}

// Sortable value per column key (header-click sorting — grid standard).
function soSortVal(r: SORow, k: string): string | number {
  switch (k) {
    case "so": return soLabel(r);
    case "party": return r.head.party;
    case "po": return r.head.poNumber || "";
    case "date": return r.head.orderDate || "";
    case "items": return r.items.length;
    case "qty": return r.items.reduce((s, o) => s + o.orderQty, 0);
    case "total": return r.head.totalAmount || 0;
    case "status": return statusKey(r);
    case "palStatus": return palStatus(r.items).ratio;
    case "loadStatus": return loadStatus(r.items).ratio;
    case "salesperson": return r.head.salesperson || "";
    case "created": return r.head.createdTime || "";
    case "modified": return r.head.modifiedTime || "";
    default: return "";
  }
}

const STATUS_TABS = ["all", ...SO_STATUSES.filter((s) => s !== "Rejected")];

export function OrdersTable() {
  const navigate = useNavigate();
  const [tab, setTab] = usePersistedState<string>("orders.tab", "all");
  const [query, setQuery] = usePersistedState("orders.query", "");
  const [criteria, setCriteria] = usePersistedState<FilterCriteria>("orders.criteria", {});
  const COLS = useMemo(() => soColumns(), []);
  // Fresh storage key (old ordersTableColumns prefs were per-line-item columns).
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("soGridColumns", COLS, ["created", "modified"]);
  // Paint the last cached snapshot instantly (stale-while-revalidate).
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [loading, setLoading] = useState(() => cachedOrders() == null);
  const [error, setError] = useState<string | null>(null);

  // Bulk selection (same master-page convention as QuotesTable/DesignMaster).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await listOrders();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load orders");
      return;
    }
    setError(null);
    setOrders(res.orders);
  };

  useEffect(() => {
    void load();
  }, []);

  // Collapse line items into one row per SalesOrder (newest first).
  const rows = useMemo<SORow[]>(() => {
    const bySo = new Map<string, SORow>();
    for (const o of orders) {
      const id = o.salesOrderId;
      if (!id) continue;
      const r = bySo.get(id);
      if (r) r.items.push(o);
      else bySo.set(id, { id, head: o, items: [o] });
    }
    return [...bySo.values()].sort((a, b) => Number(b.id) - Number(a.id));
  }, [orders]);

  // Advanced search fields (magnifier button) — options DB-sourced from rows.
  const filterFields = useMemo<FilterField<SORow>[]>(() => {
    const opts = (get: (r: SORow) => string) => [...new Set(rows.map(get).filter(Boolean))].sort();
    return [
      { key: "soNo", label: "SO Number", type: "text", get: (r) => r.head.orderNumber || "" },
      { key: "po", label: "PO Number", type: "text", get: (r) => r.head.poNumber },
      { key: "party", label: "Customer", type: "multiselect", options: opts((r) => r.head.party), get: (r) => r.head.party },
      { key: "status", label: "Status", type: "multiselect", options: opts((r) => soStatusLabel(statusKey(r))), get: (r) => soStatusLabel(statusKey(r)) },
      { key: "palStatus", label: "Palletization Status", type: "multiselect", options: opts((r) => palStatus(r.items).key), get: (r) => palStatus(r.items).key },
      { key: "loadStatus", label: "Loading Status", type: "multiselect", options: opts((r) => loadStatus(r.items).key), get: (r) => loadStatus(r.items).key },
      { key: "total", label: "Total", type: "numrange", get: (r) => r.head.totalAmount || 0 },
      { key: "date", label: "Order Date Between", type: "daterange", get: (r) => r.head.orderDate },
      { key: "created", label: "Created Between", type: "daterange", get: (r) => r.head.createdTime || "" },
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (tab !== "all" && statusKey(r) !== tab) return false;
      if (!q) return true;
      return `${r.head.orderNumber} ${r.head.poNumber} ${r.head.party}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, rows, query, criteria, filterFields]);

  const sort = useSortRows(filtered, soSortVal, "created", -1); // newest first by default
  const pager = usePagination(filtered.length, "soGridPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(sort.sorted);

  // ponytail: select-all covers the visible page only; `selected` accumulates across pages.
  const allShownSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  const ids = useMemo(() => [...selected], [selected]);

  const onBulkStatus = async () => {
    if (!bulkStatus) return;
    // CR-231: a manual status change (any status) always records why.
    const reason = await promptDialog({
      title: "Change Status",
      message: `Reason for marking ${ids.length} order${ids.length === 1 ? "" : "s"} ${soStatusLabel(bulkStatus)}:`,
      placeholder: "Reason",
      confirmLabel: "Save",
      required: true,
    });
    if (reason == null) return;
    setBulkBusy(true);
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      const res = await setOrderStatus(id, bulkStatus, reason, true);
      if (res.ok) done += 1;
      else failed += 1;
    }
    setBulkBusy(false);
    if (failed) toast.error(`${done} updated, ${failed} failed (approval rights are still required)`);
    else toast.success(`${done} order${done === 1 ? "" : "s"} marked ${soStatusLabel(bulkStatus)}`);
    setSelected(new Set());
    setBulkStatus("");
    await load();
  };

  const onBulkDelete = async () => {
    if (!(await confirmDialog({ message: `Are you sure you want to delete ${ids.length} selected order${ids.length > 1 ? "s" : ""}? This cannot be undone.`, danger: true })))
      return;
    setBulkBusy(true);
    let done = 0;
    let failed = 0;
    for (const rowid of ids) {
      const res = await deleteSalesOrder(rowid);
      if (res.ok) done += 1;
      else failed += 1;
    }
    setBulkBusy(false);
    if (failed) toast.error(`${done} deleted, ${failed} failed`);
    else toast.success(`${done} order${done === 1 ? "" : "s"} deleted`);
    setSelected(new Set());
    await load();
  };

  const tabCount = (id: string) =>
    id === "all" ? rows.length : rows.filter((r) => statusKey(r) === id).length;

  return (
    <div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ marginBottom: 12, borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          {can("orders", "edit") && (
            <>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} disabled={bulkBusy} title="Bulk status change">
                <option value="">Change status…</option>
                {SO_STATUSES.map((s) => (
                  <option key={s} value={s}>{soStatusLabel(s)}</option>
                ))}
              </select>
              <button className="btn" onClick={() => void onBulkStatus()} disabled={!bulkStatus || bulkBusy}>
                Apply
              </button>
            </>
          )}
          {can("orders", "delete") && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={bulkBusy}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : (
        <div className="fbar" style={{ marginBottom: 12 }}>
          <Icon name="filter" size={12} />
          <select className={tab !== "all" ? "on" : undefined} value={tab} onChange={(e) => setTab(e.target.value)} title="Filter by status">
            {STATUS_TABS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All" : soStatusLabel(t)} ({tabCount(t)})
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input
              type="text"
              placeholder="Search SO no, PO, customer…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <AdvancedFilterButton title="Sales Orders" fields={filterFields} criteria={criteria} onChange={setCriteria} />
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
          <ViewToggle />
          {can("orders", "create") && (
            <button className="hbtn primary" onClick={() => navigate("/orders/new")} title="New Order">
              <Icon name="plus" size={13} />
              New Order
            </button>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && orders.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title="Select all on this page" />
                </th>
                <SortTh id="so" label="SO Number" sort={sort} />
                {visible.map((c) => (
                  <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => navigate(`/orders/${r.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/orders/${r.id}`); }}
                  style={{ cursor: "pointer", background: selected.has(r.id) ? "var(--accent-soft)" : undefined }}
                >
                  <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                  </td>
                  <td className="mono">
                    <Link className="linkish" to={`/orders/${r.id}`} onClick={(e) => e.stopPropagation()} title="View order">
                      {soLabel(r)}
                    </Link>
                  </td>
                  {visible.map((c) => (
                    <td key={c.key} className={c.className} style={c.style}>
                      {c.render!(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 2}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="orders"
                        title="No sales orders yet"
                        hint="Create one from a Quote (Convert) or via New Order"
                        action={
                          can("orders", "create") ? (
                            <button className="hbtn primary" onClick={() => navigate("/orders/new")}>
                              New Order
                            </button>
                          ) : undefined
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
        {!(loading && orders.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
