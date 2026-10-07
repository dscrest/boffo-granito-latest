/* ============================================================
   Container form (CR-261) — pick a Size, then add pallet lines the way a
   Quote adds Line Items (CR-269): pick the pallet format, type how many fit,
   "Add line" for the next format of that size. Name + totals are formula-owned.
   A Size may have several containers (CR-273) — the loading picks which one.
   ============================================================ */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Combobox } from "@/ui/Combobox";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { fmt } from "@/lib/format";
import { nameOf, totalsOf, type ContainerFormatInput } from "./containerFormatsApi";
import type { PalletRow, SizeOption } from "./palletsApi";

export interface ContainerFormatFormInitial {
  size?: string;
  lines?: { palletId: string; count: number }[];
  remarks?: string;
}

type LineDraft = { palletId: string; count: string };
const emptyLine = (): LineDraft => ({ palletId: "", count: "" });

export function ContainerFormatForm({
  initial,
  isEdit,
  sizeOptions,
  pallets,
  onSave,
  onClose,
}: {
  initial?: ContainerFormatFormInitial;
  isEdit: boolean;
  sizeOptions: SizeOption[];
  pallets: PalletRow[];
  onSave: (input: ContainerFormatInput) => Promise<void>;
  onClose: () => void;
}) {
  const form = useFormSave(onClose);
  const [size, setSize] = useState(initial?.size ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    initial?.lines?.length ? initial.lines.map((l) => ({ palletId: l.palletId, count: String(l.count) })) : [emptyLine()],
  );
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");

  const sizeLabel = sizeOptions.find((s) => s.id === size)?.label ?? "";
  const sizePallets = useMemo(() => pallets.filter((p) => p.sizeId === size), [pallets, size]);
  const palletById = useMemo(() => new Map(sizePallets.map((p) => [p.id, p])), [sizePallets]);

  const validLines = lines
    .map((l) => ({ palletId: l.palletId, count: Math.max(0, parseInt(l.count, 10) || 0), boxesPerPallet: palletById.get(l.palletId)?.boxesPerPallet ?? 0 }))
    .filter((l) => l.palletId && l.count > 0);
  const { totalPallets, totalBoxes } = totalsOf(validLines);
  const canSave = !!size && totalPallets > 0;

  const setLine = (i: number, k: keyof LineDraft, val: string) => {
    form.touch();
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: val } : l)));
  };
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => {
    form.touch();
    setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  };

  return (
    <FormPage
      title={isEdit ? "Edit Container" : "New Container"}
      sub={isEdit ? nameOf(sizeLabel, totalPallets, totalBoxes) : ""}
      busy={form.busy}
      saveDisabled={!canSave}
      onCancel={() => void form.cancel()}
      onSave={() => void form.run(() => onSave({ size, lines: validLines.map(({ palletId, count }) => ({ palletId, count })), remarks }))}
      note={
        <>
          * Indicates a mandatory field
          <span className="df-fx-note">ƒx Indicates a formula field (auto-calculated)</span>
        </>
      }
    >
      <div className="form-section">
        <div className="form-section-title">Identity</div>
        <div className="form-rows">
          <label className="form-field">
            <span className="lbl">
              Size<span className="req"> *</span>
            </span>
            <Combobox
              value={size}
              options={sizeOptions.map((s) => ({ value: s.id, label: s.label }))}
              onChange={(v) => {
                form.touch();
                setSize(v);
                setLines([emptyLine()]);
              }}
              placeholder="Search size…"
            />
          </label>
          <label className="form-field">
            <span className="lbl">Name</span>
            <input value={size ? nameOf(sizeLabel, totalPallets, totalBoxes) : ""} readOnly tabIndex={-1} className="calc" placeholder="Auto-generated from Size and pallets" title="Formula field: Size · pallets = boxes" />
          </label>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">Pallets</div>
        {!size ? (
          <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Pick a size to add its pallet formats.</div>
        ) : sizePallets.length === 0 ? (
          <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
            No pallet format for this size yet — <Link className="linkish" to={`/pallets/new?size=${encodeURIComponent(size)}`}>add one in Pallet Master</Link>.
          </div>
        ) : (
          <>
            <div className="ord-lines">
              <div className="ord-line ord-line-head cf-line">
                <span>Pallet</span>
                <span>Boxes / Pallet</span>
                <span>Pallets / Container</span>
                <span>Boxes</span>
                <span />
              </div>
              {lines.map((l, i) => {
                const p = palletById.get(l.palletId);
                const n = Math.max(0, parseInt(l.count, 10) || 0);
                const bpp = p?.boxesPerPallet ?? 0;
                // A pallet picked on another line is not offered again — one count per pallet.
                const pickedElsewhere = new Set(lines.filter((_, j) => j !== i).map((x) => x.palletId));
                return (
                  <div className="ord-line cf-line" key={i}>
                    <Combobox
                      value={l.palletId}
                      onChange={(v) => setLine(i, "palletId", v)}
                      placeholder="Search pallet…"
                      clearable
                      options={sizePallets
                        .filter((x) => !pickedElsewhere.has(x.id))
                        .map((x) => ({ value: x.id, label: x.name, hint: x.boxesPerPallet > 0 ? `${fmt(x.boxesPerPallet)} boxes / pallet` : undefined }))}
                    />
                    <span className="mono qt-sub">{p && bpp > 0 ? fmt(bpp) : <span className="dim">—</span>}</span>
                    <NumberInput maxDecimals={0} value={l.count} placeholder="0" aria-label={`Pallets of ${p?.name ?? "pallet"} per container`} onChange={(e) => setLine(i, "count", e.target.value)} />
                    <span className="mono qt-sub">{p && n > 0 ? fmt(n * bpp) : <span className="dim">—</span>}</span>
                    <button className="btn ord-rm" onClick={() => removeLine(i)} title="Remove line" disabled={lines.length === 1} tabIndex={-1}>
                      ✕
                    </button>
                  </div>
                );
              })}
              <div className="ord-line cf-line">
                <span style={{ fontWeight: 600, lineHeight: "35px" }}>Total</span>
                <span />
                <span className="mono qt-sub" style={{ fontWeight: 600 }}>{fmt(totalPallets)}</span>
                <span className="mono qt-sub" style={{ fontWeight: 600 }}>{fmt(totalBoxes)}</span>
                <span />
              </div>
            </div>
            <button className="btn" style={{ marginTop: 10 }} onClick={addLine} disabled={lines.length >= sizePallets.length} title={lines.length >= sizePallets.length ? "Every pallet format of this size is already on a line" : undefined}>
              <Icon name="plus" size={12} /> Add line
            </button>
          </>
        )}
      </div>

      <div className="form-section">
        <div className="form-section-title">Notes</div>
        <div className="form-rows one">
          <label className="form-field">
            <span className="lbl">Remarks</span>
            <textarea value={remarks} onChange={(e) => { form.touch(); setRemarks(e.target.value); }} placeholder="Optional notes" />
          </label>
        </div>
      </div>
    </FormPage>
  );
}
