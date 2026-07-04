/* Purchase Orders — ported verbatim from prototype/views2.jsx. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ProgressBar, StageBadge } from "@/ui/primitives";
import { fmt, pct } from "@/lib/format";
import { type Order } from "@/data";
import { useOrders } from "@/features/orders/useOrders";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useHiddenColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";

// #21b: toggleable columns for the Order-by-PO table (PO Number always shown).
const PO_COLUMNS: ColumnDef[] = [
  { key: "party", label: "Party" },
  { key: "date", label: "Date" },
  { key: "daysFromPI", label: "Days from PI" },
  { key: "orderQty", label: "Order Qty" },
  { key: "skus", label: "SKUs" },
  { key: "progress", label: "Progress" },
  { key: "stage", label: "Stage" },
  { key: "docs", label: "Docs" },
  { key: "due", label: "Due" },
];

export function PurchaseOrders() {
  const navigate = useNavigate();
  const { orders, loading, error, reload } = useOrders();
  const { hidden, toggle, show } = useHiddenColumns("poTableColumns");
  const [query, setQuery] = useState("");
  // Group + sort only when the live orders snapshot changes.
  const pos = useMemo(() => {
    const groups: Record<string, Order[]> = {};
    orders.forEach((o) => (groups[o.poNumber] ||= []).push(o));
    return Object.entries(groups)
      .map(([po, items]) => ({
        po,
        items,
        party: items[0].party,
        flag: items[0].flag,
        country: items[0].country,
        totalQty: items.reduce((s, o) => s + o.orderQty, 0),
        skus: items.length,
        date: items[0].orderDate,
        dueDate: items[0].dueDate,
        daysFromPI: items[0].daysFromPI,
        stage: items[0].stage,
        progress: pct(
          items.reduce((s, o) => s + o.producedQty, 0),
          items.reduce((s, o) => s + o.orderQty, 0),
        ),
      }))
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter((p) => `${p.po} ${p.party}`.toLowerCase().includes(q));
  }, [pos, query]);
  const pager = usePagination(filtered.length, "poPageSize", query);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Purchase Orders</div>
          <div className="sub">{fmt(pos.reduce((s, p) => s + p.totalQty, 0))} sqm total</div>
        </div>
      </div>

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search PO number, party…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ColumnPicker columns={PO_COLUMNS} hidden={hidden} onToggle={toggle} />
      </div>

      {loading && orders.length === 0 ? (
        <SkeletonRows />
      ) : error && orders.length === 0 ? (
        <ErrorCard message={error} onRetry={reload} />
      ) : (
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>#</th>
              <th>PO Number</th>
              {show("party") && <th>Party</th>}
              {show("date") && <th>Date</th>}
              {show("daysFromPI") && <th className="num" style={{ textAlign: "right" }}>Days from PI</th>}
              {show("orderQty") && <th className="num" style={{ textAlign: "right" }}>Order Qty</th>}
              {show("skus") && <th className="num" style={{ textAlign: "right" }}>SKUs</th>}
              {show("progress") && <th>Progress</th>}
              {show("stage") && <th>Stage</th>}
              {show("docs") && <th>Docs</th>}
              {show("due") && <th>Due</th>}
            </tr>
          </thead>
          <tbody>
            {pager.slice(filtered).map((p, i) => (
              <tr key={p.po + i}>
                <td className="muted mono" style={{ textAlign: "center" }}>
                  {pager.from + i}
                </td>
                <td className="mono">
                  <button
                    className="linkish"
                    style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                    onClick={() => navigate(`/po/${encodeURIComponent(p.po)}`)}
                    title="Open details"
                  >
                    {p.po}
                  </button>
                </td>
                {show("party") && (
                  <td>
                    {p.flag} {p.party}{" "}
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      ({p.country})
                    </span>
                  </td>
                )}
                {show("date") && <td className="mono muted">{p.date}</td>}
                {show("daysFromPI") && <td className="num">{p.daysFromPI}</td>}
                {show("orderQty") && <td className="num">{fmt(p.totalQty)}</td>}
                {show("skus") && <td className="num">{p.skus}</td>}
                {show("progress") && (
                  <td style={{ width: 160 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <ProgressBar
                        value={p.progress}
                        max={100}
                        color={p.progress > 75 ? "var(--c-green)" : p.progress > 30 ? "var(--c-amber)" : "var(--c-blue)"}
                        height={5}
                      />
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)", minWidth: 32 }}>
                        {p.progress}%
                      </span>
                    </div>
                  </td>
                )}
                {show("stage") && (
                  <td>
                    <StageBadge stage={p.stage} />
                  </td>
                )}
                {show("docs") && (
                <td>
                  <span className="row" style={{ gap: 4 }}>
                    <span title="PI" className="pill" style={{ height: 16, padding: "0 4px", fontSize: 10 }}>
                      PI
                    </span>
                    <span title="PO" className="pill" style={{ height: 16, padding: "0 4px", fontSize: 10 }}>
                      PO
                    </span>
                    {p.stage === "final" && (
                      <span
                        title="Invoice"
                        className="pill"
                        style={{ height: 16, padding: "0 4px", fontSize: 10, color: "var(--c-green)", borderColor: "oklch(0.78 0.16 145 / 0.4)" }}
                      >
                        INV
                      </span>
                    )}
                  </span>
                </td>
                )}
                {show("due") && <td className="mono muted">{p.dueDate}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <GridFooter {...pager} />
      </div>
      )}
    </div>
  );
}
