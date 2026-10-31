/* ============================================================
   Panel form — create / edit a showcase Panel (Panel Craft), a full
   FormPage laid out Zoho-style (CR-281, .form-rows). Hosted by
   PanelFormPage (/panels/new|:id/edit|:id/clone).
   Header: Panel Code (CR-506: TYPED by the user, mandatory, saved in
   capitals, editable on old panels too — reverses CR-280/284's PANEL-NNN),
   Panel Size, Vinyl Size. Design lines: Design
   picker (CR-306: the Panel Items only) → its Available Size auto-fills
   read-only; Cut Piece Size picker lists THAT item's cut pieces and offers
   "Create …" (write-through to the CutPieceSize master + registered as a
   cut piece of the item); Cut Piece Qty = pieces on the panel.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { toast } from "@/ui/Toast";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { listPanels, cachedCutSizes, type CutSizeOption, type PanelInput, type PanelRow } from "./panelsApi";
import { cachedMdfs, listMdfs, type MdfRow } from "./mdfApi";
import { moneyFor } from "@/features/quotes/quoteTemplate";
import { vinylPrice } from "./panelPrice";
import { cachedCutStockRows, listCutStock, saveCutPiece, type CutStockRow } from "./panelOrdersApi";

interface LineDraft {
  design: string; // Design ROWID
  cut_piece_size: string; // CutPieceSize ROWID
  cut_piece_qty: number;
}

const blankLine = (): LineDraft => ({ design: "", cut_piece_size: "", cut_piece_qty: 0 });
/** CR-344: MDF Size pick list = the distinct sizes on the MDF master (DB-sourced, never static). */
const mdfSizesOf = (mdfs: MdfRow[]) => [...new Set(mdfs.map((m) => m.size.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Seed the form from an existing panel (edit / clone). */
export function panelToInput(p: PanelRow): PanelInput {
  return {
    panel_code: p.panelCode,
    panel_size: p.panelSize,
    vinyl_size: p.vinylSize,
    vinyl_rate_sqft: p.vinylRateSqft,
    mdf_size: p.mdfSize,
    remarks: p.remarks,
    lines: p.lines.map((l) => ({ design: l.designId, cut_piece_size: l.cutSizeId, cut_piece_qty: l.qty })),
  };
}

export function PanelForm({
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  initial?: PanelInput;
  isEdit?: boolean;
  onSave: (input: PanelInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const form = useFormSave(onClose);
  // CR-506: the one typed-code exception to form-ux rule 7 — the user's own code, in capitals; clone starts blank.
  const [code, setCode] = useState(initial?.panel_code ?? "");
  const [panelSize, setPanelSize] = useState(initial?.panel_size ?? ""); // CR-484: no default size — the user types it
  const [vinylSize, setVinylSize] = useState(initial?.vinyl_size ?? "");
  const [vinylRate, setVinylRate] = useState(initial?.vinyl_rate_sqft ? String(initial.vinyl_rate_sqft) : ""); // CR-504: ₹/sqft, typed text
  // CR-344: the panel carries its MDF size; thickness + weight come from the size-keyed MDF master.
  const [mdfSize, setMdfSize] = useState(initial?.mdf_size ?? "");
  const [remarks, setRemarks] = useState(initial?.remarks ?? ""); // CR-425: old reference ID etc.
  const [mdfSizes, setMdfSizes] = useState<string[]>(() => mdfSizesOf(cachedMdfs()));
  const [lines, setLines] = useState<LineDraft[]>(
    initial?.lines.length ? initial.lines.map((l) => ({ ...l })) : [blankLine()],
  );
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [pieces, setPieces] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);

  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    void listMdfs().then((r) => r.ok && setMdfSizes(mdfSizesOf(r.rows)));
    void listCutStock().then((r) => r.ok && setPieces(r.rows));
  }, []);

  const mdfSizeOptions = useMemo(() => {
    const all = [...new Set([...mdfSizes, mdfSize.trim()].filter(Boolean))];
    return all.map((t) => ({ value: t, label: t }));
  }, [mdfSizes, mdfSize]);

  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);
  // CR-306: only the Panel Items (designs with a cut-piece row) are offered.
  const piecesByDesign = useMemo(() => {
    const m = new Map<string, CutStockRow[]>();
    for (const r of pieces) (m.get(r.designId) ?? m.set(r.designId, []).get(r.designId)!).push(r);
    return m;
  }, [pieces]);
  const designOptions = useMemo(
    () =>
      designs
        .filter((d) => d.status !== "Inactive" && d.status !== "Discontinued" && piecesByDesign.has(d.id))
        .map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.sizeLabel || undefined })),
    [designs, piecesByDesign],
  );
  const cutName = useMemo(() => new Map(cutSizes.map((c) => [c.id, c.label])), [cutSizes]);
  const cutOptionsFor = (designId: string) =>
    (piecesByDesign.get(designId) ?? []).map((r) => ({ value: r.cutSizeId, label: cutName.get(r.cutSizeId) || "—", hint: `${r.qty} on hand` }));

  const setLine = (i: number, patch: Partial<LineDraft>) => {
    form.touch();
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const updateLines = (fn: (prev: LineDraft[]) => LineDraft[]) => {
    form.touch();
    setLines(fn);
  };

  // CR-489 follow-up (user 2026-10-28): cut piece sizes are SELECTED only — no "Create …" on any picker;
  // the master is kept on Panel Items ▸ Cut Piece Sizes.

  // CR-289: a blank Cut Piece Size = full size — the server fills it in.
  const completeLines = lines.filter((l) => l.design && l.cut_piece_qty > 0);
  const canSave = completeLines.length > 0 && !!code.trim();

  const submit = () => {
    if (!canSave) return;
    void form.run(() =>
      onSave({
        panel_code: code.trim(),
        panel_size: panelSize.trim(),
        vinyl_size: vinylSize.trim(),
        vinyl_rate_sqft: Number(vinylRate) || 0,
        mdf_size: mdfSize.trim(),
        remarks: remarks.trim(),
        lines: completeLines,
      }),
    );
  };

  return (
    <FormPage
      title={isEdit ? "Edit Panel" : "New Panel"}
      sub={isEdit ? code : ""}
      busy={form.busy}
      saveDisabled={!canSave}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note={
        <>
          * Indicates a mandatory field
          <span className="df-fx-note">ƒx Indicates a formula field (auto-calculated)</span>
        </>
      }
    >
      <div className="form-section">
        <div className="form-section-title">Panel Details</div>
        <div className="form-rows">
          <label className="form-field">
            <span className="lbl">
              Panel Code<span className="req"> *</span>
            </span>
            <input
              value={code}
              onChange={(e) => {
                form.touch();
                setCode(e.target.value.toUpperCase());
              }}
              placeholder="e.g. C01-F11-S03"
              maxLength={60}
              aria-required="true"
            />
          </label>
          <label className="form-field">
            <span className="lbl">Panel Size (mm)</span>
            <input
              value={panelSize}
              onChange={(e) => {
                form.touch();
                setPanelSize(e.target.value);
              }}
              placeholder="e.g. 1200x2100"
              maxLength={30}
            />
          </label>
          <label className="form-field">
            <span className="lbl">Vinyl Size (mm)</span>
            <input
              value={vinylSize}
              onChange={(e) => {
                form.touch();
                setVinylSize(e.target.value);
              }}
              placeholder="e.g. 1200x2100"
              maxLength={30}
            />
          </label>
          {/* CR-504: vinyl price = Vinyl Size sqft (Panel Size when blank) × this rate — ƒx beside it. */}
          <label className="form-field">
            <span className="lbl">Vinyl Rate/sqft (₹)</span>
            <NumberInput
              value={vinylRate}
              maxDecimals={2}
              onChange={(e) => {
                form.touch();
                setVinylRate(e.target.value);
              }}
              placeholder="0.00"
            />
          </label>
          <label className="form-field">
            <span className="lbl">Vinyl Price</span>
            <input
              value={moneyFor("INR")(vinylPrice({ vinylSize, panelSize, vinylRateSqft: Number(vinylRate) || 0, lines: [] }))}
              readOnly
              tabIndex={-1}
              className="calc"
              title="Vinyl Size sqft (Panel Size when blank) × Vinyl Rate/sqft"
            />
          </label>
          <label className="form-field">
            <span className="lbl">Remarks</span>
            <textarea
              value={remarks}
              onChange={(e) => {
                form.touch();
                setRemarks(e.target.value);
              }}
              placeholder="Old reference ID…"
              maxLength={500}
            />
          </label>
        </div>
      </div>

      {/* CR-344: the panel names its MDF SIZE only; thicknesses + weights live on the
          size-keyed MDF master (Settings ▸ MDF) and the order line picks one of them. */}
      <div className="form-section">
        <div className="form-section-title">MDF</div>
        <div className="form-rows">
          <label className="form-field">
            <span className="lbl">MDF Size (mm)</span>
            <Combobox
              value={mdfSize}
              options={mdfSizeOptions}
              onChange={(v) => {
                form.touch();
                setMdfSize(v);
              }}
              onCreate={(name) => {
                form.touch();
                setMdfSize(name.trim());
              }}
              placeholder="e.g. 1200x2400"
              ariaLabel="MDF size"
              emptyText="No MDF sizes yet — add them in Settings ▸ MDF, or type one"
            />
          </label>
        </div>
      </div>

      {/* Line rows keep their own grid — line tables sit outside the CR-275 header layout. */}
      <div className="form-section">
        <div className="form-section-title">Product Showcase</div>
        {lines.map((l, i) => {
          const d = l.design ? designById.get(l.design) : undefined;
          return (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 76px 30px", alignItems: "end", marginBottom: 6 }}>
              <label className="form-field">
                {i === 0 && (
                  <span className="lbl">
                    Design Name<span className="req"> *</span>
                  </span>
                )}
                <Combobox
                  value={l.design}
                  options={designOptions}
                  onChange={(v) => setLine(i, { design: v, ...(v !== l.design ? { cut_piece_size: "" } : {}) })}
                  placeholder={designOptions.length ? "Select design…" : "Add items on Panel Items first"}
                  ariaLabel="Design"
                />
              </label>
              <label className="form-field">
                {i === 0 && <span className="lbl">Available Size</span>}
                <input
                  value={d?.sizeLabel || ""}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  placeholder="From the design"
                  title="From the selected Design — edit it in the Items master"
                />
              </label>
              <label className="form-field">
                {i === 0 && <span className="lbl">Cut Piece Size</span>}
                <Combobox
                  value={l.cut_piece_size}
                  options={cutOptionsFor(l.design)}
                  onChange={(v) => setLine(i, { cut_piece_size: v })}
                  placeholder={d?.sizeLabel ? `Full size — ${d.sizeLabel}` : "Full size"}
                  ariaLabel="Cut piece size"
                />
              </label>
              <label className="form-field">
                {i === 0 && (
                  <span className="lbl">
                    Qty<span className="req"> *</span>
                  </span>
                )}
                <NumberInput min={0} value={l.cut_piece_qty || ""} onChange={(e) => setLine(i, { cut_piece_qty: Number(e.target.value) || 0 })} placeholder="Pcs" />
              </label>
              <button
                type="button"
                className="btn x"
                title="Remove line"
                aria-label="Remove line"
                style={{ height: 30 }}
                onClick={() => updateLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [blankLine()]))}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button type="button" className="btn" onClick={() => updateLines((prev) => [...prev, blankLine()])}>
          <Icon name="plus" size={12} /> Add design
        </button>
      </div>
    </FormPage>
  );
}
