/* ============================================================
   Record Output — logs the ACTUAL boxes produced against an approved
   production line. Batch-tracked items record several batches at once
   (batch · mfg date · qty · remark) via /production-record-lines; singular
   items record a single qty via /production-record. Bumps OrderItem.produced
   (order-linked, capped at remaining). Reused by the Production grid + detail.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { Combobox } from "@/ui/Combobox";
import type { ProductionEntry, ProductionRecordInput, ProductionRecordLine } from "./productionApi";
import { cachedProductionLogs } from "./productionApi";
import { NumberInput } from "../../ui/NumberInput";

/** What the form emits — routed by the parent to the right endpoint. `total` is
    the summed boxes (for the completion check + toast). */
export type RecordOutputPayload =
  | { single: ProductionRecordInput }
  | { batches: { rows: ProductionRecordLine[]; performed_by?: string } };

interface BatchLine {
  batch: string;
  date: string;
  qty: string;
  note: string;
}
const emptyLine = (): BatchLine => ({ batch: "", date: todayISO(), qty: "", note: "" });

export function RecordOutputForm({
  entry,
  step,
  onSave,
  onClose,
}: {
  entry: ProductionEntry;
  /** When walking a Record-all queue: which line this is (1-based) of how many. */
  step?: { n: number; of: number };
  onSave: (payload: RecordOutputPayload, total: number) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  // Batched vs singular drives the whole form; load designs if the cache is cold.
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => cachedDesigns());
  useEffect(() => {
    if (!designs) void listDesigns().then((r) => r.ok && setDesigns(r.designs));
  }, [designs]);
  const isBatched = useMemo(
    () => (designs || []).find((d) => d.id === entry.designId)?.isBatched ?? false,
    [designs, entry.designId],
  );

  // Cap at what's still owed on THIS plan line (requested − produced-so-far). For
  // order-linked lines also respect the order's own remaining (ordered − produced).
  const lineRemaining = Math.max(0, entry.qtyRequested - entry.producedSoFar);
  const orderRemaining = entry.orderItemId ? Math.max(0, entry.ordered - entry.produced) : Infinity;
  const remaining = Math.min(lineRemaining, orderRemaining);
  const cap = remaining;

  // Seed the batch picker from this design's prior batches so operators can
  // append output to an existing batch; typing a new value creates it; blank
  // = server auto-mints B/FY/NNN.
  const batchOptions = useMemo(() => {
    const seen = new Set<string>();
    (cachedProductionLogs() || []).forEach((e) =>
      e.records.forEach((r) => {
        if (r.design === entry.design && r.batchNumber) seen.add(r.batchNumber);
      }),
    );
    return [...seen].sort().reverse().map((b) => ({ value: b, label: b }));
  }, [entry.design]);

  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  // ---- Singular items: a single qty / date / remark ----
  const [qty, setQty] = useState(String(remaining));
  const [date, setDate] = useState(entry.productionDate || todayISO());
  const [note, setNote] = useState("");
  const qtyNum = parseInt(qty, 10) || 0;

  // ---- Batch-tracked items: N batch rows ----
  const [lines, setLines] = useState<BatchLine[]>([{ ...emptyLine(), qty: String(remaining) }]);
  const setLine = (i: number, k: keyof BatchLine, v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  const validLines = lines.filter((l) => (parseInt(l.qty, 10) || 0) > 0);
  const batchSum = validLines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);

  const total = isBatched ? batchSum : qtyNum;
  const over = total > cap;
  const missing = total <= 0 || over;

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    try {
      if (isBatched) {
        const rows: ProductionRecordLine[] = validLines.map((l) => ({
          qty_boxes: parseInt(l.qty, 10) || 0,
          batch_number: l.batch.trim() || undefined,
          mfg_date: l.date || undefined,
          note: l.note.trim() || undefined,
        }));
        await onSave({ batches: { rows, performed_by: loggedBy } }, batchSum);
      } else {
        await onSave(
          {
            single: {
              qty_boxes: qtyNum,
              production_date: date,
              performed_by: loggedBy,
              note: note.trim() || undefined,
            },
          },
          qtyNum,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="factory" size={18} /></div>
          <div>
            <div className="ttl">Record Output{step ? ` — Line ${step.n} of ${step.of}` : ""}</div>
            <div className="sub2">{entry.design}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Produced</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 8 }}>
              Requested {fmt(entry.qtyRequested)} · {fmt(remaining)} still to produce
              {entry.orderItemId ? " on this line" : " · make-to-stock"}
            </div>

            {isBatched ? (
              <>
                <table className="tbl" style={{ marginBottom: 8 }}>
                  <thead>
                    <tr>
                      <th>Batch No. <span className="dim" title="ƒx — blank auto-generates B/FY/NNN">ƒx</span></th>
                      <th style={{ width: 150 }}>Mfg date</th>
                      <th className="num" style={{ width: 120, textAlign: "right" }}>Qty<span className="req"> *</span></th>
                      <th>Remark</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const last = i === lines.length - 1;
                      return (
                        <tr key={i}>
                          <td>
                            <Combobox
                              value={l.batch}
                              options={batchOptions}
                              onChange={(v) => setLine(i, "batch", v)}
                              onCreate={(label) => setLine(i, "batch", label.trim())}
                              placeholder="Blank = auto"
                              ariaLabel="Batch number"
                            />
                          </td>
                          <td>
                            <DateInput value={l.date} onChange={(e) => setLine(i, "date", e.target.value)} />
                          </td>
                          <td className="num">
                            <NumberInput
                              min={0}
                              value={l.qty}
                              onChange={(e) => setLine(i, "qty", e.target.value)}
                              placeholder="0"
                              style={{ width: 100, textAlign: "right" }}
                              autoFocus={i === 0}
                            />
                          </td>
                          <td>
                            <input
                              value={l.note}
                              onChange={(e) => setLine(i, "note", e.target.value)}
                              placeholder="Optional"
                              // Tab on the last row's last field adds the next batch.
                              onKeyDown={(e) => {
                                if (last && e.key === "Tab" && !e.shiftKey) {
                                  e.preventDefault();
                                  addLine();
                                }
                              }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn x"
                              onClick={() => removeLine(i)}
                              disabled={lines.length === 1}
                              tabIndex={-1}
                              title="Remove batch"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button className="btn" onClick={addLine}>
                  <Icon name="plus" size={12} /> Add batch
                </button>
                {over && <div className="field-err" style={{ marginTop: 6 }}>Total {fmt(batchSum)} exceeds the {fmt(cap)} boxes still to produce</div>}
              </>
            ) : (
              <div className="form-grid">
                <label className="form-field">
                  <span className="lbl">Boxes produced<span className="req"> *</span></span>
                  <NumberInput
                    min={0}
                    max={Number.isFinite(cap) ? cap : undefined}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    autoFocus
                  />
                  {over && <span className="field-err">Exceeds the {fmt(cap)} boxes still to produce</span>}
                </label>
                <label className="form-field">
                  <span className="lbl">Date</span>
                  <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lbl">Note</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional remark (defects, hold, etc.)" />
                </label>
              </div>
            )}

            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>Logged by {loggedBy || "—"}</div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={missing || saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
