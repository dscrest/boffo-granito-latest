/* ============================================================
   Cut-piece stock update — sets the absolute on-hand qty per
   Design + Cut Piece Size (same pattern as the Item opening-stock
   edit: the field seeds with the current value and the typed number
   replaces it). Server route /cut-stock-adjust upserts the row.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedCutSizes, createCutSize, listPanels, type CutSizeOption } from "./panelsApi";
import { cachedCutStock, listCutStock, stockKey } from "./panelOrdersApi";

export function CutStockForm({
  initialDesign,
  initialCutSize,
  onSave,
  onClose,
}: {
  /** Prefill (e.g. a /cut-stock grid row click); both still editable. */
  initialDesign?: string;
  initialCutSize?: string;
  onSave: (design: string, cutSize: string, qty: number) => void;
  onClose: () => void;
}) {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());

  const [design, setDesign] = useState(initialDesign ?? "");
  const [cutSize, setCutSize] = useState(initialCutSize ?? "");
  // String so 0 is enterable and distinguishable from blank.
  const [qty, setQty] = useState("");

  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    void listCutStock().then((r) => r.ok && setStock(r.stock));
  }, []);

  // Seed the field with the current on-hand whenever the pair changes.
  useEffect(() => {
    setQty(design && cutSize ? String(stock.get(stockKey(design, cutSize)) ?? 0) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, cutSize]);

  const designOptions = useMemo(
    () => designs.map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.sizeLabel || undefined })),
    [designs],
  );
  const cutOptions = useMemo(() => cutSizes.map((c) => ({ value: c.id, label: c.label })), [cutSizes]);

  // "Create …" on the Cut Piece Size picker — write-through to the master
  // (same pattern as PanelForm.onCreateCutSize).
  const onCreateCutSize = async (name: string) => {
    const res = await createCutSize(name);
    if (!res.ok || !res.rowid) {
      toast.error(res.error || "Could not add the cut piece size to the master");
      return;
    }
    setCutSizes((prev) => [...prev, { id: res.rowid!, label: name.trim() }].sort((a, b) => a.label.localeCompare(b.label)));
    setCutSize(res.rowid);
  };

  const parsed = qty.trim() === "" ? null : Math.max(0, parseInt(qty, 10) || 0);
  const canSave = !!design && !!cutSize && parsed != null;

  const submit = () => {
    if (!canSave || parsed == null) return;
    onSave(design, cutSize, parsed);
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">Update Cut Piece Stock</div>
            <div className="sub2">Panel Craft</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Stock</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Design<span className="req"> *</span>
                </span>
                <Combobox value={design} options={designOptions} onChange={setDesign} placeholder="Select design…" ariaLabel="Design" />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Cut Piece Size<span className="req"> *</span>
                </span>
                <Combobox
                  value={cutSize}
                  options={cutOptions}
                  onChange={setCutSize}
                  onCreate={(name) => void onCreateCutSize(name)}
                  placeholder="Select cut size…"
                  ariaLabel="Cut piece size"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Stock (pcs)<span className="req"> *</span>
                </span>
                <NumberInput min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 20" />
              </label>
            </div>
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
