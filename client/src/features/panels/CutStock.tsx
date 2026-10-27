/* ============================================================
   Stock (Panel Craft) — CR-448: the Item-master look as a two-level list:
   one row per ITEM (image, item, size, Σ on hand / booked / free / stock
   weight) with its CUT PIECES beneath (↳ cut size · weight/pc · on hand ·
   booked · free · stock wt), every item open by default, a chevron folds one.
   Booked / Free (CR-312) = what open panel orders hold vs what anyone may
   still book. Read-only grid over CutPieceStock; stock moves ONLY through
   the bulk sheets (Add Stock = /cut-stock/record, Adjust Stock =
   /cut-stock/adjust) and the panel-order lifecycle. CR-460: a row click opens
   THAT cut piece's detail (/cut-stock/:design/:cut — the item row = its
   full-size piece), staying inside Panel Craft; no Image column.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { FilterSelect, IconBtn } from "./pcBits";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedCutSizes, listPanels, type CutSizeOption } from "./panelsApi";
import { allocatedByKey, cachedCutStockRows, cachedPanelOrders, listCutStock, listPanelOrders, type CutStockRow, type PanelOrderRow } from "./panelOrdersApi";
import { weightPerPc } from "./cutPieceWeight";
import { cutPiecePath } from "./CutPieceDetail";

const dash = <span className="dim">—</span>;
const kg2 = (n: number) => Math.round(n * 100) / 100;

/** One grid line — an ITEM (Σ of its pieces, `pieces` = how many) or a cut PIECE of it. */
interface GridRow {
  kind: "item" | "piece";
  id: string;
  designId: string;
  design?: DesignRow;
  designName: string;
  sizeLabel: string;
  cutSizeId: string; // item line: its full-size piece (the row that IS the item), else its first piece
  cutSizeName: string; // "" on an item line
  weightKg: number | null; // item: the full-piece ƒx; piece: stored weight
  qty: number;
  booked: number; // CR-312: Σ open panel orders' booking
  free: number; // qty − booked
  stockKg: number | null; // null while any piece is unweighed
  modifiedTime: string;
  pieces: number;
  hasSpecial: boolean; // CR-456: item has a cut size other than its full size → shows ↳ rows + chevron
}

