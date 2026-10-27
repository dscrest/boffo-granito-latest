/* ============================================================
   Transfer Orders (CR-330) — Inventory ▸ every stock move between
   warehouses: one row per transferred line (box stock from the
   production-log cache, cut-piece stock from the cut ledger), newest
   first, with the TRF code, From → To and the reason. "New Transfer" opens
   the box sheet (/stock-transfers/new); cut pieces transfer from
   /cut-stock/transfer. No edit, no delete — reverse with the opposite
   transfer. Follows the master-grid convention (see StockAdjustments).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { cachedTransferEntries, listProductionLogs, type TransferEntry } from "@/features/stages/productionApi";
import { listCutStockEntries, type CutStockEntryRow } from "@/features/panels/panelOrdersApi";
import { cachedCutSizes, listPanels, type CutSizeOption } from "@/features/panels/panelsApi";
import { cachedDesigns, listDesigns, type DesignRow } from "./designsApi";
import { useWarehouses } from "./useWarehouses";

const dash = <span className="dim">—</span>;

/** One transferred line (a −/+ pair folded into one row). */
interface TransferRow {
  id: string;
  code: string;
  date: string;
  unit: "boxes" | "pcs";
  designId: string;
  design: string;
  size: string;
  second: string; // batch or cut size
  qty: number;
  fromId: string;
  toId: string;
  reason: string;
  note: string;
  performedBy: string;
  createdTime: string;
  itemPath: string;
}

