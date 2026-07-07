/* Purchase Orders — ported verbatim from prototype/views2.jsx. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ProgressBar, StageBadge } from "@/ui/primitives";
import { fmt, fmtDateTime, pct } from "@/lib/format";
import { type Order } from "@/data";
import { useOrders } from "@/features/orders/useOrders";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";

/** One row per PO — orders grouped by poNumber. */
interface PORow {
  po: string;
  items: Order[];
  party: Order["party"];
  flag: Order["flag"];
  country: Order["country"];
  totalQty: number;
  skus: number;
  date: Order["orderDate"];
  dueDate: Order["dueDate"];
  daysFromPI: Order["daysFromPI"];
  stage: Order["stage"];
  progress: number;
  createdTime?: string;
  modifiedTime?: string;
}

// #21b: toggleable + reorderable columns (# and PO Number pinned outside the map).
const PO_COLUMNS: ColumnDef<PORow>[] = [
  {
    key: "party",
    label: "Party",
    render: (p) => (
      <>
        {p.flag} {p.party}{" "}
        <span className="muted" style={{ fontSize: 10.5 }}>
          ({p.country})
        </span>
      </>
    ),
  },
  { key: "date", label: "Date", className: "mono muted", render: (p) => p.date },
  { key: "daysFromPI", label: "Days from PI", className: "num", style: { textAlign: "right" }, render: (p) => p.daysFromPI },
  { key: "orderQty", label: "Order Qty", className: "num", style: { textAlign: "right" }, render: (p) => fmt(p.totalQty) },
  { key: "skus", label: "SKUs", className: "num", style: { textAlign: "right" }, render: (p) => p.skus },
  {
    key: "progress",
    label: "Progress",
    style: { width: 160 },
    render: (p) => (
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
    ),
  },
  { key: "stage", label: "Stage", render: (p) => <StageBadge stage={p.stage} /> },
  {
    key: "docs",
    label: "Docs",
    render: (p) => (
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
    ),
  },
  { key: "due", label: "Due", className: "mono muted", render: (p) => p.dueDate },
  { key: "created", label: "Created", className: "muted mono", render: (p) => fmtDateTime(p.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (p) => fmtDateTime(p.modifiedTime) },
];

export function PurchaseOrders() {
  const navigate = useNavigate();
  const { orders, loading, error, reload } = useOrders();
  const { ordered, visible, hidden, toggle, move } = useColumns("poTableColumns", PO_COLUMNS, ["created", "modified"]);
  const [query, setQuery] = useState("");
  // Group + sort only when the live orders snapshot changes.
  const pos = useMemo<PORow[]>(() => {
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
        createdTime: items[0].createdTime,
        modifiedTime: items[0].modifiedTime,
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
          <div className="sub">{fmt(pos.reduce((s, p) => s + p.totalQty, 0))} boxes total</div>
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
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
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
              {visible.map((c) => (
                <th key={c.key} style={c.style}>{c.label}</th>
              ))}
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
                {visible.map((c) => (
                  <td key={c.key} className={c.className} style={c.style}>
                    {c.render!(p)}
                  </td>
                ))}
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
