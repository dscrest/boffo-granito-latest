/* ============================================================
   Panel Items (CR-306) — the designs picked from the Item master into
   Panel Craft. An item is "in the panel module" when it has at least one
   cut-piece row (CutPieceStock, qty 0 allowed) — no flag on Design.
   Grid: Image · Item · Size · Cut Pieces · On Hand · Stock Wt; whole row
   opens /panel-items/:designId where the cut pieces are managed.
   "Add Item" picks a design from the master → its full-size cut piece is
   created at 0 pcs with the item's weight per piece (CR-190 formula).
   CR-414: "Add Stock" (the bulk receipt sheet) takes ANY master design +
   any cut size and defines the piece while receiving — import + stock in one.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { IconBtn } from "./pcBits";
import { cachedCutStockRows, listCutStock, saveCutPiece, type CutStockRow } from "./panelOrdersApi";
import { weightPerPc } from "./cutPieceWeight";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { BulkUpdateModal } from "@/ui/BulkUpdateModal";
import { bulkUpdateDesigns } from "@/features/masters/designsApi";
import { moneyFor } from "@/features/quotes/quoteTemplate";

const dash = <span className="dim">—</span>;
const kg = (n: number) => `${Math.round(n * 100) / 100} kg`;
const money = moneyFor("INR");

export interface PanelItemRow {
  design: DesignRow;
  pieces: number;
  onHand: number;
  stockKg: number;
  unweighed: number; // cut pieces still without a weight
}

/** Designs with at least one cut-piece row, summarised. Shared with the detail rail. */
export function panelItemRows(designs: DesignRow[], stock: CutStockRow[]): PanelItemRow[] {
  const byDesign = new Map<string, CutStockRow[]>();
  for (const r of stock) (byDesign.get(r.designId) ?? byDesign.set(r.designId, []).get(r.designId)!).push(r);
  return designs
    .filter((d) => byDesign.has(d.id))
    .map((design) => {
      const rows = byDesign.get(design.id)!;
      return {
        design,
        pieces: rows.length,
        onHand: rows.reduce((s, r) => s + r.qty, 0),
        stockKg: rows.reduce((s, r) => s + (r.weightKg ?? 0) * r.qty, 0),
        unweighed: rows.filter((r) => r.weightKg == null).length,
      };
    });
}

const COLUMNS: ColumnDef<PanelItemRow>[] = [
  { key: "image", label: "Image", style: { width: 44 }, render: (r) => <ImageThumb images={r.design.images} alt={r.design.designName} /> },
  { key: "item", label: "Item", render: (r) => <span className="design-name">{r.design.uniqueName || r.design.designName}</span> },
  { key: "size", label: "Size", render: (r) => (r.design.sizeLabel ? <span className="chip size">{r.design.sizeLabel}</span> : dash) },
  // CR-504/505: the Item's Rate/sqft prices every cut piece — set many at once with Bulk Update.
  { key: "rate", label: "Rate / sqft", className: "num mono", style: { textAlign: "right" }, render: (r) => (r.design.ratePerSqft ? money(r.design.ratePerSqft) : dash) },
  { key: "pieces", label: "Cut Pieces", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(r.pieces) },
  {
    key: "onHand",
    label: "On Hand (pcs)",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => <span style={r.onHand === 0 ? { color: "var(--c-red)" } : undefined}>{fmt(r.onHand)}</span>,
  },
  {
    key: "stockKg",
    label: "Stock Wt",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.unweighed ? <span className="dim" title={`${r.unweighed} cut piece(s) have no weight yet`}>{kg(r.stockKg)} *</span> : kg(r.stockKg)),
  },
];

