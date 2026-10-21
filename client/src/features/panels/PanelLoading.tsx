/* ============================================================
   CR-348: Panel Craft ▸ Loading — every Panel / Sample order with something
   still pending to load, one row per order (Pending per material, derived
   Loading Status). The house "+" MoreMenu on each row (Load…, Open order)
   and a selection bar: tick several orders → ONE Record Load modal → one
   vehicle trip (one LD number) across them. Grid standard: ColumnDefs,
   footer pager, newest first, whole row opens the detail.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Chip } from "@/ui/Chip";
import { Note, ErrorCard, SkeletonRows, EmptyState } from "@/ui/States";
import { codeOf } from "@/ui/statusCode";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { MoreMenu } from "@/features/common/DetailBits";
import { FilterSelect, IconBtn, LOADING_TONE, ORDER_STATUS_TONE, SAMPLE_STATUS_TONE } from "./pcBits";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedCutStock, cachedPanelOrders, listCutStock, listPanelOrders, LOADING_STATUSES, PANEL_ORDER_STATUS_LABEL, pendingText, type LoadingStatus } from "./panelOrdersApi";
import { cachedSampleOrders, listSampleOrders, SAMPLE_STATUS_LABEL } from "./sampleOrdersApi";
import { isOpen, lineCodeList, lineCodes, loadStatusOf, progressOf, RecordLoadModal, type LoadableOrder } from "./PanelLoads";
import { DesignNames } from "@/ui/DesignNames";

type Row = LoadableOrder & { pending: string; loadStatus: LoadingStatus; key: string };

const detailUrl = (o: LoadableOrder) => `/${o.type === "Panel" ? "panel-orders" : "sample-orders"}/${encodeURIComponent(o.id)}`;
const statusLabel = (o: LoadableOrder) => (o.type === "Panel" ? PANEL_ORDER_STATUS_LABEL[o.status] : SAMPLE_STATUS_LABEL[o.status]);
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function PanelLoading() {
  const navigate = useNavigate();
  const [panelOrders, setPanelOrders] = useState(() => cachedPanelOrders() ?? []);
  const [sampleOrders, setSampleOrders] = useState(() => cachedSampleOrders() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [loading, setLoading] = useState(() => cachedPanelOrders() == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("panelLoading.query", "");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingFor, setLoadingFor] = useState<LoadableOrder[] | null>(null);
  const canEdit = can("panel_craft", "edit");

  const load = async () => {
    const [p, s, pn, st] = await Promise.all([listPanelOrders(), listSampleOrders(), listPanels(), listCutStock()]);
    setLoading(false);
    if (!p.ok || !s.ok) {
      setError(p.error || s.error || "Failed to load orders");
      return;
    }
    setError(null);
    setPanelOrders(p.orders);
    setSampleOrders(s.orders);
    if (pn.ok) setPanels(pn.panels);
    if (st.ok) setStock(st.stock);
    setSelected(new Set());
  };
  useEffect(() => {
    void load();
  }, []);

  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);

  const rows = useMemo((): Row[] => {
    const all: LoadableOrder[] = [...panelOrders.map((o) => ({ ...o, type: "Panel" as const })), ...sampleOrders.map((o) => ({ ...o, type: "Sample" as const }))];
    const q = query.trim().toLowerCase();
    return all
      .filter(isOpen)
      .map((o) => ({ ...o, pending: pendingText(progressOf(o)), loadStatus: loadStatusOf(o), key: `${o.type}|${o.id}` }))
      .filter((o) => o.pending)
      .filter((o) => !typeFilter || o.type === typeFilter)
      .filter((o) => !q || o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || o.salesOrderNo.toLowerCase().includes(q) || o.quoteNo.toLowerCase().includes(q));
  }, [panelOrders, sampleOrders, query, typeFilter]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const COLUMNS: ColumnDef<Row>[] = [
    {
      key: "pick",
      label: "",
      render: (o) => (
        <input type="checkbox" checked={selected.has(o.key)} onChange={() => toggle(o.key)} onClick={stop} aria-label={`Select ${o.orderNumber}`} disabled={!canEdit} />
      ),
    },
    { key: "customer", label: "Customer", render: (o) => o.customerName },
    { key: "design", label: "Design", className: "nw", render: (o) => <DesignNames names={lineCodeList(o)} /> },
    { key: "type", label: "Type", render: (o) => <Chip tone={o.type === "Panel" ? "blue" : "violet"} label={o.type} /> },
    { key: "date", label: "Order Date", className: "mono muted", render: (o) => o.orderDate || "—" },
    {
      key: "status",
      label: "Status",
      render: (o) => <Chip tone={o.type === "Panel" ? ORDER_STATUS_TONE[o.status] : SAMPLE_STATUS_TONE[o.status]} label={codeOf(statusLabel(o))} title={statusLabel(o)} />,
    },
    { key: "pending", label: "Pending", render: (o) => <span style={{ color: "var(--c-amber)", fontWeight: 600, whiteSpace: "nowrap" }}>{o.pending}</span> },
    { key: "loading", label: "Loading Status", render: (o) => <Chip tone={LOADING_TONE[o.loadStatus]} label={o.loadStatus} /> },
    {
      key: "actions",
      label: "",
      render: (o) => (
        <span onClick={stop} onKeyDown={stop}>
          <MoreMenu
            kebab
            icon="plus"
            title="Loading actions"
            items={[
              { label: "Load…", disabled: !canEdit, title: canEdit ? "Record a vehicle load for this order" : "No permission", onClick: () => setLoadingFor([o]) },
              { label: "Open order", onClick: () => navigate(detailUrl(o)) },
            ]}
          />
        </span>
      ),
    },
    // CR-355: the PNL/SMP number rides last and hidden — Customer → Design is how the team matches rows.
    { key: "number", label: "Order No", className: "mono", render: (o) => o.orderNumber || "—" },
  ];
  const { ordered, visible, hidden, toggle: toggleCol, move, customised } = useColumns("panelLoadingColumns.v2", COLUMNS, ["number"]); // .v2 (CR-355)

  const sort = useSortRows(
    rows,
    (o, k) =>
      k === "type" ? o.type
      : k === "customer" ? o.customerName
      : k === "design" ? lineCodes(o)
      : k === "date" ? o.orderDate
      : k === "status" ? statusLabel(o)
      : k === "pending" ? o.pending
      : k === "loading" ? LOADING_STATUSES.indexOf(o.loadStatus)
      : o.orderNumber,
    "date",
    -1,
  );
  const pager = usePagination(sort.sorted.length, "panelLoadingPageSize", `${query}|${typeFilter}`);
  const pageRows = pager.slice(sort.sorted);
  const selectedRows = rows.filter((o) => selected.has(o.key));

  const openProps = (o: Row) => ({
    tabIndex: 0,
    style: { cursor: "pointer" as const },
    onClick: () => navigate(detailUrl(o)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.target === e.currentTarget) navigate(detailUrl(o));
    },
  });

  return (
    <div>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}
      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={["Panel", "Sample"]} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search order, customer or source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggleCol} onMove={move} active={customised} />
      </div>

      {loading && rows.length === 0 ? (
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
                  <tr key={o.key} {...openProps(o)} title="Open order">
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(o)}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      {query || typeFilter ? <EmptyState title="No matching results" hint="Try a different filter" /> : <Note tone="ok">Nothing pending to load — every open order has left.</Note>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Selection bar (the DispatchBoard pattern): tick orders → one trip. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--border)", background: selected.size ? "var(--accent-soft)" : "var(--panel-2)" }}>
            <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{selected.size ? `${selected.size} selected` : `${rows.length} order${rows.length === 1 ? "" : "s"} pending`}</span>
            <span style={{ flex: 1 }} />
            {selected.size > 0 && (
              <>
                <button type="button" className="btn" style={{ height: 26 }} onClick={() => setSelected(new Set())}>Clear</button>
                <button type="button" className="hbtn primary" style={{ height: 26, padding: "0 12px" }} disabled={!canEdit} onClick={() => setLoadingFor(selectedRows)} title="One vehicle trip across the selected orders">
                  <Icon name="truck" size={13} /> Load selected
                </button>
              </>
            )}
          </div>
          <GridFooter {...pager} />
        </div>
      )}

      {loadingFor && <RecordLoadModal orders={loadingFor} panelsById={panelById} stock={stock} onDone={() => void load()} onClose={() => setLoadingFor(null)} />}
    </div>
  );
}
