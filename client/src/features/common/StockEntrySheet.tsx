/* ============================================================
   StockEntrySheet (CR-307/308) — ONE ruled sheet (the /prod/record .psheet
   skin) behind the bulk stock pages:
     · Cut Stock ▸ Add Stock      (kind receipt,    Item · Cut Piece Size · Qty · Remark)
     · Transfer Orders (kind transfer, CR-330: From / To warehouse in the bar, free-text
       reason, positive qty) — box stock on /stock-transfers/new, cut stock on /cut-stock/transfer
   CR-446: the two ADJUSTMENT pages left the sheet for the Zoho-style line form
   (common/StockAdjustForm — one line by default, date · location · reason per line).
   CR-329: receipt / adjustment sheets carry a Warehouse picker (default = primary);
   every picker hides while no warehouse exists. CR-438: on those sheets each row
   may pick its own Location (last column); a blank cell = the bar's.
   The page supplies a `spec` (what the second column is, which items, how
   to save); validation + paste live in stockEntrySheetEdit.ts (pure). One
   Save = one request; errors show in the foot, never a toast over Save.
   ============================================================ */
import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { useFormSave } from "@/ui/FormPage";
import { toast } from "@/ui/Toast";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { designIndex, warehouseIndex } from "@/features/stages/productionLogSheetEdit";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { blankRow, parseEntryPaste, resolveEntrySheet, type EntryCol, type EntryLine, type EntryRow } from "./stockEntrySheetEdit";

const START_ROWS = 20;
const GROW_BY = 10;
const blanks = (n: number) => Array.from({ length: n }, blankRow);

/** The bar's values, as handed to optionsFor / warnFor / onSave. Warehouse ids are "" while the feature is dormant.
    CR-438: optionsFor / warnFor get `warehouse` already resolved to the ROW's own when it picked one. */
export interface SheetHeader {
  date: string;
  reason: string;
  note: string;
  warehouse: string; // single mode
  from: string; // pair mode
  to: string;
}

export interface StockEntrySpec {
  title: string;
  kind: "receipt" | "transfer";
  unit: "pcs" | "boxes";
  dateLabel: string;
  /** CR-329: "single" = the warehouse the count was taken in (default primary); "pair" = From / To of a transfer. */
  warehouse?: "single" | "pair";
  /** Items offered in the Item column (already filtered by the page). */
  items: { id: string; sku: string; uniqueName: string; designName: string; hint?: string }[];
  second: {
    label: string;
    required: boolean;
    placeholder?: string;
    /** When set the cell is a Combobox fed per item; else a free-text cell. */
    optionsFor?: (designId: string, h: SheetHeader) => ComboOption[];
    /** Paste lookup: lower-cased label → value (Combobox cells only). */
    byName?: Map<string, string>;
    /** Typing an unknown value offers "Create …"; return the value to select (or undefined to abort). */
    onCreate?: (designId: string, text: string) => Promise<string | undefined>;
    /** Items for which the cell is read-only (e.g. singular items have no batch). */
    disabledFor?: (designId: string) => boolean;
  };
  /** Non-blocking warning under a line (e.g. "only 4 boxes on hand in that warehouse"). */
  warnFor?: (line: EntryLine, h: SheetHeader) => string | undefined;
  /** Persist one submission. Resolve with ok=false + error to keep the sheet open.
      CR-438: `line.warehouse` is the row's own ("" = send the header's). */
  onSave: (header: SheetHeader, lines: EntryLine[]) => Promise<{ ok: boolean; error?: string }>;
  /** Where Cancel / a successful Save go. */
  backTo: string;
  /** ColumnPicker storage key. */
  columnsKey: string;
  /** CR-414: prefilled leading rows (e.g. the item the sheet was opened from). */
  initialRows?: Partial<EntryRow>[];
}

const OPTIONAL: ColumnDef<EntryRow>[] = [{ key: "note", label: "Remark" }];
// CR-438: single-warehouse sheets add a per-row Location column (blank = the bar's).
const OPTIONAL_WH: ColumnDef<EntryRow>[] = [...OPTIONAL, { key: "warehouse", label: "Location" }];

