/* All Sales Orders table — backed by the Catalyst Data Store via ordersApi.
   Each row is an OrderItem joined to its SalesOrder header. New Order writes
   a real SalesOrder + OrderItems; every write is recorded in OperationLog. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass, fmtDateTime } from "@/lib/format";
import { STAGES, type Order } from "@/data";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { createSalesOrder, listOrders, type NewSalesOrderInput } from "./ordersApi";
import { toast } from "@/ui/Toast";
import { PalletPackForm } from "@/features/stages/PalletPackForm";
import { closePallet, type ClosePalletInput } from "@/features/stages/palletisationApi";

// Toggleable + reorderable columns (# / ID / PO / Actions pinned outside the map).
const ORDER_COLUMNS: ColumnDef<Order>[] = [
  {
    key: "party",
    label: "Party",
    render: (o) => (
      <>
        <span style={{ marginRight: 6 }}>{o.flag}</span>
        {o.party}
      </>
    ),
  },
  { key: "design", label: "Design", render: (o) => <span className="design-name">{o.design}</span> },
  {
    key: "size",
    label: "Size",
    render: (o) => (
      <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
    ),
  },
  { key: "finish", label: "Finish", render: (o) => <span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span> },
  { key: "brand", label: "Brand", render: (o) => <span className={`chip brand ${o.brand === "BIG" ? "big" : ""}`}>{o.brand}</span> },
  { key: "qty", label: "Order Qty (boxes)", className: "num", style: { textAlign: "right" }, render: (o) => fmt(o.orderQty) },
  {
    key: "progress",
    label: "Progress",
    render: (o) => (
      <div style={{ width: 140 }}>
        <SplitBar produced={o.producedQty} palletized={o.palletizedQty} loaded={o.loadedQty} total={o.orderQty} />
      </div>
    ),
  },
  {
    key: "remaining",
    label: "Remaining (boxes)",
    className: "num",
    style: { textAlign: "right" },
    render: (o) => fmt(o.orderQty - o.loadedQty),
  },
  { key: "stage", label: "Stage", render: (o) => <StageBadge stage={o.stage} /> },
  { key: "due", label: "Due", className: "mono muted", render: (o) => o.dueDate },
  { key: "created", label: "Created", className: "muted mono", render: (o) => fmtDateTime(o.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (o) => fmtDateTime(o.modifiedTime) },
];

export function draftToInput(dr: OrderDraft): NewSalesOrderInput {
  return {
    customer: dr.customer,
    order_number: "", // blank → data-ops assigns the next SO number server-side
    po_number: dr.po_number,
    order_date: dr.order_date,
    shipment_date: dr.shipment_date,
    payment_term: dr.payment_term,
    port_of_discharge: dr.port_of_discharge,
    status: dr.status,
    currency: dr.currency,
    remarks: dr.remarks,
    address: "",
    salesperson: dr.salesperson,
    box_branding: dr.box_branding,
    customer_notes: dr.customer_notes,
    terms: dr.terms,
    discount: parseFloat(dr.docDiscount) || 0,
    adjustment: parseFloat(dr.adjustment) || 0,
    tax_type: dr.taxType,
    tax_pct: parseFloat(dr.taxPct) || 0,
    lines: dr.lines.map((l) => ({
      item: l.design,
      qty: parseInt(l.ordered_qty_boxes, 10) || 0,
      rate: parseFloat(l.rate) || 0,
      discount: parseFloat(l.discount) || 0,
      stage: "po",
    })),
  };
}

export function OrdersTable() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { ordered, visible, hidden, toggle, move } = useColumns("ordersTableColumns", ORDER_COLUMNS, ["created", "modified"]);
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [packOrderId, setPackOrderId] = useState<string | null>(null);

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

  const onSave = async (dr: OrderDraft) => {
    setNotice("Saving master order…");
    const res = await createSalesOrder(draftToInput(dr));
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setShowForm(false);
    setNotice(`Master order saved (#${res.rowid}).`);
    toast.success(`Master order saved (#${res.rowid})`);
    await load();
  };

  const onPalletSave = async (input: ClosePalletInput) => {
    setPackOrderId(null);
    setNotice("Closing pallet…");
    const res = await closePallet(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Close-pallet failed");
      toast.error(res.error || "Close-pallet failed");
      return;
    }
    setNotice(`Pallet closed — batch #${res.rowid} · ${res.data?.boxes_packed ?? 0} boxes.`);
    toast.success(`Pallet closed — batch #${res.rowid} · ${res.data?.boxes_packed ?? 0} boxes`);
    await load();
  };

  // Advanced search fields (magnifier button) — options DB-sourced from rows.
  const filterFields = useMemo<FilterField<Order>[]>(() => {
    const opts = (get: (o: Order) => string) => [...new Set(orders.map(get).filter(Boolean))].sort();
    return [
      { key: "po", label: "PO Number", type: "text", get: (o) => o.poNumber },
      { key: "design", label: "Design", type: "text", get: (o) => o.design },
      { key: "party", label: "Party", type: "multiselect", options: opts((o) => o.party), get: (o) => o.party },
      { key: "size", label: "Size", type: "multiselect", options: opts((o) => o.size), get: (o) => o.size },
      { key: "finish", label: "Finish", type: "multiselect", options: opts((o) => o.finish), get: (o) => o.finish },
      { key: "brand", label: "Brand", type: "multiselect", options: opts((o) => o.brand), get: (o) => o.brand },
      { key: "stage", label: "Stage", type: "multiselect", options: opts((o) => o.stage), get: (o) => o.stage },
      { key: "qty", label: "Order Qty (boxes)", type: "numrange", get: (o) => o.orderQty },
      { key: "orderDate", label: "Order Date Between", type: "daterange", get: (o) => o.orderDate },
      { key: "created", label: "Created Between", type: "daterange", get: (o) => o.createdTime || "" },
    ];
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = orders.filter((o) => {
      if (tab !== "all" && o.stage !== tab) return false;
      if (!q) return true;
      return `${o.poNumber} ${o.party} ${o.design}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, orders, query, criteria, filterFields]);

  const pager = usePagination(filtered.length, "ordersPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);

  return (
    <div>
      {showForm && <OrderForm onSave={onSave} onClose={() => setShowForm(false)} />}
      {packOrderId && (
        <PalletPackForm presetOrderId={packOrderId} onSave={onPalletSave} onClose={() => setPackOrderId(null)} />
      )}
      <div className="page-head">
        <div>
          <div className="title">All Master Orders</div>
          <div className="sub">
            {loading ? "Loading…" : "Grouped by stage"}
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="tabs">
        <div className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          All <span className="muted mono" style={{ marginLeft: 4 }}>{orders.length}</span>
        </div>
        {STAGES.map((s) => (
          <div key={s.id} className={`tab ${tab === s.id ? "active" : ""}`} onClick={() => setTab(s.id)}>
            {s.label} <span className="muted mono" style={{ marginLeft: 4 }}>{orders.filter((o) => o.stage === s.id).length}</span>
          </div>
        ))}
      </div>

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search PO, party, design…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <AdvancedFilterButton title="Orders" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && orders.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>ID</th>
                <th>PO Number</th>
                {visible.map((c) => (
                  <th key={c.key} style={c.style}>{c.label}</th>
                ))}
                <th style={{ width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice(filtered).map((o, i) => {
                return (
                  <tr key={o.id}>
                    <td className="muted mono" style={{ textAlign: "center" }}>{pager.from + i}</td>
                    <td className="mono">
                      <button
                        className="linkish"
                        style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                        onClick={() => navigate(`/orders/${encodeURIComponent(o.id)}`)}
                        title="Open details"
                      >
                        {o.id}
                      </button>
                    </td>
                    <td className="mono" style={{ color: "var(--fg)" }}>{o.poNumber}</td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(o)}
                      </td>
                    ))}
                    <td>
                      {o.salesOrderId && (
                        <button
                          className="btn"
                          title="Send items to palletization"
                          onClick={() => setPackOrderId(o.salesOrderId!)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px" }}
                        >
                          <Icon name="palette" size={12} />
                          Palletize
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 4}>
                    {orders.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="orders"
                        title="No master orders yet"
                        hint="Create one from a Quote (Convert) or via New Order"
                        action={
                          <button className="hbtn primary" onClick={() => setShowForm(true)}>
                            New Order
                          </button>
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