const num = { className: "num mono", style: { textAlign: "right" as const } };
// CR-448: Cut Piece Size rides in the Item cell (↳) — the own column is gone; CR-460: no Image column; key bumped to v5.
const STOCK_COLUMNS: ColumnDef<GridRow>[] = [
  {
    key: "design",
    label: "Item",
    render: (r) =>
      r.kind === "item" ? (
        <span className="design-name">
          {r.designName || "—"}
          {r.hasSpecial && <span className="dim" style={{ fontWeight: 400 }}> · {r.pieces} cut piece{r.pieces === 1 ? "" : "s"}</span>}
        </span>
      ) : (
        // ponytail: inline indent like Warehouses; promote to a .sub-row class if a third tree grid appears.
        <span className="mono" style={{ paddingLeft: 26 }}>↳ {r.cutSizeName || "—"}</span>
      ),
  },
  { key: "size", label: "Size", render: (r) => (r.kind === "item" && r.sizeLabel ? <span className="chip size">{r.sizeLabel}</span> : r.kind === "item" ? dash : null) },
  { key: "weight", label: "Weight / pc", ...num, render: (r) => (r.weightKg == null ? <span className="dim" title={r.kind === "item" ? "Needs box weight and pcs / box" : "Not weighed"}>—</span> : `${r.weightKg} kg`) },
  { key: "qty", label: "On Hand (pcs)", ...num, render: (r) => <span style={r.qty === 0 ? { color: "var(--c-red)" } : undefined}>{fmt(r.qty)}</span> },
  { key: "booked", label: "Booked", ...num, render: (r) => (r.booked ? <span title="Held by open panel orders">{fmt(r.booked)}</span> : dash) },
  { key: "free", label: "Free", ...num, render: (r) => <span style={r.free === 0 && r.qty > 0 ? { color: "var(--c-amber)" } : undefined} title="On hand not booked by any order">{fmt(r.free)}</span> },
  { key: "stockKg", label: "Stock Wt", ...num, render: (r) => (r.stockKg == null ? dash : `${kg2(r.stockKg)} kg`) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function CutStock() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("cutStock.query", "");
  const [designFilter, setDesignFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // every item open unless folded here
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("cutStockColumns.v5", STOCK_COLUMNS, ["modified"]);

  const load = async () => {
    setLoading(true);
    const [stockRes, designsRes, panelsRes, ordersRes] = await Promise.all([listCutStock(), listDesigns(), listPanels(), listPanelOrders()]);
    setLoading(false);
    if (panelsRes.ok) setCutSizes(panelsRes.cutSizes);
    if (ordersRes.ok) setOrders(ordersRes.orders);
    if (!stockRes.ok) {
      setError(stockRes.error || "Failed to load cut-piece stock");
      return;
    }
    setError(null);
    setRows(stockRes.rows);
    if (designsRes.ok) setDesigns(designsRes.designs);
  };
  useEffect(() => {
    void load();
  }, []);

  /** Items (Σ) with their pieces, pieces in cut-size order. */
  const items = useMemo(() => {
    const byId = new Map(designs.map((d) => [d.id, d]));
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    const booked = allocatedByKey(orders);
    const byDesign = new Map<string, GridRow[]>();
    for (const r of rows) {
      const d = byId.get(r.designId);
      const b = booked.get(`${r.designId}|${r.cutSizeId}`) ?? 0;
      const piece: GridRow = {
        kind: "piece",
        id: r.id,
        designId: r.designId,
        design: d,
        designName: d ? d.uniqueName || d.designName : "",
        sizeLabel: d?.sizeLabel || "",
        cutSizeId: r.cutSizeId,
        cutSizeName: cutName.get(r.cutSizeId) || "",
        weightKg: r.weightKg,
        qty: r.qty,
        booked: b,
        free: Math.max(0, r.qty - b),
        stockKg: r.weightKg == null ? null : r.weightKg * r.qty,
        modifiedTime: r.modifiedTime,
        pieces: 1,
        hasSpecial: false,
      };
      (byDesign.get(r.designId) ?? byDesign.set(r.designId, []).get(r.designId)!).push(piece);
    }
    return [...byDesign.entries()].map(([designId, pieces]): { item: GridRow; pieces: GridRow[] } => {
      pieces.sort((a, b) => a.cutSizeName.localeCompare(b.cutSizeName));
      const p0 = pieces[0];
      return {
        item: {
          kind: "item",
          id: designId,
          designId,
          design: p0.design,
          designName: p0.designName,
          sizeLabel: p0.sizeLabel,
          cutSizeId: (pieces.find((r) => r.cutSizeName === r.sizeLabel) ?? p0).cutSizeId,
          cutSizeName: "",
          weightKg: p0.design ? weightPerPc(p0.design) : null,
          qty: pieces.reduce((s, r) => s + r.qty, 0),
          booked: pieces.reduce((s, r) => s + r.booked, 0),
          free: pieces.reduce((s, r) => s + r.free, 0),
          stockKg: pieces.some((r) => r.stockKg == null) ? null : pieces.reduce((s, r) => s + (r.stockKg ?? 0), 0),
          modifiedTime: pieces.map((r) => r.modifiedTime).sort()[pieces.length - 1] || "",
          pieces: pieces.length,
          // The full-size piece is the CutPieceSize named after the Size code (server fullSizeCutPiece) — that row IS the item.
          hasSpecial: pieces.some((r) => r.cutSizeName !== r.sizeLabel),
        },
        pieces,
      };
    });
  }, [rows, designs, cutSizes, orders]);

  // Search: an item matching by name / size shows every piece; otherwise only the pieces whose cut size matches.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(({ item }) => !designFilter || item.designName === designFilter)
      .map(({ item, pieces }) => {
        const itemHit = !q || item.designName.toLowerCase().includes(q) || item.sizeLabel.toLowerCase().includes(q);
        const kids = itemHit ? pieces : pieces.filter((p) => p.cutSizeName.toLowerCase().includes(q));
        return { item, pieces: kids, hit: itemHit || kids.length > 0 };
      })
      .filter((g) => g.hit);
  }, [items, query, designFilter]);
  const designOptions = useMemo(() => [...new Set(items.map(({ item }) => item.designName).filter(Boolean))].sort(), [items]);

  // Sort applies to the ITEM lines; each item's pieces follow it.
  const sort = useSortRows(
    filtered.map((g) => g.item),
    (r, k) =>
      k === "qty" ? r.qty
      : k === "booked" ? r.booked
      : k === "free" ? r.free
      : k === "weight" ? r.weightKg ?? -1
      : k === "stockKg" ? r.stockKg ?? 0
      : k === "size" ? r.sizeLabel
      : k === "modified" ? r.modifiedTime
      : r.designName,
    "design",
  );
  const lines = useMemo(() => {
    const q = query.trim();
    const piecesOf = new Map(filtered.map((g) => [g.item.id, g.pieces]));
    const out: GridRow[] = [];
    for (const item of sort.sorted) {
      out.push(item);
      if (item.hasSpecial && (q || !collapsed.has(item.id))) out.push(...(piecesOf.get(item.id) ?? []));
    }
    return out;
  }, [sort.sorted, filtered, collapsed, query]);
  const pager = usePagination(lines.length, "cutStockPageSize", `${query}|${designFilter}|${sort.sortKey}|${sort.dir}`);
  const pageRows = pager.slice(lines);
  const totals = useMemo(() => {
    const pieces = filtered.flatMap((g) => g.pieces);
    return { pcs: pieces.reduce((s, r) => s + r.qty, 0), kg: pieces.reduce((s, r) => s + (r.stockKg ?? 0), 0) };
  }, [filtered]);
  const canEdit = can("panel_craft", "edit");
  const fold = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : `${fmt(totals.pcs)} pcs · ${kg2(totals.kg)} kg`}</span>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Item" value={designFilter} onChange={setDesignFilter} options={designOptions} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item, size or cut size…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
        {canEdit && (
          <button className="hbtn" onClick={() => navigate("/cut-stock/transfer")} title="Move pieces between warehouses (CR-330)">
            <Icon name="truck" size={13} />
            Transfer
          </button>
        )}
        {canEdit && (
          <button className="hbtn" onClick={() => navigate("/cut-stock/adjust")} title="Breakage, theft, count correction…">
            <Icon name="edit" size={13} />
            Adjust Stock
          </button>
        )}
        {canEdit && (
          <button className="hbtn primary" onClick={() => navigate("/cut-stock/record")}>
            <Icon name="plus" size={13} />
            Add Stock
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
                  // Whole row opens that cut piece (CR-460); no row icons (CR-279).
                  const open = () => navigate(cutPiecePath(r.designId, r.cutSizeId));
                  const folded = collapsed.has(r.id);
                  return (
                    <tr key={`${r.kind}|${r.id}`} tabIndex={0} style={{ cursor: "pointer", fontWeight: r.kind === "item" ? 500 : undefined }} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }} title="Open cut piece — stock, locations & history">
                      {visible.map((c) => (
                        <td key={c.key} className={c.className} style={c.style}>
                          {c.key === "design" && r.kind === "item" && r.hasSpecial && (
                            <button
                              type="button"
                              className="btn x"
                              style={{ marginRight: 6, padding: "0 4px" }}
                              title={folded ? "Show cut pieces" : "Hide cut pieces"}
                              aria-expanded={!folded}
                              onClick={(e) => {
                                e.stopPropagation();
                                fold(r.id);
                              }}
                            >
                              <Icon name={folded ? "chev-r" : "chev-d"} size={13} />
                            </button>
                          )}
                          {c.render!(r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!loading && !error && lines.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="tile"
                          title="No stock yet"
                          hint="Add items on Panel Items first, then record stock with Add Stock"
                          action={canEdit ? <button className="hbtn primary" onClick={() => navigate("/panel-items")}>Panel Items</button> : undefined}
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
