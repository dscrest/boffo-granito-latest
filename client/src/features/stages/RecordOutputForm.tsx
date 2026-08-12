/* ============================================================
   Record Output — logs the ACTUAL boxes produced against an approved
   production line. Batch-tracked items record ONE batch per save
   (mandatory batch no. · mfg date · qty · remark) via /production-record-lines;
   singular items record a single qty via /production-record. Bumps
   OrderItem.produced (order-linked, capped at remaining). Reused by the
   Production grid + detail.
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
import type { ProductionEntry, ProductionRecordInput, ProductionRecordLine } from "./productionApi";
import { batchNumberExists } from "./productionApi";
import { cachedAllowDupBatches, loadAllowDupBatches } from "@/features/settings/settingsApi";
import { NumberInput } from "../../ui/NumberInput";

/** What the form emits — routed by the parent to the right endpoint. `total` is
    the summed boxes (for the completion check + toast). */
export type RecordOutputPayload =
  | { single: ProductionRecordInput }
  | { batches: { rows: ProductionRecordLine[]; performed_by?: string } };

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

  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  // One record per save for both kinds: qty / date / remark, plus a mandatory
  // batch number for batch-tracked items.
  const [qty, setQty] = useState(String(remaining));
  const [date, setDate] = useState(entry.productionDate || todayISO());
  const [note, setNote] = useState("");
  const [batch, setBatch] = useState("");
  const qtyNum = parseInt(qty, 10) || 0;

  // Duplicate-batch pre-check (server 409 is the source of truth): same item +
  // same batch is always blocked; cross-item reuse only when the setting is off.
  const [allowDup, setAllowDup] = useState(cachedAllowDupBatches());
  useEffect(() => {
    void loadAllowDupBatches().then(setAllowDup);
  }, []);
  const dupItem = isBatched && batchNumberExists(batch, entry.design);
  const dupGlobal = isBatched && !dupItem && !allowDup && batchNumberExists(batch);
  const dup = dupItem || dupGlobal;

  const total = qtyNum;
  const over = total > cap;
  const missing = total <= 0 || over || (isBatched && (!batch.trim() || dup));

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    try {
      if (isBatched) {
        const rows: ProductionRecordLine[] = [{
          qty_boxes: qtyNum,
          batch_number: batch.trim(),
          mfg_date: date || undefined,
          note: note.trim() || undefined,
        }];
        await onSave({ batches: { rows, performed_by: loggedBy } }, qtyNum);
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
              <div className="form-grid">
                <label className="form-field">
                  <span className="lbl">Batch No.<span className="req"> *</span></span>
                  <input
                    value={batch}
                    onChange={(e) => setBatch(e.target.value)}
                    placeholder="e.g. B/26-27/001"
                    autoFocus
                  />
                  {dup && (
                    <span className="field-err">
                      {dupItem
                        ? `Batch “${batch.trim()}” is already used for this item`
                        : `Batch “${batch.trim()}” already exists — duplicate batch numbers are disabled in Settings`}
                    </span>
                  )}
                </label>
                <label className="form-field">
                  <span className="lbl">Mfg date</span>
                  <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="form-field">
                  <span className="lbl">Qty (boxes)<span className="req"> *</span></span>
                  <NumberInput
                    min={0}
                    max={Number.isFinite(cap) ? cap : undefined}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                  />
                  {over && <span className="field-err">Exceeds the {fmt(cap)} boxes still to produce</span>}
                </label>
                <label className="form-field">
                  <span className="lbl">Remark</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </label>
              </div>
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