export function StockTransfers() {
  const navigate = useNavigate();
  const { nameOf, enabled } = useWarehouses();
  const [boxLegs, setBoxLegs] = useState<TransferEntry[]>(() => cachedTransferEntries());
  const [cutLegs, setCutLegs] = useState<CutStockEntryRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("stockTransfers.query", "");

  const load = async () => {
    setLoading(true);
    const [logs, cuts] = await Promise.all([listProductionLogs(), listCutStockEntries()]);
    setLoading(false);
    if (!logs.ok) {
      setError(logs.error || "Failed to load transfers");
      return;
    }
    setError(null);
    setBoxLegs(logs.transferEntries);
    if (cuts.ok) setCutLegs(cuts.rows.filter((e) => e.kind === "transfer"));
  };
  useEffect(() => {
    void load();
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
  }, []);

  // Fold each −/+ pair into one line: the negative leg names From, its twin (same code · item · second) names To.
  const rows = useMemo<TransferRow[]>(() => {
    const out: TransferRow[] = [];
    const twins = new Map<string, TransferEntry>();
    for (const l of boxLegs) if (l.qtyBoxes > 0) twins.set(`${l.requestGroup}|${l.designId}|${l.batchNumber}`, l);
    for (const l of boxLegs) {
      if (l.qtyBoxes >= 0) continue;
      const twin = twins.get(`${l.requestGroup}|${l.designId}|${l.batchNumber}`);
      out.push({
        id: l.id, code: l.requestGroup, date: l.adjDate, unit: "boxes", designId: l.designId, design: l.design, size: l.size,
        second: l.batchNumber, qty: -l.qtyBoxes, fromId: l.warehouseId, toId: twin?.warehouseId ?? "", reason: l.reason, note: l.note,
        performedBy: l.performedBy, createdTime: l.createdTime, itemPath: `/design/${encodeURIComponent(l.designId)}?tab=locations`,
      });
    }
    const dName = new Map(designs.map((d) => [d.id, d]));
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    const cutTwins = new Map<string, CutStockEntryRow>();
    for (const e of cutLegs) if (e.qty > 0) cutTwins.set(`${e.docNumber}|${e.designId}|${e.cutSizeId}`, e);
    for (const e of cutLegs) {
      if (e.qty >= 0) continue;
      const twin = cutTwins.get(`${e.docNumber}|${e.designId}|${e.cutSizeId}`);
      const d = dName.get(e.designId);
      out.push({
        id: e.id, code: e.docNumber, date: e.entryDate, unit: "pcs", designId: e.designId, design: d?.uniqueName || d?.designName || e.designId, size: d?.sizeLabel || "",
        second: cutName.get(e.cutSizeId) || "—", qty: -e.qty, fromId: e.warehouseId, toId: twin?.warehouseId ?? "", reason: e.reason, note: e.note,
        performedBy: e.performedBy, createdTime: e.createdTime, itemPath: `/cut-stock/${encodeURIComponent(e.designId)}/${encodeURIComponent(e.cutSizeId)}`, // CR-460
      });
    }
    return out;
  }, [boxLegs, cutLegs, designs, cutSizes]);

  const COLUMNS = useMemo<ColumnDef<TransferRow>[]>(
    () => [
      {
        key: "item",
        label: "Item",
        render: (r) => (
          <Link className="linkish" to={r.itemPath} onClick={(e) => e.stopPropagation()} title="View item locations">
            <span className="design-name">{r.design}</span>
          </Link>
        ),
      },
      { key: "size", label: "Size", render: (r) => (r.size ? <span className="chip size">{r.size}</span> : dash) },
      { key: "second", label: "Batch / Cut size", className: "mono", render: (r) => r.second || <span className="dim" title="Unbatched stock">—</span> },
      { key: "qty", label: "Qty", className: "num mono", style: { textAlign: "right" }, render: (r) => <span style={{ fontWeight: 600 }}>{fmt(r.qty)} <span className="dim">{r.unit}</span></span> },
      { key: "date", label: "Date", className: "mono", render: (r) => r.date || dash },
      { key: "from", label: "From", render: (r) => nameOf(r.fromId) || dash },
      { key: "to", label: "To", render: (r) => nameOf(r.toId) || dash },
      { key: "reason", label: "Reason", render: (r) => r.reason || dash },
      { key: "note", label: "Note", className: "muted", render: (r) => r.note || dash },
      { key: "by", label: "By", className: "muted", render: (r) => r.performedBy || dash },
      { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
      { key: "code", label: "TRF #", className: "mono", render: (r) => r.code || dash }, // CR-355: auto number last + hidden
    ],
    [nameOf],
  );
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("stockTransferColumns.v2", COLUMNS, ["note", "created", "code"]) // .v2 (CR-355);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.code} ${r.design} ${r.second} ${r.reason} ${r.note} ${r.performedBy} ${nameOf(r.fromId)} ${nameOf(r.toId)}`.toLowerCase().includes(q)) : rows;
  }, [rows, query, nameOf]);
  const sort = useSortRows(
    filtered,
    (r, k) => (k === "qty" ? r.qty : k === "item" ? r.design : k === "from" ? nameOf(r.fromId) : k === "to" ? nameOf(r.toId) : k === "created" ? r.createdTime : (r as unknown as Record<string, string>)[k]),
    "created",
    -1,
  );
  const pager = usePagination(sort.sorted.length, "stockTransferPageSize", `${query}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);
  const canEdit = can("items", "edit");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search TRF #, item, warehouse, reason…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        {canEdit && (
          <button className="hbtn primary" onClick={() => navigate("/stock-transfers/new")} disabled={!enabled} title={enabled ? "Move boxes between warehouses" : "Add warehouses under Settings first"}>
            <Icon name="plus" size={13} />
            New Transfer
          </button>
        )}
      </div>

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
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
                    onClick={() => navigate(r.itemPath)}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(r.itemPath); }}
                    style={{ cursor: "pointer" }}
                  >
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different search" />
                      ) : (
                        <EmptyState
                          icon="package"
                          title="No transfer orders yet"
                          hint={enabled ? "Move stock between locations with New Transfer" : "Add a warehouse and its locations under Settings ▸ Warehouses & Locations first — then transfers can be recorded here"}
                          action={canEdit && enabled ? <button className="hbtn primary" onClick={() => navigate("/stock-transfers/new")}>New Transfer</button> : undefined}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