export function PanelItems() {
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [stock, setStock] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("panelItems.query", "");
  const [adding, setAdding] = useState(false);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("panelItemsColumns.v2", COLUMNS, []); // .v2 (CR-505: Rate / sqft)
  // CR-505: filter → tick → Bulk Update (the Item master's CR-427 select-all-filtered rule).
  const [criteria, setCriteria] = usePersistedState<FilterCriteria>("panelItems.criteria", {});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [d, s] = await Promise.all([listDesigns(), listCutStock()]);
    setLoading(false);
    if (!s.ok) {
      setError(s.error || "Failed to load cut-piece stock");
      return;
    }
    setError(null);
    setStock(s.rows);
    if (d.ok) setDesigns(d.designs);
  };
  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => panelItemRows(designs, stock), [designs, stock]);
  const filterFields = useMemo<FilterField<PanelItemRow>[]>(() => {
    const opts = (get: (r: PanelItemRow) => string) => [...new Set(rows.map(get).filter(Boolean))].sort();
    return [
      { key: "name", label: "Item", type: "text", get: (r) => `${r.design.designName} ${r.design.uniqueName}` },
      { key: "itemCode", label: "Item Code", type: "text", get: (r) => r.design.itemCode },
      { key: "size", label: "Size", type: "multiselect", options: opts((r) => r.design.sizeLabel), get: (r) => r.design.sizeLabel },
      { key: "finish", label: "Finish", type: "multiselect", options: opts((r) => r.design.finishLabel), get: (r) => r.design.finishLabel },
      { key: "brand", label: "Brand", type: "multiselect", options: opts((r) => r.design.brandLabel), get: (r) => r.design.brandLabel },
      { key: "category", label: "Category", type: "multiselect", options: opts((r) => r.design.categoryLabel), get: (r) => r.design.categoryLabel },
      { key: "rate", label: "Rate / ft²", type: "numrange", get: (r) => r.design.ratePerSqft },
      { key: "onHand", label: "On Hand (pcs)", type: "numrange", get: (r) => r.onHand },
    ];
  }, [rows]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? rows.filter((r) => `${r.design.uniqueName} ${r.design.designName} ${r.design.sku} ${r.design.sizeLabel}`.toLowerCase().includes(q)) : rows;
    return applyFilters(base, criteria, filterFields);
  }, [rows, query, criteria, filterFields]);
  const sort = useSortRows(
    filtered,
    (r, k) => (k === "item" ? r.design.uniqueName || r.design.designName : k === "size" ? r.design.sizeLabel : k === "rate" ? r.design.ratePerSqft : (r as unknown as Record<string, number>)[k]),
    "item",
  );
  const pager = usePagination(sort.sorted.length, "panelItemsPageSize", `${query}|${JSON.stringify(criteria)}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);
  const canEdit = can("panel_craft", "edit");
  const inModule = useMemo(() => new Set(rows.map((r) => r.design.id)), [rows]);
  const canBulk = can("items", "edit"); // the rate lives on the Item master (Design = items module)
  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.design.id));
  const toggleOne = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((p) => {
      const n = new Set(p);
      for (const r of filtered) {
        if (allShownSelected) n.delete(r.design.id);
        else n.add(r.design.id);
      }
      return n;
    });
  const onBulk = async (key: string, value: string | number) => {
    setBusy(true);
    const res = await bulkUpdateDesigns([...selected], { [key]: value });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.firstError || "Bulk update failed");
      return;
    }
    toast.success(`${res.done} item${res.done === 1 ? "" : "s"} updated`);
    setBulkOpen(false);
    setSelected(new Set());
    void load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {adding && (
        <AddPanelItemModal
          designs={designs.filter((d) => !inModule.has(d.id) && d.status !== "Inactive" && d.status !== "Discontinued")}
          onClose={() => setAdding(false)}
          onAdded={(ids) => {
            setAdding(false);
            // CR-452: one item opens its detail as before; several just refresh the grid.
            if (ids.length === 1) navigate(`/panel-items/${encodeURIComponent(ids[0])}`);
            else void load();
          }}
        />
      )}
      {bulkOpen && (
        <BulkUpdateModal noun="item" count={selected.size} fields={[{ key: "rate_per_sqft", label: "Rate / sqft (₹)", type: "number" }]} busy={busy} onApply={(k, v) => void onBulk(k, v)} onClose={() => setBulkOpen(false)} />
      )}
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active (Item master / Masters pattern). */}
      {selected.size > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {selected.size} selected
          </span>
          {canBulk && (
            <button className="btn" onClick={() => setBulkOpen(true)} disabled={busy}>
              <Icon name="settings" size={12} className="ic" /> Bulk Update
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : (
      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item or size…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <AdvancedFilterButton title="Panel Items" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        <Link className="hbtn" to="/cut-piece-sizes" title="The cut piece size list (CR-426)">
          <Icon name="tile" size={13} />
          Cut Piece Sizes
        </Link>
        {canEdit && (
          <Link className="hbtn" to="/cut-stock/record" title="Receive cut pieces — any item from the master, any size; new items join Panel Craft">
            <Icon name="plus" size={13} />
            Add Stock
          </Link>
        )}
        {canEdit && (
          <button className="hbtn primary" onClick={() => setAdding(true)} title="Add an item from the master with 0 pcs on hand">
            <Icon name="plus" size={13} />
            Add Item
          </button>
        )}
      </div>
      )}

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {canBulk && (
                    <th style={{ width: 34, textAlign: "center" }}>
                      <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title={allShownSelected ? "Deselect all" : `Select all ${filtered.length}`} aria-label="Select all filtered" />
                    </th>
                  )}
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const open = () => navigate(`/panel-items/${encodeURIComponent(r.design.id)}`);
                  const sel = selected.has(r.design.id);
                  return (
                    <tr key={r.design.id} tabIndex={0} style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }} title="Open item — cut pieces & stock">
                      {canBulk && (
                        // checkbox cell stops propagation so ticking never opens the item
                        <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={sel} onChange={() => toggleOne(r.design.id)} aria-label={r.design.uniqueName || r.design.designName} />
                        </td>
                      )}
                      {visible.map((c) => (
                        <td key={c.key} className={c.className} style={c.style}>
                          {c.render!(r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + (canBulk ? 1 : 0)}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different search" />
                      ) : (
                        <EmptyState
                          icon="tile"
                          title="No items in Panel Craft yet"
                          hint="Add Stock receives pieces for any item from the Item master and brings it in; Add Item just defines it at 0 pcs"
                          action={canEdit ? <button className="hbtn primary" onClick={() => setAdding(true)}>Add Item</button> : undefined}
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

/** CR-452: pick MANY designs from the master in one go; each gets its full-size cut
    piece (weight = item weight / pc, CR-190). Search + checkbox list, one Add. */
function AddPanelItemModal({ designs, onClose, onAdded }: { designs: DesignRow[]; onClose: () => void; onAdded: (designIds: string[]) => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const panelRef = useModalA11y(onClose);
  // Every typed word must appear somewhere in the row (same token rule as ItemSearchModal).
  const rows = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (d: DesignRow) => `${d.designName} ${d.uniqueName} ${d.sku} ${d.sizeLabel} ${d.finishLabel} ${d.collectionName}`.toLowerCase();
    return designs.filter((d) => tokens.every((t) => hay(d).includes(t))).sort((a, b) => a.designName.localeCompare(b.designName));
  }, [designs, q]);
  const allOn = rows.length > 0 && rows.every((d) => selected.has(d.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      for (const d of rows) allOn ? n.delete(d.id) : n.add(d.id);
      return n;
    });

  const add = async () => {
    const picked = designs.filter((d) => selected.has(d.id));
    if (!picked.length) return;
    setBusy(true);
    const done: string[] = [];
    const failed: string[] = [];
    // Sequential on purpose — one row per item, no need to race the server.
    for (const d of picked) {
      const res = await saveCutPiece({ design: d.id, weight_kg: weightPerPc(d) });
      if (res.ok) done.push(d.id);
      else failed.push(`${d.uniqueName || d.designName}: ${res.error || "failed"}`);
    }
    setBusy(false);
    if (done.length) toast.success(done.length === 1 ? `${picked[0].uniqueName || picked[0].designName} added to Panel Craft` : `${done.length} items added to Panel Craft`);
    if (failed.length) toast.error(`Could not add ${failed.length}: ${failed.join("; ")}`);
    if (done.length) onAdded(done);
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="tile" size={18} /></div>
          <div><div className="ttl">Add Items to Panel Craft</div></div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <span className="gsearch" style={{ marginBottom: 10 }}>
            <Icon name="search" size={13} />
            <input type="text" autoFocus placeholder="Search the item master…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <div style={{ maxHeight: "50vh", overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 30 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all shown" /></th>
                  <th>Item</th>
                  <th>Size · Finish</th>
                  <th className="num" style={{ textAlign: "right" }}>Weight / pc</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="dim">{designs.length ? "No items match" : "Every active item is already in Panel Craft"}</td></tr>
                )}
                {rows.map((d) => {
                  const pc = weightPerPc(d);
                  return (
                    <tr key={d.id} onClick={() => toggle(d.id)} style={{ cursor: "pointer" }}>
                      <td><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} onClick={(e) => e.stopPropagation()} aria-label={d.uniqueName || d.designName} /></td>
                      <td><span className="design-name">{d.uniqueName || d.designName}</span></td>
                      <td className="dim">{[d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || dash}</td>
                      <td className="num mono">{pc != null ? `${pc} kg` : <span className="dim" title="Set box weight on the item first">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="df-foot">
          <span className="df-req-note">{selected.size ? `${selected.size} selected` : "Tick the items to bring into Panel Craft"}</span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" onClick={() => void add()} disabled={selected.size === 0 || busy}>
            <Icon name="check" size={13} /> {busy ? "Adding…" : selected.size > 1 ? `Add ${selected.size} items` : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
