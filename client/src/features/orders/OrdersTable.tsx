/* All Orders table. Base rows from mock ORDERS; newly-entered orders are
   kept in local `drafts` state (frontend-only) and shown first. */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass } from "@/lib/format";
import { DESIGNS, ORDERS, PARTIES, STAGES, type Order } from "@/data";
import { OrderForm, type OrderDraft } from "./OrderForm";

type OrderRow = Order & { _draft?: boolean };

export function OrdersTable() {
  const [tab, setTab] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);

  const addDraft = (dr: OrderDraft) => {
    setDrafts((p) => [dr, ...p]);
    setShowForm(false);
  };

  const allRows = useMemo<OrderRow[]>(() => {
    const draftRows: OrderRow[] = drafts.map((dr) => {
      const line = dr.lines[0];
      const d = DESIGNS.find((x) => x.name === line.design);
      const party = PARTIES.find((p) => p.name === dr.customer);
      const orderQty = dr.lines.reduce((s, l) => s + (parseInt(l.ordered_qty_boxes, 10) || 0), 0);
      return {
        id: dr._id.slice(0, 6).toUpperCase(),
        poNumber: dr.po_number,
        partyCode: party?.code ?? "",
        party: dr.customer,
        country: party?.country ?? "",
        flag: party?.flag ?? "",
        design: line.design,
        size: d?.size ?? "",
        finish: d?.finish ?? "",
        brand: d?.brand ?? "",
        orderQty,
        producedQty: 0,
        palletizedQty: 0,
        loadedQty: 0,
        boxesPerPallet: 0,
        totalBoxes: orderQty,
        pallets: 0,
        stage: STAGES[0].id,
        orderDate: dr.order_date || "",
        dueDate: dr.order_date || "—",
        invoice: null,
        priority: "normal",
        daysFromPI: 0,
        _draft: true,
      };
    });
    return [...draftRows, ...ORDERS];
  }, [drafts]);

  const filtered = useMemo(() => {
    if (tab === "all") return allRows;
    return allRows.filter((o) => o.stage === tab);
  }, [tab, allRows]);

  return (
    <div>
      {showForm && <OrderForm onSave={addDraft} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">All Orders</div>
          <div className="sub">
            {filtered.length} of {allRows.length} orders · grouped by stage
            {drafts.length > 0 && (
              <>
                {" · "}
                <span className="dim">{drafts.length} unsaved draft{drafts.length > 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            Export CSV
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          All{" "}
          <span className="muted mono" style={{ marginLeft: 4 }}>
            {ORDERS.length}
          </span>
        </div>
        {STAGES.map((s) => (
          <div key={s.id} className={`tab ${tab === s.id ? "active" : ""}`} onClick={() => setTab(s.id)}>
            {s.label}{" "}
            <span className="muted mono" style={{ marginLeft: 4 }}>
              {ORDERS.filter((o) => o.stage === s.id).length}
            </span>
          </div>
        ))}
      </div>

      <div className="fbar">
        <button className="btn">
          <Icon name="filter" size={12} />
          Filters · 0
        </button>
        <button className="btn">Group: Stage</button>
        <button className="btn">Sort: Due date</button>
        <button className="btn">Color</button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Find any order, design, party…" />
        <button className="btn">Save view</button>
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>ID</th>
                <th>PO Number</th>
                <th>Party</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Order Qty
                </th>
                <th>Progress</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Remaining
                </th>
                <th>Stage</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const remaining = o.orderQty - o.loadedQty;
                return (
                  <tr key={o.id}>
                    <td className="muted mono" style={{ textAlign: "center" }}>
                      {i + 1}
                    </td>
                    <td className="mono muted">{o.id}</td>
                    <td className="mono" style={{ color: "var(--fg)" }}>
                      {o.poNumber}
                      {o._draft && (
                        <span className="chip" style={{ marginLeft: 6, background: "var(--accent-soft)", color: "var(--accent)" }}>
                          draft
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ marginRight: 6 }}>{o.flag}</span>
                      {o.party}
                    </td>
                    <td>
                      <span className="design-name">{o.design}</span>
                    </td>
                    <td>
                      <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                    </td>
                    <td>
                      <span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span>
                    </td>
                    <td>
                      <span className={`chip brand ${o.brand === "BIG" ? "big" : ""}`}>{o.brand}</span>
                    </td>
                    <td className="num">{fmt(o.orderQty)}</td>
                    <td style={{ width: 140 }}>
                      <SplitBar produced={o.producedQty} palletized={o.palletizedQty} loaded={o.loadedQty} total={o.orderQty} />
                    </td>
                    <td className="num">{fmt(remaining)}</td>
                    <td>
                      <StageBadge stage={o.stage} />
                    </td>
                    <td className="mono muted">{o.dueDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
