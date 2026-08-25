/* ============================================================
   Record Output / Add Batches — logs the ACTUAL boxes produced against one or
   MORE approved production lines in a single modal (one section per item, the
   item name as the section title). Each section: a pallet for the record
   (defaulted from the SO line, changeable) that rides along to the
   palletization queue, then a TABLE of batch rows (headers once, bare inputs,
   ✕ per row): batch no. · mfg date · qty · remark, with a "+ New Batch" link
   underneath. Batch-tracked items make the batch no. mandatory and save via
   /production-record-lines; singular items drop that column and save one
   /production-record per line. Sections left untouched are skipped on save,
   so "Record all" can record just some items. Tab flows row → row → next
   item. Bumps OrderItem.produced (order-linked, capped at remaining). Reused
   by the Production grid + detail.
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { listPallets, palletsForSize, type PalletRow } from "@/features/masters/palletsApi";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { ProductionEntry, ProductionRecordInput, ProductionRecordLine } from "./productionApi";
import { batchNumberExists } from "./productionApi";
import { cachedAllowDupBatches, loadAllowDupBatches } from "@/features/settings/settingsApi";
import { NumberInput } from "../../ui/NumberInput";

/** What the form emits per entry — routed by the parent to the right endpoint.
    `total` is the summed boxes (for the completion check + toast). Non-batched
    items emit one single per line (parent loops /production-record). */
export type RecordOutputPayload =
  | { singles: ProductionRecordInput[] }
  | { batches: { rows: ProductionRecordLine[]; performed_by?: string; pallet?: string } };

export type RecordOutputResult = { entry: ProductionEntry; payload: RecordOutputPayload; total: number };

