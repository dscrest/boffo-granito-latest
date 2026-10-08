/* ============================================================
   Sample Orders (Panel Craft, CR-315) — the register of customer sample
   requests, one row per SampleOrder (SMP/FY/NNN). Sheet view only (grid
   standard: ColumnDefs show/hide + reorder, footer pager, newest first,
   whole row opens /sample-orders/:id where supply is recorded).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ErrorCard, SkeletonRows, EmptyState } from "@/ui/States";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { FilterSelect, IconBtn, SAMPLE_STATUS_TONE } from "./pcBits";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedSampleOrders, listSampleOrders, SAMPLE_STATUS_LABEL, SAMPLE_STATUSES, type SampleOrderRow } from "./sampleOrdersApi";

const itemNames = (o: SampleOrderRow) => o.lines.map((l) => l.designName).join(", ");
const detailUrl = (id: string) => `/sample-orders/${encodeURIComponent(id)}`;
const stop = (e: React.MouseEvent) => e.stopPropagation();

/** Source sale link — SO or Quote number; "—" for a direct order. */
function SourceLink({ o }: { o: SampleOrderRow }) {
  if (o.salesOrderId)
    return <Link className="linkish mono" to={`/orders/${encodeURIComponent(o.salesOrderId)}`} onClick={stop} title="Open Sales Order">{o.salesOrderNo || "SO"}</Link>;
  if (o.quoteId)
    return <Link className="linkish mono" to={`/quotes/${encodeURIComponent(o.quoteId)}`} onClick={stop} title="Open Quote">{o.quoteNo || "Quote"}</Link>;
  return <span className="dim">—</span>;
}

/* Data-driven columns (grid standard). Created/Modified default-hidden. */
const SAMPLE_ORDER_COLUMNS: ColumnDef<SampleOrderRow>[] = [
  { key: "number", label: "Order No", className: "mono", render: (o) => o.orderNumber || "—" },
  { key: "customer", label: "Customer", render: (o) => o.customerName },
  {
    key: "items",
    label: "Items",
    render: (o) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 360 }}>
        <ImageThumb images={o.lines[0]?.images ?? []} alt={o.orderNumber} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={itemNames(o)}>
          {itemNames(o) || "—"}
        </span>
      </span>
    ),
  },
  { key: "requested", label: "Requested", className: "num mono", style: { textAlign: "right" }, render: (o) => fmt(o.totalQty) },
  { key: "supplied", label: "Supplied", className: "num mono", style: { textAlign: "right" }, render: (o) => fmt(o.suppliedQty) },
  { key: "date", label: "Order Date", className: "mono muted", render: (o) => o.orderDate || "—" },
  { key: "sales", label: "Sales Person", render: (o) => o.salesperson || "—" },
  {
    key: "status",
    label: "Status",
    render: (o) => <Chip tone={SAMPLE_STATUS_TONE[o.status]} label={codeOf(SAMPLE_STATUS_LABEL[o.status])} title={SAMPLE_STATUS_LABEL[o.status]} />,
  },
  { key: "source", label: "Source", render: (o) => <SourceLink o={o} /> },
  { key: "created", label: "Created", className: "mono muted nw", render: (o) => fmtDateTime(o.createdTime) },
  { key: "modified", label: "Modified", className: "mono muted nw", render: (o) => fmtDateTime(o.modifiedTime) },
];

export function SampleOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SampleOrderRow[]>(() => cachedSampleOrders() ?? []);
  const [loading, setLoading] = useState(() => cachedSampleOrders() == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("sampleOrders.query", "");
  const [statusFilter, setStatusFilter] = useState("");
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("sampleOrdersColumns", SAMPLE_ORDER_COLUMNS, ["created", "modified"]);

  const load = async () => {
    const o = await listSampleOrders();
    setLoading(false);
    if (!o.ok) {
      setError(o.error || "Failed to load sample orders");
      return;
    }
    setError(null);
    setOrders(o.orders);
  };
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (!statusFilter || SAMPLE_STATUS_LABEL[o.status] === statusFilter) &&
        (!q ||
          o.orderNumber.toLowerCase().includes(q) ||
          itemNames(o).toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.salesOrderNo.toLowerCase().includes(q) ||
          o.quoteNo.toLowerCase().includes(q)),
    );
  }, [orders, query, statusFilter]);

  const sort = useSortRows(
    shown,
    (o, k) =>
      k === "requested" ? o.totalQty
      : k === "supplied" ? o.suppliedQty
      : k === "items" ? o.lines.length
      : k === "customer" ? o.customerName
      : k === "date" ? o.orderDate
      : k === "sales" ? o.salesperson
      : k === "status" ? SAMPLE_STATUSES.indexOf(o.status)
      : k === "source" ? o.salesOrderNo || o.quoteNo
      : k === "created" ? o.createdTime
      : k === "modified" ? o.modifiedTime
      : o.orderNumber,
    "created",
    -1, // newest first
  );
  const pager = usePagination(sort.sorted.length, "sampleOrdersPageSize", `${query}|${statusFilter}`);
  const pageRows = pager.slice(sort.sorted);

  /** Whole row opens the order — supply is recorded there. */
  const openProps = (id: string) => ({
    tabIndex: 0,
    style: { cursor: "pointer" as const },
    onClick: () => navigate(detailUrl(id)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.target === e.currentTarget) navigate(detailUrl(id));
    },
  });

  return (
    <div>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={SAMPLE_STATUSES.map((s) => SAMPLE_STATUS_LABEL[s])} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search order, item, customer or source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        {can("panel_craft", "create") && (
          <button className="hbtn primary" onClick={() => navigate("/sample-orders/new")}>
            <Icon name="plus" size={13} />
            New Sample Order
          </button>
        )}
      </div>

      {loading && orders.length === 0 ? (
        <div className="card"><SkeletonRows rows={6} /></div>
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} className={c.className} style={c.style} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((o) => (
                  <tr key={o.id} {...openProps(o.id)} title="Open sample order">
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(o)}
                      </td>
                    ))}
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      {orders.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState title="No sample orders yet" hint="Record the first one with New Sample Order" />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <GridFooter {...pager} />
        </div>
      )}
    </div>
  );
}
