/* ============================================================
   Orders (Panel Craft, CR-345) — ONE register for both order types:
   Panel orders (PNL, the cutting-job board: New → Received → In Cutting →
   Ready → Dispatched) and Sample orders (SMP, New → Partially Supplied →
   Supplied, derived). A Type column + filter tells them apart; the row
   opens the right detail (/panel-orders/:id · /sample-orders/:id).
   Panel rows carry the stock signal (CR-288/295/312: what must still be
   cut after booked + free, now on the PENDING need — CR-347), the four
   production checkpoints + Readiness (CR-313/323) and, for both types,
   the derived Loading Status + what is still pending to load (CR-347).
   Kanban = Panel rows only (samples have no stage machine). CR-287: no
   stage buttons here. New Order asks the type first (OrderFormPage).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useModalA11y } from "@/ui/useModalA11y";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ErrorCard, SkeletonRows, EmptyState } from "@/ui/States";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState, useViewState } from "@/lib/usePersistedState";
import { checkpointTone, FilterSelect, IconBtn, LOADING_TONE, ORDER_STATUS_TONE, READINESS_TONE, SAMPLE_STATUS_TONE } from "./pcBits";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedPanels, listPanels, mdfLabel, type PanelRow } from "./panelsApi";
import { cachedMdfs, listMdfs } from "./mdfApi";
import { lineCodeList, lineCodes, loadStatusOf, progressOf, type LoadableOrder } from "./PanelLoads";
import { DesignNames } from "@/ui/DesignNames";
import {
  allocatedByKey,
  cachedCutStock,
  cachedPanelOrders,
  CHECKPOINT_LABEL,
  checkpointStatus,
  listCutStock,
  listPanelOrders,
  LOADING_STATUSES,
  PANEL_ORDER_STATUS_LABEL,
  PANEL_ORDER_STATUSES,
  pendingNeedLines,
  pendingText,
  readiness,
  requirementsFor,
  shortageText,
  type CheckpointKey,
  type LoadingStatus,
  type PanelOrderRow,
  type PanelOrderStatus,
  type Readiness,
  type Shortage,
} from "./panelOrdersApi";
import { cachedSampleOrders, listSampleOrders, SAMPLE_STATUS_LABEL, SAMPLE_STATUSES } from "./sampleOrdersApi";

const READINESS_ORDER: Readiness[] = ["—", "Pending", "In Progress", "Ready for Production"];

/* Stage dots match the status-chip tones (pcBits ORDER_STATUS_TONE). */
const STAGE_COLOR: Record<PanelOrderStatus, string> = {
  NewRequest: "var(--muted)",
  Received: "var(--warn)",
  InCutting: "var(--blue)",
  Ready: "#0d9488",
  Dispatched: "var(--ok)",
};

/** A grid row = the order + its derived bits. Panel rows add the first panel's thumb, every
    line's panel (CR-318 card list), the pieces still lacking (CR-312) and readiness. */
type Row = LoadableOrder & {
  panel?: PanelRow;
  linePanels: (PanelRow | undefined)[];
  shortages: Shortage[];
  readiness: Readiness;
  loadStatus: LoadingStatus;
  pending: string;
  key: string;
};

const statusLabel = (o: LoadableOrder) => (o.type === "Panel" ? PANEL_ORDER_STATUS_LABEL[o.status] : SAMPLE_STATUS_LABEL[o.status]);
const statusTone = (o: LoadableOrder) => (o.type === "Panel" ? ORDER_STATUS_TONE[o.status] : SAMPLE_STATUS_TONE[o.status]);
const statusIndex = (o: LoadableOrder) => (o.type === "Panel" ? PANEL_ORDER_STATUSES.indexOf(o.status) : 10 + SAMPLE_STATUSES.indexOf(o.status));
const detailUrl = (o: LoadableOrder) => `/${o.type === "Panel" ? "panel-orders" : "sample-orders"}/${encodeURIComponent(o.id)}`;
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const STATUS_OPTIONS = [...new Set([...PANEL_ORDER_STATUSES.map((s) => PANEL_ORDER_STATUS_LABEL[s]), ...SAMPLE_STATUSES.map((s) => SAMPLE_STATUS_LABEL[s])])];

