/* ============================================================
   Panel form — create / edit a showcase Panel (Panel Craft), a full
   FormPage laid out Zoho-style (CR-281, .form-rows). Hosted by
   PanelFormPage (/panels/new|:id/edit|:id/clone).
   Header: Panel Code (server-assigned PANEL-NNN on create, CR-280 —
   read-only here), Panel Size, Vinyl Size. Design lines: Design
   picker → its Available Size auto-fills read-only; Cut Piece Size
   picker offers "Create …" for a missing size (write-through to the
   CutPieceSize master); Cut Piece Qty = pieces on the panel.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { toast } from "@/ui/Toast";
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
  onSave: (input: PanelInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const form = useFormSave(onClose);
  // Edit keeps the stored code; create / clone send "" and the server assigns
  // the next PANEL-NNN (form-ux rule 7: no typed short codes).
  const code = initial?.panel_code ?? "";
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

  const setLine = (i: number, patch: Partial<LineDraft>) => {
    form.touch();
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const updateLines = (fn: (prev: LineDraft[]) => LineDraft[]) => {
    form.touch();
    setLines(fn);
  };

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

  // CR-289: a blank Cut Piece Size = full size — the server fills it in.
  const completeLines = lines.filter((l) => l.design && l.cut_piece_qty > 0);
  const canSave = completeLines.length > 0;

  const submit = () => {
    if (!canSave) return;
    void form.run(() =>
      onSave({
        panel_code: code.trim(),
        panel_size: panelSize.trim(),
        vinyl_size: vinylSize.trim(),
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
            <span className="lbl">Panel Code</span>
            <input
              value={code}
              readOnly
              tabIndex={-1}
              className="calc"
              placeholder="Auto-assigned on save (PANEL-001…)"
              title="Formula field: next PANEL number, assigned when you save"
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
                {i === 0 && <span className="lbl">Cut Piece Size</span>}
                <Combobox
                  value={l.cut_piece_size}
                  options={cutOptions}
                  onChange={(v) => setLine(i, { cut_piece_size: v })}
                  onCreate={(name) => void onCreateCutSize(i, name)}
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
