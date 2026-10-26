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

const dash = <span className="dim">—</span>;
const kg = (n: number) => `${Math.round(n * 100) / 100} kg`;

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
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("panelItemsColumns", COLUMNS, []);

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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.design.uniqueName} ${r.design.designName} ${r.design.sku} ${r.design.sizeLabel}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const sort = useSortRows(filtered, (r, k) => (k === "item" ? r.design.uniqueName || r.design.designName : k === "size" ? r.design.sizeLabel : (r as unknown as Record<string, number>)[k]), "item");
  const pager = usePagination(sort.sorted.length, "panelItemsPageSize", `${query}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(sort.sorted);
  const canEdit = can("panel_craft", "edit");
  const inModule = useMemo(() => new Set(rows.map((r) => r.design.id)), [rows]);

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
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : null}</span>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item or size…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
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
                {pageRows.map((r) => {
                  const open = () => navigate(`/panel-items/${encodeURIComponent(r.design.id)}`);
                  return (
                    <tr key={r.design.id} tabIndex={0} style={{ cursor: "pointer" }} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }} title="Open item — cut pieces & stock">
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
                    <td colSpan={visible.length}>
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