/** CR-318: the Panels cell = a count chip; clicking it opens the order's panels as cards (thumb · code · designs · qty · MDF). */
function PanelCount({ o }: { o: Row & { type: "Panel" } }) {
  const [open, setOpen] = useState(false);
  const n = o.lines.length;
  if (n === 0) return <span className="dim">—</span>;
  const panels = o.lines.filter((l) => l.panelId).length;
  const cuts = n - panels;
  return (
    <span onClick={stop} onKeyDown={stop}>
      <button type="button" className="chip" style={{ cursor: "pointer" }} onClick={() => setOpen(true)} title="Show panels">
        {panels > 0 && `${panels} panel${panels === 1 ? "" : "s"}`}
        {panels > 0 && cuts > 0 && " · "}
        {cuts > 0 && `${cuts} cut piece${cuts === 1 ? "" : "s"}`}
      </button>
      {open && <PanelCardsModal o={o} onClose={() => setOpen(false)} />}
    </span>
  );
}

function PanelCardsModal({ o, onClose }: { o: Row & { type: "Panel" }; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={stop}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">Panels · {o.orderNumber || "Panel Order"}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>
        <div className="df-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {o.lines.map((l, i) => {
            const p = o.linePanels[i];
            const designs = l.panelId ? p?.lines.map((x) => x.designName).join(", ") || "—" : [l.designName, l.cutSizeName].filter(Boolean).join(" · ");
            return (
              <div key={l.id} className="pc-job-card" style={{ display: "flex", gap: 10 }}>
                <ImageThumb images={p?.images ?? []} size={44} alt={l.panelCode} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {l.panelId ? (
                      <Link className="linkish mono" to={`/panels/${encodeURIComponent(l.panelId)}`} title="Open panel" style={{ fontWeight: 600 }}>{l.panelCode}</Link>
                    ) : (
                      <span className="mono" style={{ fontWeight: 600 }}>Cut piece</span>
                    )}
                    <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{fmt(l.qty)} pcs</span>
                  </div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={designs}>{designs}</div>
                  {l.mdfId && <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>MDF · {mdfLabel(cachedMdfs().find((m) => m.id === l.mdfId)) || "—"}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** CR-313: one checkpoint's status chip; dispatched orders and sample orders read "—". */
function CpChip({ o, k }: { o: Row; k: CheckpointKey }) {
  if (o.type !== "Panel" || o.status === "Dispatched") return <span className="dim">—</span>;
  const st = checkpointStatus(o.checkpoints, k);
  return <Chip tone={checkpointTone(st)} label={st} title={`${CHECKPOINT_LABEL[k]}: ${st}${o.checkpoints[k] ? ` · ${o.checkpoints[k]!.by}` : ""}`} />;
}

/** Source sale link (CR-286) — SO or Quote number; "—" for a direct order. */
function SourceLink({ o }: { o: LoadableOrder }) {
  if (o.salesOrderId)
    return <Link className="linkish mono" to={`/orders/${encodeURIComponent(o.salesOrderId)}`} onClick={stop} title="Open Sales Order">{o.salesOrderNo || "SO"}</Link>;
  if (o.quoteId)
    return <Link className="linkish mono" to={`/quotes/${encodeURIComponent(o.quoteId)}`} onClick={stop} title="Open Quote">{o.quoteNo || "Quote"}</Link>;
  return <span className="dim">—</span>;
}

/* Data-driven columns (grid standard). Customer → Design lead; the PNL/SMP number sits LAST, default-hidden (CR-355). */
const ORDER_COLUMNS: ColumnDef<Row>[] = [
  { key: "customer", label: "Customer", render: (o) => o.customerName },
  { key: "design", label: "Design", className: "nw", render: (o) => <DesignNames names={lineCodeList(o)} /> },
  { key: "type", label: "Type", render: (o) => <Chip tone={o.type === "Panel" ? "blue" : "violet"} label={o.type} title={o.type === "Panel" ? "Panel order" : "Sample order"} /> },
  {
    key: "items",
    label: "Items",
    render: (o) =>
      o.type === "Panel" ? (
        <PanelCount o={o} />
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 360 }}>
          <ImageThumb images={o.lines[0]?.images ?? []} alt={o.orderNumber} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lineCodes(o)}>{lineCodes(o) || "—"}</span>
        </span>
      ),
  },
  {
    key: "qty",
    label: "Qty",
    className: "num mono",
    style: { textAlign: "right" },
    render: (o) => (o.type === "Panel" ? fmt(o.totalQty) : <span title="supplied / requested">{fmt(o.suppliedQty)} / {fmt(o.totalQty)}</span>),
  },
  { key: "date", label: "Order Date", className: "mono muted", render: (o) => o.orderDate || "—" },
  { key: "sales", label: "Sales Person", render: (o) => o.salesperson || "—" },
  { key: "status", label: "Status", render: (o) => <Chip tone={statusTone(o)} label={codeOf(statusLabel(o))} title={statusLabel(o)} /> },
  // CR-347: the derived loading state + what is still pending — separate from the lifecycle (SO roll-up rule).
  { key: "loading", label: "Loading Status", render: (o) => <Chip tone={LOADING_TONE[o.loadStatus]} label={o.loadStatus} title={o.pending ? `Pending: ${o.pending}` : "Everything loaded"} /> },
  { key: "pending", label: "Pending", render: (o) => (o.pending ? <span style={{ color: "var(--c-amber)", fontWeight: 600, whiteSpace: "nowrap" }}>{o.pending}</span> : <span className="dim">—</span>) },
  // CR-313: the production checkpoints (four since CR-323) + the derived overall readiness.
  { key: "mdf", label: "MDF", render: (o) => <CpChip o={o} k="mdf" /> },
  { key: "vinyl", label: "Vinyl Printing", render: (o) => <CpChip o={o} k="vinyl" /> },
  { key: "cutPieces", label: "Cut Pieces", render: (o) => <CpChip o={o} k="cut" /> },
  { key: "pasted", label: "Vinyl Pasted", render: (o) => <CpChip o={o} k="pasted" /> },
  {
    key: "readiness",
    label: "Readiness",
    render: (o) => (o.readiness === "—" ? <span className="dim">—</span> : <Chip tone={READINESS_TONE[o.readiness]} label={o.readiness} title="MDF · Vinyl Printing · Cut Pieces · Vinyl Pasted on MDF all Ready → Ready for Production" />),
  },
  {
    // CR-288 (5.1): the missing-items hint — "Unavailable · n" (CR-295 wording) with the pieces in the tooltip.
    // CR-312: a row is short only when need exceeds booked + free (pieces that must still be cut).
    key: "stock",
    label: "Stock",
    render: (o) =>
      o.type !== "Panel" || o.status === "Dispatched" ? <span className="dim">—</span>
      : o.shortages.length ? <span style={{ color: "var(--c-amber)", fontWeight: 600, whiteSpace: "nowrap" }} title={shortageText(o.shortages)}>Unavailable · {o.shortages.length}</span>
      : <span style={{ color: "var(--c-green)" }} title="Cut-piece stock available for this order">Available</span>,
  },
  { key: "source", label: "Source", render: (o) => <SourceLink o={o} /> },
  { key: "created", label: "Created", className: "mono muted nw", render: (o) => fmtDateTime(o.createdTime) },
  { key: "modified", label: "Modified", className: "mono muted nw", render: (o) => fmtDateTime(o.modifiedTime) },
  { key: "number", label: "Order No", className: "mono", render: (o) => o.orderNumber || "—" },
];

export function Orders() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Opens on whatever Settings → Default view says.
  const [view, setView] = useViewState("panelOrders.view", "sheet" as const, "kanban" as const);
  const [panelOrders, setPanelOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [sampleOrders, setSampleOrders] = useState(() => cachedSampleOrders() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [loading, setLoading] = useState(() => cachedPanelOrders() == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("panelOrders.query", "");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState(() => (params.get("type") === "Sample" ? "Sample" : params.get("type") === "Panel" ? "Panel" : ""));
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("ordersColumns.v2", ORDER_COLUMNS, ["created", "modified", "number"]) // .v2 (CR-355);

  const load = async () => {
    const [o, so, p, s] = await Promise.all([listPanelOrders(), listSampleOrders(), listPanels(), listCutStock(), listMdfs()]); // CR-344: MDF labels from the size-keyed master (cache)
    setLoading(false);
    if (!o.ok) {
      setError(o.error || "Failed to load panel orders");
      return;
    }
    setError(null);
    setPanelOrders(o.orders);
    if (so.ok) setSampleOrders(so.orders);
    if (p.ok) setPanels(p.panels);
    if (s.ok) setStock(s.stock);
  };

  useEffect(() => {
    void load();
  }, []);

  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const booked = useMemo(() => allocatedByKey(panelOrders), [panelOrders]); // CR-312

  // Search + filters apply to both views; every row carries its derived bits once.
  const shown = useMemo((): Row[] => {
    const q = query.trim().toLowerCase();
    const all: LoadableOrder[] = [...panelOrders.map((o) => ({ ...o, type: "Panel" as const })), ...sampleOrders.map((o) => ({ ...o, type: "Sample" as const }))];
    return all
      .filter(
        (o) =>
          (!typeFilter || o.type === typeFilter) &&
          (!statusFilter || statusLabel(o) === statusFilter) &&
          (!q ||
            o.orderNumber.toLowerCase().includes(q) ||
            lineCodes(o).toLowerCase().includes(q) ||
            o.customerName.toLowerCase().includes(q) ||
            o.salesOrderNo.toLowerCase().includes(q) ||
            o.quoteNo.toLowerCase().includes(q)),
      )
      .map((o) => ({
        ...o,
        key: `${o.type}|${o.id}`,
        panel: o.type === "Panel" ? panelById.get(o.lines.find((l) => l.panelId)?.panelId ?? "") : undefined,
        linePanels: o.type === "Panel" ? o.lines.map((l) => panelById.get(l.panelId)) : [],
        shortages: o.type === "Panel" ? requirementsFor(pendingNeedLines(o.lines, o.loads), panelById, stock, { allocation: o.allocation, booked }).filter((r) => r.toCut > 0) : [],
        readiness: o.type === "Panel" ? readiness(o.checkpoints, o.status) : "—",
        loadStatus: loadStatusOf(o),
        pending: pendingText(progressOf(o)),
      }));
  }, [panelOrders, sampleOrders, query, statusFilter, typeFilter, panelById, stock, booked]);

  const sort = useSortRows(
    shown,
    (o, k) =>
      k === "qty" ? o.totalQty
      : k === "items" ? o.lines.length
      : k === "type" ? o.type
      : k === "customer" ? o.customerName
      : k === "design" ? lineCodes(o)
      : k === "date" ? o.orderDate
      : k === "sales" ? o.salesperson
      : k === "status" ? statusIndex(o)
      : k === "loading" ? LOADING_STATUSES.indexOf(o.loadStatus)
      : k === "pending" ? o.pending
      : k === "stock" ? o.shortages.length
      : k === "mdf" ? (o.type === "Panel" ? checkpointStatus(o.checkpoints, "mdf") : "")
      : k === "vinyl" ? (o.type === "Panel" ? checkpointStatus(o.checkpoints, "vinyl") : "")
      : k === "cutPieces" ? (o.type === "Panel" ? checkpointStatus(o.checkpoints, "cut") : "")
      : k === "pasted" ? (o.type === "Panel" ? checkpointStatus(o.checkpoints, "pasted") : "")
      : k === "readiness" ? READINESS_ORDER.indexOf(o.readiness)
      : k === "source" ? o.salesOrderNo || o.quoteNo
      : k === "created" ? o.createdTime
      : k === "modified" ? o.modifiedTime
      : o.orderNumber,
    "created",
    -1, // newest first
  );
  const pager = usePagination(sort.sorted.length, "panelOrdersPageSize", `${query}|${statusFilter}|${typeFilter}`);
  const pageRows = pager.slice(sort.sorted);

  /** Whole row / card opens the order (CR-287) — status is changed there. */
  const openProps = (o: LoadableOrder) => ({
    tabIndex: 0,
    style: { cursor: "pointer" as const },
    onClick: () => navigate(detailUrl(o)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.target === e.currentTarget) navigate(detailUrl(o));
    },
  });

  const card = (o: Row & { type: "Panel" }) => {
    const done = o.status === "Dispatched";
    const { style, ...rest } = openProps(o);
    return (
      <div key={o.key} className="pc-job-card" style={{ display: "flex", gap: 10, ...style }} {...rest} title="Open panel order">
        <ImageThumb images={o.panel?.images ?? []} size={44} alt={o.orderNumber} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {!done && (
              <span
                title={o.shortages.length ? shortageText(o.shortages) : "Cut-piece stock available for this order"}
                style={{ width: 8, height: 8, borderRadius: "50%", background: o.shortages.length ? "var(--danger)" : "var(--ok)", flexShrink: 0 }}
              />
            )}
            <span className="mono" style={{ fontWeight: 600 }}>{o.orderNumber || "Panel Order"}</span>
            <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{fmt(o.totalQty)} pcs · {o.panelCount} line{o.panelCount === 1 ? "" : "s"}</span>
          </div>
          <div style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.customerName}</div>
          <div className="mono dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={lineCodes(o)}>
            {lineCodes(o) || "—"}
          </div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
            {[o.orderDate, o.salesperson].filter(Boolean).join(" · ") || "—"}
          </div>
          {!done && (
            <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }} title="MDF · Vinyl Printing · Cut Pieces · Vinyl Pasted">
              <Chip tone={READINESS_TONE[o.readiness]} label={o.readiness} />
              {o.loadStatus !== "Not loaded" && <Chip tone={LOADING_TONE[o.loadStatus]} label={o.loadStatus} />}
            </div>
          )}
          {!done && o.pending && o.loadStatus === "Partially loaded" && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>Pending: {o.pending}</div>
          )}
          {(o.salesOrderId || o.quoteId) && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
              From <SourceLink o={o} />
            </div>
          )}
          {!done && o.shortages.length > 0 && (
            <div style={{ fontSize: "var(--t-sm)", color: "var(--c-amber)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={shortageText(o.shortages)}>
              {shortageText(o.shortages)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const panelRows = shown.filter((o): o is Row & { type: "Panel" } => o.type === "Panel");
  const board = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${PANEL_ORDER_STATUSES.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto", marginTop: 12 }}>
      {PANEL_ORDER_STATUSES.map((stage) => {
        const cards = panelRows.filter((o) => o.status === stage);
        return (
          <div key={stage} className="card" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STAGE_COLOR[stage] }} />
              <span style={{ fontWeight: 600 }}>{PANEL_ORDER_STATUS_LABEL[stage]}</span>
              <span className="muted" style={{ fontSize: 14, marginLeft: "auto" }}>{cards.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
              {cards.map(card)}
              {cards.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  const sheet = (
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
              <tr key={o.key} {...openProps(o)} title={o.type === "Panel" ? "Open panel order" : "Open sample order"}>
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
                  {panelOrders.length + sampleOrders.length > 0 ? (
                    <EmptyState title="No matching results" hint="Try a different filter" />
                  ) : (
                    <EmptyState title="No orders yet" hint="Record the first one with New Order" />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <GridFooter {...pager} />
    </div>
  );

  return (
    <div>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span role="group" aria-label="Board view" title="Switch view" style={{ display: "inline-flex", gap: 4 }}>
          <IconBtn icon="kanban" title="Kanban view (panel orders)" active={view === "kanban"} onClick={() => setView("kanban")} />
          <IconBtn icon="orders" title="Sheet view" active={view === "sheet"} onClick={() => setView("sheet")} />
        </span>
        <span className="pc-divider" />
        <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={["Panel", "Sample"]} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search order, panel, item, customer or source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        {view === "sheet" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />}
        {can("panel_craft", "edit") && (
          <button className="btn" onClick={() => navigate("/cut-stock/record")} title="Bulk Add Stock sheet (CR-307)">
            Add Stock
          </button>
        )}
        {can("panel_craft", "create") && (
          <button className="hbtn primary" onClick={() => navigate(typeFilter === "Sample" ? "/panel-orders/new?type=Sample" : "/panel-orders/new")}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        )}
      </div>

      {loading && shown.length === 0 ? <div className="card"><SkeletonRows rows={6} /></div> : view === "kanban" ? board : sheet}
    </div>
  );
}