export function RecordOutputForm({
  entries,
  onSave,
  onClose,
}: {
  entries: ProductionEntry[];
  onSave: (results: RecordOutputResult[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  // Batched vs singular drives each section; load designs if the cache is cold.
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => cachedDesigns());
  useEffect(() => {
    if (!designs) void listDesigns().then((r) => r.ok && setDesigns(r.designs));
  }, [designs]);
  const isBatchedFor = (entry: ProductionEntry) =>
    (designs || []).find((d) => d.id === entry.designId)?.isBatched ?? false;

  // Cap at what's still owed on THIS plan line (requested − produced-so-far). For
  // order-linked lines also respect the order's own remaining (ordered − produced).
  const capFor = (entry: ProductionEntry) => {
    const lineRemaining = Math.max(0, entry.qtyRequested - entry.producedSoFar);
    const orderRemaining = entry.orderItemId ? Math.max(0, entry.ordered - entry.produced) : Infinity;
    return Math.min(lineRemaining, orderRemaining);
  };

  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  // Pallet for the boxes each record queues — defaults to the SO line's own
  // spec, changeable here. Blank → the server falls back to the SO line's.
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [palletIds, setPalletIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(entries.map((e) => [e.id, e.palletId])),
  );
  useEffect(() => {
    void listPallets().then((r) => r.ok && setPallets(r.pallets));
  }, []);

  // One rows map for both modes (mfg date · qty · remark each, + New Batch,
  // like OrderForm); batch-tracked items add a mandatory batch no. per line.
  type BatchRow = { batch: string; date: string; qty: string; note: string };
  const emptyRow = (entry: ProductionEntry, rowQty = ""): BatchRow => ({
    batch: "",
    date: entry.productionDate || todayISO(),
    qty: rowQty,
    note: "",
  });
  const [rowsById, setRowsById] = useState<Record<string, BatchRow[]>>(() =>
    Object.fromEntries(entries.map((e) => [e.id, [emptyRow(e, String(capFor(e)))]])),
  );
  const setRow = (id: string, i: number, k: "batch" | "date" | "qty" | "note", val: string) =>
    setRowsById((m) => ({ ...m, [id]: m[id].map((r, j) => (j === i ? { ...r, [k]: val } : r)) }));
  const addLine = (entry: ProductionEntry) =>
    setRowsById((m) => ({ ...m, [entry.id]: [...m[entry.id], emptyRow(entry)] }));
  const removeLine = (id: string, i: number) =>
    setRowsById((m) => ({ ...m, [id]: m[id].length > 1 ? m[id].filter((_, j) => j !== i) : m[id] }));

  // A section counts once the user has typed a qty or batch in it; untouched
  // sections are skipped on save so "Record all" can record just some items.
  const activeFor = (entry: ProductionEntry) =>
    rowsById[entry.id].some((r) => r.qty.trim() !== "" || r.batch.trim() !== "");

  // Duplicate-batch pre-check (server 409 is the source of truth): same batch
  // twice in this form for the same item always blocked; cross-item reuse
  // (elsewhere in the form or in the DB) only when the setting is off.
  const [allowDup, setAllowDup] = useState(cachedAllowDupBatches());
  useEffect(() => {
    void loadAllowDupBatches().then(setAllowDup);
  }, []);
  const dupKind = (entry: ProductionEntry, r: BatchRow, i: number): "form" | "item" | "global" | null => {
    const b = r.batch.trim().toLowerCase();
    if (!b) return null;
    const clashes = entries.some((e) =>
      rowsById[e.id].some(
        (o, j) =>
          !(e.id === entry.id && j === i) &&
          o.batch.trim().toLowerCase() === b &&
          (e.design === entry.design || !allowDup),
      ),
    );
    if (clashes) return "form";
    if (batchNumberExists(r.batch, entry.design)) return "item";
    if (!allowDup && batchNumberExists(r.batch)) return "global";
    return null;
  };

  const totalFor = (id: string) => rowsById[id].reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
  const active = entries.filter(activeFor);
  const badSection = (entry: ProductionEntry) => {
    const total = totalFor(entry.id);
    const batched = isBatchedFor(entry);
    return (
      total <= 0 ||
      total > capFor(entry) ||
      rowsById[entry.id].some(
        (r, i) => (parseInt(r.qty, 10) || 0) <= 0 || (batched && (!r.batch.trim() || dupKind(entry, r, i) !== null)),
      )
    );
  };
  const missing = active.length === 0 || active.some(badSection);

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    try {
      const results: RecordOutputResult[] = active.map((entry) => {
        const rows = rowsById[entry.id];
        const total = totalFor(entry.id);
        if (isBatchedFor(entry)) {
          const lines: ProductionRecordLine[] = rows.map((r) => ({
            qty_boxes: parseInt(r.qty, 10) || 0,
            batch_number: r.batch.trim(),
            mfg_date: r.date || undefined,
            note: r.note.trim() || undefined,
          }));
          return {
            entry,
            total,
            payload: { batches: { rows: lines, performed_by: loggedBy, pallet: palletIds[entry.id] || undefined } },
          };
        }
        const singles: ProductionRecordInput[] = rows.map((r) => ({
          qty_boxes: parseInt(r.qty, 10) || 0,
          production_date: r.date,
          performed_by: loggedBy,
          note: r.note.trim() || undefined,
          pallet: palletIds[entry.id] || undefined,
        }));
        return { entry, total, payload: { singles } };
      });
      await onSave(results);
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
            <div className="ttl">Log Production</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          {entries.map((entry, ei) => {
            const isBatched = isBatchedFor(entry);
            const cap = capFor(entry);
            const rows = rowsById[entry.id];
            const left = cap - totalFor(entry.id);
            const over = left < 0;
            // Size-matched pallets, plus the SO line's own pallet even if the
            // size filter would miss it (so the prefill always shows).
            const palletOpts = palletsForSize(pallets, entry.size);
            const chosen = palletIds[entry.id];
            if (chosen && !palletOpts.some((p) => p.id === chosen)) {
              const own = pallets.find((p) => p.id === chosen);
              if (own) palletOpts.unshift(own);
            }
            return (
              <Fragment key={entry.id}>
              <div className="form-section">
                <div className="form-section-title">{entry.design}</div>
                {/* Live counter strip — what this line owes, what it already has,
                    and what the rows below still leave to add. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 14,
                    flexWrap: "wrap",
                    marginBottom: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {!entry.orderItemId && <span className="chip">Make-to-stock</span>}
                  <span style={{ display: "flex", gap: 14, marginLeft: "auto" }}>
                    <Count label="Requested" value={entry.qtyRequested} />
                    {/* Already-recorded output plus what's typed in the rows below. */}
                    <Count label="Produced" value={entry.producedSoFar + totalFor(entry.id)} />
                    {over ? (
                      <Count label="Over by" value={-left} color="var(--c-red)" />
                    ) : (
                      <Count label="Left to add" value={left} />
                    )}
                  </span>
                </div>

                {/* Batch table — column headers once, bare inputs per row (the row
                    labels are the header). Non-batched items drop the Batch column. */}
                <div className="ord-lines">
                  <div className={`ord-line batch-line${isBatched ? "" : " no-batch"} ord-line-head`}>
                    {isBatched && <span>Batch No.<span className="req"> *</span></span>}
                    <span>Mfg date</span>
                    <span>Qty (boxes)<span className="req"> *</span></span>
                    <span>Remark</span>
                    <span />
                  </div>
                  {rows.map((r, i) => {
                    const dup = isBatched ? dupKind(entry, r, i) : null;
                    return (
                      <div key={i} className={`ord-line batch-line${isBatched ? "" : " no-batch"}`}>
                        {isBatched && (
                          <div>
                            <input
                              value={r.batch}
                              onChange={(e) => setRow(entry.id, i, "batch", e.target.value)}
                              placeholder="e.g. B/26-27/001"
                              aria-label={`${entry.design} batch number, row ${i + 1}`}
                              aria-invalid={!!dup}
                              autoFocus={ei === 0 && i === 0}
                            />
                            {dup && (
                              <span className="field-err">
                                {dup === "form"
                                  ? `Batch “${r.batch.trim()}” is entered twice`
                                  : dup === "item"
                                    ? `Batch “${r.batch.trim()}” is already used for this item`
                                    : `Batch “${r.batch.trim()}” already exists — duplicate batch numbers are disabled in Settings`}
                              </span>
                            )}
                          </div>
                        )}
                        <DateInput
                          value={r.date}
                          onChange={(e) => setRow(entry.id, i, "date", e.target.value)}
                          aria-label={`${entry.design} mfg date, row ${i + 1}`}
                        />
                        <NumberInput
                          min={0}
                          max={Number.isFinite(cap) ? cap : undefined}
                          value={r.qty}
                          onChange={(e) => setRow(entry.id, i, "qty", e.target.value)}
                          placeholder="0"
                          aria-label={`${entry.design} qty in boxes, row ${i + 1}`}
                          autoFocus={!isBatched && ei === 0 && i === 0}
                        />
                        <input
                          value={r.note}
                          onChange={(e) => setRow(entry.id, i, "note", e.target.value)}
                          placeholder="Optional"
                          aria-label={`${entry.design} remark, row ${i + 1}`}
                        />
                        <button
                          className="btn ord-rm"
                          disabled={rows.length === 1}
                          onClick={() => removeLine(entry.id, i)}
                          title="Remove row"
                          tabIndex={-1}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button className="linkish" onClick={() => addLine(entry)} tabIndex={-1}>
                    <Icon name="plus" size={12} /> {isBatched ? "New Batch" : "Add line"}
                  </button>
                  <span className="muted" style={{ marginLeft: "auto", fontSize: "var(--t-sm)" }}>
                    {isBatched ? "Batches" : "Lines"} added: {rows.length}
                  </span>
                </div>
              </div>

              {/* Make-to-stock output never reaches the palletization queue, so
                  the pallet would have nowhere to land. Prefilled from the SO
                  line's own pallet, changeable here. */}
              {entry.orderItemId && (
                <div className="form-section">
                  <div className="form-section-title">Associate Pallet</div>
                  <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <label className="form-field">
                      <Combobox
                        value={palletIds[entry.id]}
                        options={palletOpts.map((p) => ({ value: p.id, label: p.name }))}
                        onChange={(v) => setPalletIds((m) => ({ ...m, [entry.id]: v }))}
                        placeholder={palletOpts.length ? "Choose pallet…" : "No matching pallet"}
                      />
                    </label>
                  </div>
                </div>
              )}
              </Fragment>
            );
          })}
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

/** One counter in the header strip — "Label: value" on one line. */
function Count({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
      <span className="dim">{label}:</span>
      <span className="mono" style={{ color, fontWeight: 600, fontSize: 16 }}>{fmt(value)}</span>
    </span>
  );
}
