/* ============================================================
   Panel Item detail (CR-306) — /panel-items/:designId on the shared
   RecordDetail (DetailRail of panel items on the left). The ONE place a
   design's cut pieces are managed: Cut Pieces card (size · weight/pc,
   editable inline · on hand · stock weight · ✕), "+ Cut piece" row with
   the ƒx weight default (cutPieceWeight), the panels that use the design
   (PanelsPanel, design scope) and the stock history (CutStockEntry).
   Stock itself moves only on /cut-stock (Add / Adjust sheets) and orders.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { EmptyState, SkeletonRows } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { DetailRail } from "@/features/common/DetailRail";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { PanelsPanel } from "./PanelsPanel";
import { cachedCutSizes, createCutSize, listPanels, type CutSizeOption } from "./panelsApi";
import {
  cachedCutStockRows,
  CUT_ENTRY_KIND_LABEL,
  deleteCutPiece,
  listCutStock,
  listCutStockEntries,
  saveCutPiece,
  type CutStockEntryRow,
  type CutStockRow,
} from "./panelOrdersApi";
import { cutPieceWeight, weightPerPc } from "./cutPieceWeight";
import { panelItemRows } from "./PanelItems";

const kg3 = (n: number | null | undefined) => (n == null ? "" : String(Math.round(n * 1000) / 1000));

export function PanelItemDetail() {
  const { id = "" } = useParams();
  const designId = decodeURIComponent(id);
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => cachedDesigns());
  const [stock, setStock] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [entries, setEntries] = useState<CutStockEntryRow[]>([]);
  const [busy, setBusy] = useState(false);
  // "+ Cut piece" draft
  const [newSize, setNewSize] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [weightTouched, setWeightTouched] = useState(false);
  // inline weight edits, keyed by stock row id
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});

  const reload = () => {
    void listCutStock().then((r) => r.ok && setStock(r.rows));
    void listCutStockEntries().then((r) => r.ok && setEntries(r.rows));
  };
  useEffect(() => {
    void listDesigns().then((r) => setDesigns(r.ok ? r.designs : (cachedDesigns() ?? [])));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    reload();
  }, [designId]);

  const design = designs?.find((d) => d.id === designId) ?? null;
  const cutName = useMemo(() => new Map(cutSizes.map((c) => [c.id, c.label])), [cutSizes]);
  const pieces = useMemo(() => stock.filter((r) => r.designId === designId).sort((a, b) => (cutName.get(a.cutSizeId) || "").localeCompare(cutName.get(b.cutSizeId) || "")), [stock, designId, cutName]);
  const history = useMemo(() => entries.filter((e) => e.designId === designId).slice(0, 30), [entries, designId]);
  const railItems = useMemo(
    () =>
      panelItemRows(designs ?? [], stock).map((r) => ({
        id: r.design.id,
        to: `/panel-items/${encodeURIComponent(r.design.id)}`,
        title: r.design.uniqueName || r.design.designName,
        subtitle: [r.design.sizeLabel, `${r.pieces} cut piece${r.pieces === 1 ? "" : "s"}`, `${fmt(r.onHand)} pcs`].filter(Boolean).join(" · "),
        searchText: r.design.sku,
      })),
    [designs, stock],
  );

  // ƒx default for the new cut piece: the item's weight scaled by the cut's face.
  const newSizeName = cutName.get(newSize) || "";
  const fxWeight = design ? cutPieceWeight(design, newSizeName) : null;
  const shownNewWeight = weightTouched ? newWeight : kg3(fxWeight);
  const usedSizes = new Set(pieces.map((p) => p.cutSizeId));
  const sizeOptions = useMemo(() => cutSizes.filter((c) => !usedSizes.has(c.id)).map((c) => ({ value: c.id, label: c.label })), [cutSizes, pieces]); // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = can("panel_craft", "edit");

  const addPiece = async () => {
    if (!design || !newSize) return;
    setBusy(true);
    const w = shownNewWeight.trim() === "" ? null : Number(shownNewWeight);
    const res = await saveCutPiece({ design: design.id, cut_piece_size: newSize, weight_kg: w });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not add the cut piece");
      return;
    }
    setNewSize("");
    setNewWeight("");
    setWeightTouched(false);
    toast.success("Cut piece added");
    reload();
  };
  const onCreateSize = async (name: string) => {
    const res = await createCutSize(name);
    if (!res.ok || !res.rowid) {
      toast.error(res.error || "Could not add the cut piece size to the master");
      return;
    }
    setCutSizes((prev) => [...prev, { id: res.rowid!, label: name.trim() }].sort((a, b) => a.label.localeCompare(b.label)));
    setNewSize(res.rowid);
  };
  const saveWeight = async (row: CutStockRow) => {
    const raw = weightDraft[row.id];
    if (raw === undefined) return;
    const w = raw.trim() === "" ? null : Number(raw);
    if (w === row.weightKg || (w == null && row.weightKg == null)) return;
    const res = await saveCutPiece({ design: row.designId, cut_piece_size: row.cutSizeId, weight_kg: w });
    if (!res.ok) {
      toast.error(res.error || "Could not save the weight");
      return;
    }
    setWeightDraft((d) => { const n = { ...d }; delete n[row.id]; return n; });
    reload();
  };
  const removePiece = async (row: CutStockRow) => {
    const reason = await confirmDelete({ title: "Remove cut piece?", message: `Remove ${cutName.get(row.cutSizeId) || "this cut piece"} from ${design?.uniqueName || design?.designName}? Only possible with 0 on hand and no panel using it.` });
    if (reason === null) return;
    setBusy(true);
    const res = await deleteCutPiece(row.designId, row.cutSizeId, reason || undefined);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not remove the cut piece");
      return;
    }
    toast.success("Cut piece removed");
    reload();
  };
  const removeItem = async () => {
    if (!design) return;
    const reason = await confirmDelete({ title: "Remove from Panel Craft?", message: `Remove ${design.uniqueName || design.designName} and all its cut pieces from Panel Craft? Every cut piece must be at 0 on hand and unused on panels.` });
    if (reason === null) return;
    setBusy(true);
    for (const p of pieces) {
      const res = await deleteCutPiece(p.designId, p.cutSizeId, reason || undefined);
      if (!res.ok) {
        setBusy(false);
        toast.error(res.error || "Could not remove the item");
        reload();
        return;
      }
    }
    setBusy(false);
    toast.success("Item removed from Panel Craft");
    navigate("/panel-items");
  };

  if (designs === null) return <SkeletonRows rows={6} />;

  const pc = design ? weightPerPc(design) : null;
  const fields: RecordField[] = design
    ? [
        { key: "size", label: "Size", value: design.sizeLabel || "Not set" },
        { key: "finish", label: "Finish", value: design.finishLabel || "Not set" },
        { key: "boxWeight", label: "Box Weight", value: design.boxWeightKg ? `${design.boxWeightKg} kg` : "Not set" },
        { key: "pcs", label: "Pcs / Box", value: design.pcsPerBox ? String(design.pcsPerBox) : "Not set" },
        { key: "perPc", label: "Weight / Piece", value: pc != null ? `${pc} kg` : "Not set" },
        { key: "pieces", label: "Cut Pieces", value: `${pieces.length}` },
        { key: "onHand", label: "On Hand", value: `${fmt(pieces.reduce((s, p) => s + p.qty, 0))} pcs` },
      ]
    : [];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <DetailRail placeholder="Search panel items…" currentId={designId} items={railItems} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {!design || pieces.length === 0 ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Not in Panel Craft" hint="Pick an item from the list, or add one on Panel Items" action={<Link className="hbtn" to="/panel-items">Panel Items</Link>} />
          </div>
        ) : (
          <RecordDetail
            backTo="/panel-items"
            title={design.uniqueName || design.designName}
            subtitle={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <ImageThumb images={design.images} alt={design.designName} />
                <Link className="linkish" to={`/design/${encodeURIComponent(design.id)}`} title="Open in Item master">Item master</Link>
              </span>
            }
            actions={
              <MoreMenu
                items={[
                  ...(can("panel_craft", "delete") ? [{ label: "Remove from Panel Craft", danger: true, disabled: busy, onClick: () => void removeItem() }] : []),
                ]}
              />
            }
            fields={fields}
            hiddenStorageKey="panelItemDetailFields"
            hideFields
            activityTable="CutPieceStock"
            created={design.createdTime}
            modified={design.modifiedTime}
          >
            {/* Cut pieces — the item's pieces, each with its own weight and on-hand. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>Cut Pieces</span>
                <span className="muted" style={{ fontSize: 14 }}>{pieces.length}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  {canEdit && <Link className="btn" to="/cut-stock/record" title="Bulk Add Stock sheet"><Icon name="plus" size={12} /> Add Stock</Link>}
                  {canEdit && <Link className="btn" to="/cut-stock/adjust" title="Adjust stock (breakage, count…)"><Icon name="edit" size={12} /> Adjust</Link>}
                </span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Cut Piece Size</th>
                      <th className="num" style={{ textAlign: "right", width: 150 }}>Weight / pc (kg)</th>
                      <th className="num" style={{ textAlign: "right" }}>On Hand (pcs)</th>
                      <th className="num" style={{ textAlign: "right" }}>Stock Wt (kg)</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pieces.map((p) => {
                      const draft = weightDraft[p.id] ?? kg3(p.weightKg);
                      return (
                        <tr key={p.id}>
                          <td className="mono">{cutName.get(p.cutSizeId) || <span className="dim">—</span>}</td>
                          <td className="num">
                            {canEdit ? (
                              <NumberInput
                                maxDecimals={3}
                                value={draft}
                                placeholder="kg"
                                style={{ width: 110, textAlign: "right" }}
                                aria-label={`Weight per piece, ${cutName.get(p.cutSizeId) || ""}`}
                                onChange={(e) => setWeightDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                                onBlur={() => void saveWeight(p)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              />
                            ) : (
                              <span className="mono">{p.weightKg == null ? <span className="dim">—</span> : p.weightKg}</span>
                            )}
                          </td>
                          <td className="num mono" style={p.qty === 0 ? { color: "var(--c-red)" } : undefined}>{fmt(p.qty)}</td>
                          <td className="num mono">{p.weightKg == null ? <span className="dim" title="Set the weight first">—</span> : Math.round(p.weightKg * p.qty * 100) / 100}</td>
                          <td>
                            {can("panel_craft", "delete") && (
                              <button className="btn ord-rm" title="Remove cut piece" aria-label="Remove cut piece" disabled={busy} onClick={() => void removePiece(p)}>✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {canEdit && (
                      <tr>
                        <td style={{ minWidth: 220 }}>
                          <Combobox value={newSize} options={sizeOptions} onChange={(v) => { setNewSize(v); setWeightTouched(false); }} onCreate={(n) => void onCreateSize(n)} placeholder="+ Cut piece size…" ariaLabel="New cut piece size" />
                        </td>
                        <td className="num">
                          <NumberInput
                            maxDecimals={3}
                            value={shownNewWeight}
                            placeholder="ƒx"
                            className={weightTouched ? undefined : "calc"}
                            style={{ width: 110, textAlign: "right" }}
                            title="ƒx item weight per piece × cut face share — type to override"
                            aria-label="New cut piece weight"
                            onChange={(e) => { setWeightTouched(true); setNewWeight(e.target.value); }}
                          />
                        </td>
                        <td colSpan={3}>
                          <button className="hbtn primary" disabled={!newSize || busy} onClick={() => void addPiece()}>
                            <Icon name="plus" size={12} /> Add cut piece
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panels carrying this design (shared section, design scope). */}
            <div style={{ marginBottom: 12 }}>
              <PanelsPanel scope={{ kind: "design", designId: design.id }} />
            </div>

            {/* Stock history — the dated ledger behind the on-hand figures. */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>Stock History</span>
                <span className="muted" style={{ fontSize: 14 }}>latest {history.length}</span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Cut Piece Size</th>
                      <th>Type</th>
                      <th className="num" style={{ textAlign: "right" }}>Pcs</th>
                      <th>Reason / Note</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((e) => (
                      <tr key={e.id}>
                        <td className="mono muted">{e.entryDate || "—"}</td>
                        <td className="mono">{cutName.get(e.cutSizeId) || "—"}</td>
                        <td>
                          {e.refTable === "PanelOrder" && e.refRowid ? (
                            <Link className="linkish" to={`/panel-orders/${encodeURIComponent(e.refRowid)}`}>{CUT_ENTRY_KIND_LABEL[e.kind] || e.kind}</Link>
                          ) : (
                            CUT_ENTRY_KIND_LABEL[e.kind] || e.kind
                          )}
                        </td>
                        <td className="num mono" style={{ color: e.qty < 0 ? "var(--c-red)" : "var(--c-green)", fontWeight: 600 }}>{e.qty > 0 ? "+" : ""}{fmt(e.qty)}</td>
                        <td className="muted">{[e.reason, e.note].filter(Boolean).join(" — ") || "—"}</td>
                        <td className="muted">{e.performedBy || "—"}</td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>No stock movements yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </RecordDetail>
        )}
      </div>
    </div>
  );
}