/** Enter / ↓ / ↑ walk the same column. Comboboxes keep their own keys (option list). */
const walkColumn = (e: KeyboardEvent<HTMLTableSectionElement>) => {
  const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  const t = e.target;
  if (!step || !(t instanceof HTMLInputElement) || t.closest(".combo")) return;
  const col = t.closest("td")?.dataset.col;
  const tr = t.closest("tr");
  const next = (step > 0 ? tr?.nextElementSibling : tr?.previousElementSibling)?.querySelector<HTMLInputElement>(`td[data-col="${col}"] input`);
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.select();
};

export function StockEntrySheet({ spec }: { spec: StockEntrySpec }) {
  const navigate = useNavigate();
  const form = useFormSave(() => navigate(spec.backTo));
  const transferring = spec.kind === "transfer";

  const [rows, setRows] = useState<EntryRow[]>(() => {
    const r = blanks(START_ROWS);
    (spec.initialRows ?? []).forEach((p, i) => (r[i] = { ...r[i], ...p }));
    return r;
  });
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  // CR-329: warehouse bar — single (default primary) or From / To pair.
  const { options: whOptions, primary, enabled: whEnabled } = useWarehouses();
  const showWh = !!spec.warehouse && whEnabled;
  const [wh, setWh] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    if (!primary) return;
    setWh((v) => v || primary.id);
    setFrom((v) => v || primary.id);
  }, [primary]);
  const header = useMemo<SheetHeader>(
    () => ({
      date,
      reason: reason.trim(),
      note: note.trim(),
      warehouse: showWh && spec.warehouse === "single" ? wh : "",
      from: showWh && spec.warehouse === "pair" ? from : "",
      to: showWh && spec.warehouse === "pair" ? to : "",
    }),
    [date, reason, note, showWh, spec.warehouse, wh, from, to],
  );
  const pairBad = showWh && spec.warehouse === "pair" && (!from || !to || from === to);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState("");
  const rowWh = showWh && spec.warehouse === "single";
  const cols = useColumns(spec.columnsKey, rowWh ? OPTIONAL_WH : OPTIONAL, []);
  const shows = (key: string) => cols.visible.some((c) => c.key === key) && (key !== "warehouse" || rowWh);
  const whBarLabel = whOptions.find((o) => o.value === wh)?.label || "";
  /** The header as THIS row sees it — its own Location when picked (CR-438). */
  const headerFor = (r: EntryRow): SheetHeader => (rowWh && r.warehouse ? { ...header, warehouse: r.warehouse } : header);

  const itemOptions = useMemo<ComboOption[]>(
    () => spec.items.map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.hint })),
    [spec.items],
  );
  const lookups = useMemo(
    () => ({ designByKey: designIndex(spec.items), secondByName: spec.second.byName, warehouseByName: warehouseIndex(whOptions) }),
    [spec.items, spec.second.byName, whOptions],
  );

  /** Patch rows from index `at` on; the sheet grows so there is always a blank tail. */
  const patchRows = (at: number, patches: Partial<EntryRow>[]) => {
    form.touch();
    setRows((prev) => {
      const need = at + patches.length + 1 - prev.length;
      const next = need > 0 ? [...prev, ...blanks(Math.max(need, GROW_BY))] : [...prev];
      patches.forEach((p, i) => (next[at + i] = { ...next[at + i], ...p }));
      return next;
    });
  };
  const setCell = (i: number, patch: Partial<EntryRow>) => patchRows(i, [patch]);
  const removeRow = (i: number) => {
    form.touch();
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : blanks(1)));
  };
  const onPaste = (e: ClipboardEvent<HTMLTableSectionElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return; // a single value pastes into the cell as usual
    const td = (e.target as HTMLElement).closest<HTMLElement>("td[data-col]");
    const at = Number(td?.closest<HTMLElement>("tr")?.dataset.i);
    if (!td || !Number.isInteger(at)) return;
    e.preventDefault();
    patchRows(at, parseEntryPaste(text, td.dataset.col as EntryCol, lookups));
  };

  const { lines, errors, total } = useMemo(() => resolveEntrySheet(rows, { secondRequired: spec.second.required }), [rows, spec.second.required]);
  const bad = (r: EntryRow, col: EntryCol) => showErrors && !!errors.get(r.key)?.has(col);
  const lineByKey = useMemo(() => new Map(lines.map((l) => [l.key, l])), [lines]);
  const reasonMissing = transferring && !reason.trim();

  const save = () =>
    form.run(async () => {
      if (errors.size > 0 || lines.length === 0 || reasonMissing || pairBad) {
        setShowErrors(true);
        return;
      }
      setSaveError("");
      const res = await spec.onSave(header, lines);
      if (!res.ok) {
        setSaveError(res.error || "Save failed");
        return;
      }
      toast.success(`${lines.length} line${lines.length === 1 ? "" : "s"} saved`);
      navigate(spec.backTo, { replace: true });
    });

  const onCreateSecond = async (i: number, designId: string, text: string) => {
    if (!spec.second.onCreate) return;
    const v = await spec.second.onCreate(designId, text);
    if (v) setCell(i, { second: v });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">{spec.title}</div>
        </div>
      </div>

      <div className="card session-fill psheet">
        <div className="psheet-bar tools">
          <label className="dim nw" htmlFor="ses-date">{spec.dateLabel}</label>
          <DateInput id="ses-date" value={date} max={todayISO()} style={{ width: 150 }} onChange={(e) => setDate(e.target.value || todayISO())} />
          {showWh && spec.warehouse === "single" && (
            <>
              {/* CR-409: the leaf = "Warehouse ▸ Location"; type a code (c4) to jump to it. */}
              <label className="dim nw">Location</label>
              <div style={{ width: 240 }}>
                <Combobox value={wh} options={whOptions} clearable={false} maxVisible={120} ariaLabel="Location" onChange={(v) => { form.touch(); setWh(v); }} />
              </div>
            </>
          )}
          {showWh && spec.warehouse === "pair" && (
            <>
              <label className="dim nw">From <span className="req">*</span></label>
              <div style={{ width: 230 }}>
                <Combobox value={from} options={whOptions} maxVisible={120} placeholder="From location…" invalid={showErrors && (!from || from === to)} ariaLabel="From location" onChange={(v) => { form.touch(); setFrom(v); }} />
              </div>
              <label className="dim nw">To <span className="req">*</span></label>
              <div style={{ width: 230 }}>
                <Combobox value={to} options={whOptions.filter((o) => o.value !== from)} maxVisible={120} placeholder="To location…" invalid={showErrors && (!to || from === to)} ariaLabel="To location" onChange={(v) => { form.touch(); setTo(v); }} />
              </div>
            </>
          )}
          {transferring && (
            <>
              <label className="dim nw" htmlFor="ses-treason">Reason <span className="req">*</span></label>
              <input id="ses-treason" value={reason} style={{ width: 220 }} placeholder="Why is stock moving?" aria-invalid={showErrors && reasonMissing} onChange={(e) => { form.touch(); setReason(e.target.value); }} />
            </>
          )}
          <label className="dim nw" htmlFor="ses-note">Note</label>
          <input id="ses-note" value={note} style={{ width: 240 }} placeholder="Applies to every line" onChange={(e) => { form.touch(); setNote(e.target.value); }} />
          <span style={{ flex: 1 }} />
          <span className="dim nw"><span className="req">*</span> Required</span>
          <ColumnPicker columns={cols.ordered} hidden={cols.hidden} onToggle={cols.toggle} onMove={cols.move} active={cols.customised} />
        </div>

        <div className="pane-scroll" style={{ overflowX: "auto" }}>
          <table className="psheet-tbl">
            <thead>
              <tr>
                <th className="rn" />
                <th className="cust">Item <span className="req">*</span></th>
                <th>{spec.second.label}{spec.second.required && <> <span className="req">*</span></>}</th>
                <th className="num qtyh">Qty ({spec.unit}) <span className="req">*</span></th>
                {shows("note") && <th>Remark</th>}
                {shows("warehouse") && <th>Location</th>}
                <th className="rm" />
              </tr>
            </thead>
            <tbody onKeyDown={walkColumn} onPaste={onPaste}>
              {rows.map((r, i) => {
                const filled = !!r.design && (parseInt(r.qty, 10) || 0) > 0;
                const rowBad = showErrors && errors.has(r.key);
                const warn = spec.warnFor && lineByKey.has(r.key) ? spec.warnFor(lineByKey.get(r.key)!, headerFor(r)) : undefined;
                const secondDisabled = !r.design || !!spec.second.disabledFor?.(r.design);
                return (
                  <tr key={r.key} data-i={i} className={filled ? "on" : undefined}>
                    <td className={`rn mono ${rowBad ? "err" : ""}`}>{i + 1}</td>
                    <td className={`cust cellin ${bad(r, "design") ? "bad" : ""}`} data-col="design" style={{ minWidth: 300 }}>
                      <Combobox
                        value={r.design}
                        options={itemOptions}
                        placeholder={r.unmatched || "Item…"}
                        invalid={bad(r, "design")}
                        ariaLabel={`Item, row ${i + 1}`}
                        onChange={(v) => setCell(i, { design: v, unmatched: "", ...(v !== r.design ? { second: "" } : {}) })}
                      />
                      {warn && <div className="dim" style={{ fontSize: "var(--t-sm)", color: "var(--c-amber)", padding: "0 8px 4px" }}>{warn}</div>}
                    </td>
                    <td className={`cellin ${bad(r, "second") ? "bad" : ""}`} data-col="second" style={{ minWidth: 200 }}>
                      {spec.second.optionsFor ? (
                        <Combobox
                          value={r.second}
                          options={r.design ? spec.second.optionsFor(r.design, headerFor(r)) : []}
                          placeholder={secondDisabled ? "" : spec.second.placeholder || `${spec.second.label}…`}
                          invalid={bad(r, "second")}
                          disabled={secondDisabled}
                          ariaLabel={`${spec.second.label}, row ${i + 1}`}
                          onCreate={spec.second.onCreate ? (text) => void onCreateSecond(i, r.design, text) : undefined}
                          onChange={(v) => setCell(i, { second: v })}
                        />
                      ) : (
                        <input
                          className="mono"
                          value={r.second}
                          placeholder={secondDisabled ? "" : spec.second.placeholder}
                          disabled={secondDisabled}
                          aria-label={`${spec.second.label}, row ${i + 1}`}
                          onChange={(e) => setCell(i, { second: e.target.value })}
                        />
                      )}
                    </td>
                    <td className={`qty ${bad(r, "qty") ? "bad" : ""}`} data-col="qty">
                      <NumberInput maxDecimals={0} value={r.qty} placeholder="0" aria-label={`Quantity, row ${i + 1}`} onChange={(e) => setCell(i, { qty: e.target.value })} />
                    </td>
                    {shows("note") && (
                      <td className="cellin" data-col="note" style={{ minWidth: 200 }}>
                        <input value={r.note} aria-label={`Remark, row ${i + 1}`} onChange={(e) => setCell(i, { note: e.target.value })} />
                      </td>
                    )}
                    {shows("warehouse") && (
                      <td className="cellin" data-col="warehouse" style={{ minWidth: 200 }}>
                        <Combobox value={r.warehouse} options={whOptions} maxVisible={120} placeholder={whBarLabel} ariaLabel={`Location, row ${i + 1}`} onChange={(v) => setCell(i, { warehouse: v })} />
                      </td>
                    )}
                    <td className="rm">
                      <button className="rm-x" tabIndex={-1} onClick={() => removeRow(i)} aria-label={`Remove row ${i + 1}`}>
                        <Icon name="x" size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="rn" />
                <td className="cust">Total <span className="dim" style={{ fontWeight: 400 }}>· {lines.length} line{lines.length === 1 ? "" : "s"}</span></td>
                <td />
                <td className="num mono">{fmt(total)}</td>
                <td colSpan={(shows("note") ? 1 : 0) + (shows("warehouse") ? 1 : 0) + 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="session-foot">
        <div className="psheet-stats">
          <span><i>Lines</i><b className="mono">{lines.length}</b></span>
          <span><i>{spec.unit === "pcs" ? "Pieces" : "Boxes"}</i><b className="mono">{fmt(total)}</b></span>
        </div>
        <button className="btn" onClick={() => setRows((prev) => [...prev, ...blanks(GROW_BY)])} disabled={form.busy} title="Add 10 more rows">
          <Icon name="plus" size={12} /> {GROW_BY} rows
        </button>
        <span role="alert" style={{ color: "var(--c-red)" }}>
          {showErrors && (errors.size > 0 || reasonMissing || pairBad)
            ? [errors.size > 0 ? `${errors.size} row${errors.size === 1 ? "" : "s"} to fix` : "", reasonMissing ? "give a reason" : "", pairBad ? "pick two different warehouses" : ""].filter(Boolean).join(" · ")
            : saveError}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => void form.cancel()} disabled={form.busy}>Cancel</button>
        <button className="hbtn primary" onClick={() => void save()} disabled={form.busy || lines.length === 0}>
          <Icon name="check" size={13} />
          {form.busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
