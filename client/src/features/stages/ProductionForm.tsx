/* ============================================================
   Start New Production (CR-234) — production-first (CR-197): the factory
   produces to STOCK, order-independent. Lines — Item · Qty — then the
   who/when/note below. Saving creates the job ONLY; it lands in In Production
   at 0 produced and output is logged batch by batch from the + menu
   (RecordOutputForm), which is where Batch No. and Box Brand are captured.
   Stock is allocated to Sales Orders afterwards (Allocate Stock on the SO).
   `presetLines` prefills rows (clone, or the To Produce view's shortfalls).
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { useMasters } from "@/features/masters/useMasters";
import { LineStock, useStockLookup } from "@/features/masters/LineStock";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { DateInput } from "@/ui/DateInput";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { ProductionRequestInput } from "./productionApi";
import { NumberInput } from "../../ui/NumberInput";

const LINE_COLS = "3fr 110px 26px"; // full page (CR-220): the item picker takes the room

export function ProductionForm({
  presetLines,
  onSave,
  onClose,
}: {
  /** Prefilled rows (Design ROWID + boxes) — clone, or To Produce shortfalls. */
  presetLines?: { design: string; qty: number }[];
  onSave: (input: ProductionRequestInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const { designRows, salesPersons } = useMasters();
  const stockFor = useStockLookup();
  const recordedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  const designById = (id: string) => designRows.find((d) => d.id === id);
  // ponytail: no dedupe of the same item across rows — two rows = two jobs of it.
  type Line = { design: string; qty: string };
  const emptyLine = (): Line => ({ design: "", qty: "" });
  const [lines, setLines] = useState<Line[]>(() =>
    presetLines?.length
      ? presetLines.map((l) => ({ design: l.design, qty: String(Math.max(1, l.qty)) }))
      : [emptyLine()],
  );
  const form = useFormSave(onClose);
  const setLine = (i: number, patch: Partial<Line>) => {
    form.touch();
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const [prodDate, setProdDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const designOptions = useMemo<ComboOption[]>(
    () =>
      designRows.map((d) => ({
        value: d.id,
        label: d.uniqueName || d.designName,
        hint: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || undefined,
      })),
    [designRows],
  );

  const active = lines.filter((l) => l.design || l.qty);
  const bad = (l: Line) => !l.design || !((parseInt(l.qty, 10) || 0) > 0);
  const missing = active.length === 0 || active.some(bad);
  const total = active.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);

  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    void form.run(() =>
      onSave({
        lines: active.map((l) => ({
          design: l.design,
          qty_requested: parseInt(l.qty, 10) || 0,
        })),
        production_date: prodDate || undefined,
        performed_by: recordedBy,
        note: note.trim() || undefined,
      }),
    );
  };

  return (
    <FormPage
      title="Start New Production"
      busy={form.busy}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note={
        showErrors && missing ? (
          <span className="field-err">Each line needs an item and a qty</span>
        ) : total > 0 ? (
          `${fmt(total)} boxes · ${active.length} line${active.length > 1 ? "s" : ""}`
        ) : (
          "* Indicates a mandatory field"
        )
      }
    >
          <div className="form-section">
            <div className="form-section-title">Items to produce</div>
            <div className="ord-lines">
              <div className="ord-line ord-line-head qt-line" style={{ gridTemplateColumns: LINE_COLS }}>
                <span>Item<span className="req"> *</span></span>
                <span>Qty (boxes)<span className="req"> *</span></span>
                <span />
              </div>
              {lines.map((l, i) => {
                const d = designById(l.design);
                return (
                  <div className="ord-line qt-line" key={i} style={{ gridTemplateColumns: LINE_COLS, alignItems: "start" }}>
                    <div className="form-field" style={{ gap: 2 }}>
                      <Combobox
                        value={l.design}
                        options={designOptions}
                        onChange={(v) => setLine(i, { design: v })}
                        placeholder="Search an item…"
                        ariaLabel="Item"
                        invalid={showErrors && !l.design && active.includes(l)}
                      />
                      {d && <LineStock stock={stockFor(d.designName)} qty={Number(l.qty) || 0} label={d.designName} />}
                    </div>
                    <NumberInput
                      min={0}
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                      placeholder="0"
                      aria-label={`Quantity in boxes, row ${i + 1}`}
                    />
                    <button className="btn ord-rm" onClick={() => removeLine(i)} title="Remove line" disabled={lines.length === 1} tabIndex={-1}>
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <button className="btn" style={{ marginTop: 10 }} onClick={addLine}>
              <Icon name="plus" size={12} /> Add line
            </button>
            <div className="qt-totals">
              <div className="row total">
                <span>Total production</span>
                <span className="mono">{fmt(total)} boxes</span>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Details</div>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — shift, remarks…" />
              </label>
              <label className="form-field">
                <span className="lbl">Recorded by</span>
                {/* Auto-stamped from the signed-in user — grey = system-filled. */}
                <input value={recordedBy || "—"} readOnly tabIndex={-1} style={{ background: "var(--bg-2)", color: "var(--muted)" }} title="Auto: the signed-in user" />
              </label>
              <label className="form-field">
                <span className="lbl">Production date</span>
                <DateInput value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
              </label>
            </div>
          </div>
    </FormPage>
  );
}
