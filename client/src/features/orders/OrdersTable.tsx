/* All Sales Orders table — backed by the Catalyst Data Store via ordersApi.
   Each row is an OrderItem joined to its SalesOrder header. New Order writes
   a real SalesOrder + OrderItems; every write is recorded in OperationLog. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useHiddenColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass } from "@/lib/format";
import { STAGES, type Order } from "@/data";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { createSalesOrder, listOrders, type NewSalesOrderInput } from "./ordersApi";
import { toast } from "@/ui/Toast";
import { PalletPackForm } from "@/features/stages/PalletPackForm";
import { closePallet, type ClosePalletInput } from "@/features/stages/palletisationApi";

// Toggleable columns (ID/PO + # and actions always shown).
const ORDER_COLUMNS: ColumnDef[] = [
  { key: "party", label: "Party" },
  { key: "design", label: "Design" },
  { key: "size", label: "Size" },
  { key: "finish", label: "Finish" },
  { key: "brand", label: "Brand" },
  { key: "qty", label: "Order Qty" },
  { key: "progress", label: "Progress" },
  { key: "remaining", label: "Remaining" },
  { key: "stage", label: "Stage" },
  { key: "due", label: "Due" },
];

let _soSeq = 100;
const genOrderNumber = () => `SO/2026-27/${++_soSeq}`;

export function draftToInput(dr: OrderDraft): NewSalesOrderInput {
  return {
    customer: dr.customer,
    order_number: genOrderNumber(),
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
  const { hidden, toggle, show } = useHiddenColumns("ordersTableColumns");
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
    setShowForm(false);
    setNotice("Saving master order…");
    const res = await createSalesOrder(draftToInput(dr));
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (tab !== "all" && o.stage !== tab) return false;
      if (!q) return true;
      return `${o.poNumber} ${o.party} ${o.design}`.toLowerCase().includes(q);
    });
  }, [tab, orders, query]);

  const pager = usePagination(filtered.length, "ordersPageSize", `${tab}|${query}`);

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
        <ColumnPicker columns={ORDER_COLUMNS} hidden={hidden} onToggle={toggle} />
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
                {show("party") && <th>Party</th>}
                {show("design") && <th>Design</th>}
                {show("size") && <th>Size</th>}
                {show("finish") && <th>Finish</th>}
                {show("brand") && <th>Brand</th>}
                {show("qty") && <th className="num" style={{ textAlign: "right" }}>Order Qty</th>}
                {show("progress") && <th>Progress</th>}
                {show("remaining") && <th className="num" style={{ textAlign: "right" }}>Remaining</th>}
                {show("stage") && <th>Stage</th>}
                {show("due") && <th>Due</th>}
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {pager.slice(filtered).map((o, i) => {
                const remaining = o.orderQty - o.loadedQty;
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
                    {show("party") && (
                      <td>
                        <span style={{ marginRight: 6 }}>{o.flag}</span>
                        {o.party}
                      </td>
                    )}
                    {show("design") && <td><span className="design-name">{o.design}</span></td>}
                    {show("size") && (
                      <td>
                        <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                      </td>
                    )}
                    {show("finish") && <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>}
                    {show("brand") && <td><span className={`chip brand ${o.brand === "BIG" ? "big" : ""}`}>{o.brand}</span></td>}
                    {show("qty") && <td className="num">{fmt(o.orderQty)}</td>}
                    {show("progress") && (
                      <td style={{ width: 140 }}>
                        <SplitBar produced={o.producedQty} palletized={o.palletizedQty} loaded={o.loadedQty} total={o.orderQty} />
                      </td>
                    )}
                    {show("remaining") && <td className="num">{fmt(remaining)}</td>}
                    {show("stage") && <td><StageBadge stage={o.stage} /></td>}
                    {show("due") && <td className="mono muted">{o.dueDate}</td>}
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
                  <td colSpan={14}>
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
