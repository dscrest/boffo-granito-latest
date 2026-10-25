/* ============================================================
   Production Completion — the final stage (QC → Completed). Captures the ACTUAL
   boxes produced per plan line (may be less OR more than requested), which is the
   single moment available stock moves. Requested is shown for reference; Produced
   defaults to it and is editable up or down.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { NumberInput } from "@/ui/NumberInput";
import type { ProductionRequestGroup } from "./productionApi";

export interface ProductionCompleteResult {
  /** CR-438: `warehouse` per line — the Location (Warehouse node ROWID) that line's boxes go into; undefined while dormant. */
  lines: { id: string; qty_boxes: number; batch_number?: string; warehouse?: string }[];
  production_date: string;
  performed_by: string;
  note: string;
}

export function ProductionCompleteForm({
  group,
  onSave,
  onClose,
}: {
  group: ProductionRequestGroup;
  onSave: (result: ProductionCompleteResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);

  const lines = useMemo(() => group.entries, [group]);
  // Produced defaults to the requested qty per line; keyed by plan-line id.
  const [produced, setProduced] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((e) => [e.id, String(e.qtyRequested)])),
  );
  // Batch for the output this completion records; blank → server auto-numbers.
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  // CR-438: Location per line (was one for the form); CR-411: default = the Production bay.
  const { options: whOptions, primaryFor, enabled: whEnabled } = useWarehouses();
  const whDefault = primaryFor("Production")?.id ?? "";
  const [whById, setWhById] = useState<Record<string, string>>({});
  const whOf = (id: string) => whById[id] ?? whDefault;

  const panelRef = useModalA11y(onClose);

  const totalProduced = lines.reduce((s, e) => s + (parseInt(produced[e.id], 10) || 0), 0);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        lines: lines.map((e) => ({
          id: e.id,
          qty_boxes: parseInt(produced[e.id], 10) || 0,
          batch_number: (batch[e.id] || "").trim() || undefined,
          warehouse: (whEnabled && whOf(e.id)) || undefined,
        })),
        production_date: date,
        performed_by: loggedBy,
        note: note.trim(),
      });
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
            <div className="ttl">Production Completion — {group.code}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Items</div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Design</th>
                  <th style={{ width: 170 }}>Batch No.</th>
                  {whEnabled && <th style={{ width: 220 }}>Location</th>}
                  <th className="num" style={{ textAlign: "right" }}>Requested</th>
                  <th className="num" style={{ textAlign: "right", width: 120 }}>Produced</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((e) => (
                  <tr key={e.id}>
                    <td><span className="design-name">{e.design || "—"}</span></td>
                    <td>
                      <input
                        value={batch[e.id] ?? ""}
                        onChange={(ev) => setBatch((b) => ({ ...b, [e.id]: ev.target.value }))}
                        placeholder="Auto-numbered if blank"
                        aria-label={`${e.design} batch number`}
                        style={{ width: "100%" }}
                      />
                      {e.records.length > 0 && (
                        <div className="mono dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                          Logged: {[...new Set(e.records.map((r) => r.batchNumber).filter(Boolean))].join(" · ")}
                        </div>
                      )}
                    </td>
                    {whEnabled && (
                      <td>
                        <Combobox value={whOf(e.id)} options={whOptions} clearable={false} maxVisible={120} ariaLabel={`${e.design} location`} onChange={(v) => setWhById((m) => ({ ...m, [e.id]: v }))} />
                      </td>
                    )}
                    <td className="num mono">{fmt(e.qtyRequested)}</td>
                    <td className="num">
                      <NumberInput
                        min={0}
                        value={produced[e.id] ?? ""}
                        onChange={(ev) => setProduced((p) => ({ ...p, [e.id]: ev.target.value }))}
                        placeholder="0"
                        style={{ width: 100, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-section">
            <div className="form-section-title">Completion</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Completion Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Logged by</span>
                <input value={loggedBy || "—"} readOnly tabIndex={-1} style={{ background: "var(--bg-2)", color: "var(--muted)" }} title="Auto: the signed-in user" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Notes</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional completion note" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="dim" style={{ marginRight: "auto", fontSize: "var(--t-sm)" }}>{fmt(totalProduced)} boxes total</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
