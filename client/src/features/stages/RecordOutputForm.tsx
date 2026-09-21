/* ============================================================
   Record Output / Add Batches — logs the ACTUAL boxes produced against one or
   MORE approved production lines in a single modal (one section per item, the
   item name as the section title). Each section: a TABLE of batch rows
   (headers once, bare inputs, ✕ per row): batch no. · mfg date · qty ·
   remark, with a "+ New Batch" link underneath. The palletization queue takes
   the SO line's own pallet (server fallback) — the pallet is picked/confirmed
   later, at palletise time. Batch-tracked items make the batch no. mandatory and save via
   /production-record-lines; singular items drop that column and save one
   /production-record per line. Sections left untouched are skipped on save,
   so "Record all" can record just some items. Tab flows row → row → next
   item. Bumps OrderItem.produced (order-linked, capped at remaining). Reused
   by the Production grid + detail.
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { Combobox } from "@/ui/Combobox";
import { useBoxBrands } from "@/features/masters/boxBrands";
import { useStockLookup } from "@/features/masters/LineStock";
import { useOrders } from "@/features/orders/useOrders";
import { demandByDesign } from "@/lib/needProduction";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
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
  | { batches: { rows: ProductionRecordLine[]; performed_by?: string; pallet?: string; box_brand?: string } };

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
  // Box Brand the boxes are packed in — one per item section (CR-197).
  const { options: brandOpts } = useBoxBrands();
  const [brandById, setBrandById] = useState<Record<string, string>>({});
  // Box Brand follows the orders (CR-200): an order-linked line takes its SO's
  // brand; stock production takes the brand most in demand among the open
  // orders still waiting on that item. A prefill only — the user can change it.
  const { orders } = useOrders();
  const stockFor = useStockLookup();
  useEffect(() => {
    if (!orders.length) return;
    const demand = demandByDesign(orders, stockFor);
    setBrandById((cur) => {
      const next = { ...cur };
      for (const e of entries) {
        if (next[e.id] !== undefined) continue; // already prefilled or user-touched
        const own = e.orderItemId ? orders.find((o) => o.id === e.orderItemId)?.boxBrandId : "";
        next[e.id] = own || demand.find((d) => d.designName === e.design)?.brands.find((b) => b.boxBrandId)?.boxBrandId || "";
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stockFor is a fresh closure each render
  }, [orders, entries]);
  const panelRef = useModalA11y(onClose);

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
        (r, i) => (parseInt(r.qty, 10) || 0) <= 0 || (batched && dupKind(entry, r, i) !== null),
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
            payload: { batches: { rows: lines, performed_by: loggedBy, box_brand: brandById[entry.id] || undefined } },
          };
        }
        const singles: ProductionRecordInput[] = rows.map((r) => ({
          qty_boxes: parseInt(r.qty, 10) || 0,
          production_date: r.date,
          performed_by: loggedBy,
          note: r.note.trim() || undefined,
          box_brand: brandById[entry.id] || undefined,
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
                  <label className="form-field" style={{ minWidth: 220, margin: 0 }}>
                    <span className="lbl">Box Brand</span>
                    <Combobox
                      value={brandById[entry.id] || ""}
                      options={brandOpts}
                      onChange={(v) => setBrandById((m) => ({ ...m, [entry.id]: v }))}
                      placeholder="Pick a box brand…"
                      ariaLabel={`${entry.design} box brand`}
                    />
                  </label>
                  <span style={{ display: "flex", gap: 14, marginLeft: "auto" }}>
                    <Count label="Requested" value={entry.qtyRequested} />
                    {/* Committed output only — the typed rows below show up in "Left to add". */}
                    <Count label="Produced" value={entry.producedSoFar} />
                    {over ? (
                      <Count label="Over by" value={-left} color="var(--c-red)" />
                    ) : (
                      <Count label="Left to add" value={left} />
                    )}
                  </span>
                </div>

                {/* CR-237: what this line already has, so a new batch isn't a guess. */}
                {entry.records.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="lbl" style={{ marginBottom: 4 }}>Already logged</div>
                    {entry.records.map((r) => (
                      <div key={r.id} className="mono" style={{ display: "flex", gap: 14, fontSize: "var(--t-sm)", padding: "2px 0" }}>
                        <span style={{ minWidth: 130 }}>{r.batchNumber || "—"}</span>
                        <span className="dim">{(r.productionDate || "").slice(0, 10) || "—"}</span>
                        <span style={{ marginLeft: "auto", color: "var(--c-green)" }}>{fmt(r.qtyBoxes)} boxes</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Batch table — column headers once, bare inputs per row (the row
                    labels are the header). Non-batched items drop the Batch column. */}
                <div className="ord-lines">
                  <div className={`ord-line batch-line${isBatched ? "" : " no-batch"} ord-line-head`}>
                    {isBatched && <span>Batch No.</span>}
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
                              placeholder="Auto-numbered if blank"
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
      <span className="mono" style={{ color, fontWeight: 600, fontSize: 18 }}>{fmt(value)}</span>
    </span>
  );
}
