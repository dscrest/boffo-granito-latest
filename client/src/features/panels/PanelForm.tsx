/* ============================================================
   Panel form — create / edit a showcase Panel (Panel Craft).
   Header (Panel Code / Panel Size / Vinyl Size) + design lines:
   Design picker → its Available Size auto-fills read-only; Cut Piece
   Size picker offers "Create …" for a missing size (write-through to
   the CutPieceSize master); Cut Piece Qty = pieces on the panel.
   Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { createCutSize, listPanels, cachedCutSizes, type CutSizeOption, type PanelInput, type PanelRow } from "./panelsApi";

interface LineDraft {
  design: string; // Design ROWID
  cut_piece_size: string; // CutPieceSize ROWID
  cut_piece_qty: number;
}

const blankLine = (): LineDraft => ({ design: "", cut_piece_size: "", cut_piece_qty: 0 });

/** Seed the form from an existing panel (edit / clone). */
export function panelToInput(p: PanelRow): PanelInput {
  return {
    panel_code: p.panelCode,
    panel_size: p.panelSize,
    vinyl_size: p.vinylSize,
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
  onSave: (input: PanelInput) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(initial?.panel_code ?? "");
  const [panelSize, setPanelSize] = useState(initial?.panel_size ?? "1200x2100");
  const [vinylSize, setVinylSize] = useState(initial?.vinyl_size ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    initial?.lines.length ? initial.lines.map((l) => ({ ...l })) : [blankLine()],
  );
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());

  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
  }, []);

  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);
  const designOptions = useMemo(
    () =>
      designs
        .filter((d) => d.status !== "Inactive" && d.status !== "Discontinued")
        .map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.sizeLabel || undefined })),
    [designs],
  );
  const cutOptions = useMemo(() => cutSizes.map((c) => ({ value: c.id, label: c.label })), [cutSizes]);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // "Create …" on the Cut Piece Size picker — write-through to the master,
  // then select the new row (same pattern as DesignForm.createPartyBrand).
  const onCreateCutSize = async (i: number, name: string) => {
    const res = await createCutSize(name);
    if (!res.ok || !res.rowid) {
      toast.error(res.error || "Could not add the cut piece size to the master");
      return;
    }
    setCutSizes((prev) => [...prev, { id: res.rowid!, label: name.trim() }].sort((a, b) => a.label.localeCompare(b.label)));
    setLine(i, { cut_piece_size: res.rowid });
  };

  const completeLines = lines.filter((l) => l.design && l.cut_piece_size && l.cut_piece_qty > 0);
  const canSave = !!code.trim() && completeLines.length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({
      panel_code: code.trim(),
      panel_size: panelSize.trim(),
      vinyl_size: vinylSize.trim(),
      lines: completeLines,
    });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">{isEdit ? "Edit Panel" : "New Panel"}</div>
            <div className="sub2">Panel master</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Panel Details</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Panel Code<span className="req"> *</span>
                </span>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. C01-F11-S03-118" maxLength={60} />
              </label>
              <label className="form-field">
                <span className="lbl">Panel Size (mm)</span>
                <input value={panelSize} onChange={(e) => setPanelSize(e.target.value)} placeholder="e.g. 1200x2100" maxLength={30} />
              </label>
              <label className="form-field">
                <span className="lbl">Vinyl Size (mm)</span>
                <input value={vinylSize} onChange={(e) => setVinylSize(e.target.value)} placeholder="e.g. 1200x2100" maxLength={30} />
              </label>
            </div>
          </div>

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
                      onChange={(v) => setLine(i, { design: v })}
                      placeholder="Select design…"
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
                    {i === 0 && (
                      <span className="lbl">
                        Cut Piece Size<span className="req"> *</span>
                      </span>
                    )}
                    <Combobox
                      value={l.cut_piece_size}
                      options={cutOptions}
                      onChange={(v) => setLine(i, { cut_piece_size: v })}
                      onCreate={(name) => void onCreateCutSize(i, name)}
                      placeholder="e.g. 150x725…"
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
                    onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [blankLine()]))}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button type="button" className="btn" onClick={() => setLines((prev) => [...prev, blankLine()])}>
              <Icon name="plus" size={12} /> Add design
            </button>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            * Indicates a mandatory field
            <span className="df-fx-note">ƒx Indicates a formula field (auto-calculated)</span>
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit} disabled={!canSave}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
