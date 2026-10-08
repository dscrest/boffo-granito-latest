/* ============================================================
   Sample Order form (CR-315) — the Panel Order / Sales Order shape: a
   customer's request for item SAMPLES, one line per item × piece
   (Full tile | Cut piece × cut size) × qty. A full FormPage (.form-rows
   label-left) hosted by SampleOrderFormPage at /sample-orders/new ·
   /:id/edit · /:id/clone. One Save = ONE /sample-order-save call; the
   server mints SMP/FY/NNN. "Request Samples" from a Quote / SO (CR-317)
   opens it with the customer locked and that sale's designs preselected
   as Full-tile lines. Any Item-master design can be sampled; cut sizes
   come from the Cut Piece Size master (Create … write-through).
   Sales Person defaults to the logged-in user; Order Date to today.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { cachedCustomers, listCustomers, type CustomerRow } from "@/features/masters/customersApi";
import { CustomerSearchModal } from "@/features/masters/CustomerSearchModal";
import { cachedSalesPersons, currentSalespersonName, listSalesPersons } from "@/features/masters/salespersonApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedCutSizes, createCutSize, listPanels, type CutSizeOption } from "./panelsApi";
import { SAMPLE_PIECE_LABEL, type SampleOrderInput, type SamplePieceKind } from "./sampleOrdersApi";

type Line = { designId: string; pieceKind: SamplePieceKind; cutSizeId: string; qty: number; note: string };
const emptyLine = (designId = ""): Line => ({ designId, pieceKind: "Full", cutSizeId: "", qty: 1, note: "" });
const lineKey = (l: Line) => `${l.designId}|${l.pieceKind}|${l.pieceKind === "Cut" ? l.cutSizeId : ""}`;

export function SampleOrderForm({
  initial,
  orderNumber,
  isEdit,
  presetCustomerId,
  presetDesignIds,
  source,
  onSave,
  onClose,
}: {
  /** Edit / clone prefill (sampleOrderToInput). */
  initial?: SampleOrderInput;
  /** Shown read-only on edit; blank on create ("Auto-assigned on save"). */
  orderNumber?: string;
  isEdit?: boolean;
  /** "Request Samples" (CR-317): the sale's customer — shown read-only. */
  presetCustomerId?: string;
  /** Designs on the source sale — each starts as a Full-tile line. */
  presetDesignIds?: string[];
  /** Source identity for the page sub-title, e.g. "From Sales Order SO/2026-27/012". */
  source?: { label: string };
  onSave: (input: SampleOrderInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const form = useFormSave(onClose);
  const [customers, setCustomers] = useState<CustomerRow[]>(() => cachedCustomers() ?? []);
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [salesperson, setSalesperson] = useState(() => initial?.salesperson || currentSalespersonName(cachedSalesPersons() ?? []));

  const [customer, setCustomer] = useState(initial?.customer ?? presetCustomerId ?? "");
  const [custSearch, setCustSearch] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    () =>
      initial?.lines.map((l) => ({ designId: l.design, pieceKind: l.piece_kind, cutSizeId: l.cut_piece_size || "", qty: l.qty, note: l.note || "" })) ??
      (presetDesignIds?.length ? presetDesignIds.map((d) => emptyLine(d)) : [emptyLine()]),
  );
  const [orderDate, setOrderDate] = useState(initial?.order_date || todayISO());
  const [note, setNote] = useState(initial?.note || "");

  useEffect(() => {
    void listCustomers().then((r) => r.ok && setCustomers(r.customers));
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    void listSalesPersons().then((r) => r.ok && setSalesperson((s) => s || currentSalespersonName(r.salesPersons)));
  }, []);

  const customerOptions = useMemo(
    () => customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, hint: c.code || undefined })),
    [customers],
  );
  const customerName = customers.find((c) => c.id === customer)?.name ?? "";
  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);
  // Any live item can be sampled — inactive items stay pickable only if already on the order.
  const designOptions = useMemo(
    () => designs.filter((d) => d.status !== "Inactive").map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.sizeLabel || undefined })),
    [designs],
  );
  const cutOptions = useMemo(() => cutSizes.map((c) => ({ value: c.id, label: c.label })), [cutSizes]);

  const setLine = (i: number, patch: Partial<Line>) => {
    form.touch();
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const addLine = () => {
    form.touch();
    setLines((ls) => [...ls, emptyLine()]);
  };
  const removeLine = (i: number) => {
    form.touch();
    setLines((ls) => ls.filter((_, j) => j !== i));
  };
  // "Create …" on the Cut Piece Size picker — write-through to the master, then select it.
  const onCreateCutSize = async (i: number, name: string) => {
    const res = await createCutSize(name);
    if (!res.ok || !res.rowid) {
      toast.error(res.error || "Could not add the cut piece size to the master");
      return;
    }
    setCutSizes((prev) => [...prev, { id: res.rowid!, label: name.trim() }].sort((a, b) => a.label.localeCompare(b.label)));
    setLine(i, { cutSizeId: res.rowid });
  };

  const dupKeys = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const l of lines) {
      if (!l.designId) continue;
      const k = lineKey(l);
      if (seen.has(k)) dup.add(k);
      seen.add(k);
    }
    return dup;
  }, [lines]);
  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const filled = lines.filter((l) => l.designId);
  const lineOk = (l: Line) => !!l.designId && l.qty > 0 && (l.pieceKind === "Full" || !!l.cutSizeId);
  const canSave = !!customer && lines.length > 0 && lines.every(lineOk) && dupKeys.size === 0;

  const submit = () => {
    if (!canSave) return;
    void form.run(() =>
      onSave({
        customer,
        salesperson,
        order_date: orderDate,
        note: note.trim() || undefined,
        lines: lines.map((l) => ({
          design: l.designId,
          piece_kind: l.pieceKind,
          cut_piece_size: l.pieceKind === "Cut" ? l.cutSizeId : undefined,
          qty: l.qty,
          note: l.note.trim() || undefined,
        })),
      }),
    );
  };

  return (
    <FormPage
      title={isEdit ? "Edit Sample Order" : source ? "Request Samples" : "New Sample Order"}
      sub={isEdit ? orderNumber || "" : (source?.label ?? "")}
      busy={form.busy}
      saveDisabled={!canSave}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note="* Indicates a mandatory field"
    >
      <div className="form-section">
        <div className="form-section-title">Order Details</div>
        <div className="form-rows">
          <div className="form-field span2">
            <span className="lbl">
              Customer<span className="req"> *</span>
            </span>
            {presetCustomerId ? (
              <input value={customerName} readOnly tabIndex={-1} className="calc" title="From the source sale" />
            ) : (
              <div className="ctl-row">
                <Combobox
                  className="grow"
                  value={customer}
                  options={customerOptions}
                  onChange={(v) => {
                    form.touch();
                    setCustomer(v);
                  }}
                  placeholder="Search customer…"
                  ariaLabel="Customer"
                />
                <button type="button" className="btn" aria-label="Search customers" title="Search customers" onClick={() => setCustSearch(true)}>
                  <Icon name="search" size={13} />
                </button>
              </div>
            )}
          </div>
          <label className="form-field">
            <span className="lbl">Order No</span>
            <input value={orderNumber || ""} readOnly tabIndex={-1} className="calc" placeholder="Auto-assigned on save" title="SMP number assigned by the system" />
          </label>
          <label className="form-field">
            <span className="lbl">Order Date</span>
            <DateInput
              value={orderDate}
              onChange={(e) => {
                form.touch();
                setOrderDate(e.target.value);
              }}
            />
          </label>
          <label className="form-field">
            <span className="lbl">Sales Person</span>
            <input value={salesperson} readOnly tabIndex={-1} className="calc" placeholder="From your sign-in" title="Auto-filled from your sign-in" />
          </label>
          <label className="form-field span2">
            <span className="lbl">Notes</span>
            <textarea
              value={note}
              rows={2}
              onChange={(e) => {
                form.touch();
                setNote(e.target.value);
              }}
              placeholder="Anything the godown should know"
            />
          </label>
        </div>
      </div>

      {/* SO-style line items: one row per item × piece. */}
      <div className="form-section">
        <div className="form-section-title">Samples</div>
        <div className="ord-lines">
          <div className="ord-line ord-line-head smp-line">
            <span>
              Item<span className="req"> *</span>
            </span>
            <span>Piece</span>
            <span>Cut Piece Size</span>
            <span>
              Qty<span className="req"> *</span>
            </span>
            <span>Note</span>
            <span />
          </div>
          {lines.map((l, i) => {
            const d = designById.get(l.designId);
            const dup = !!l.designId && dupKeys.has(lineKey(l));
            return (
              <div className="ord-line smp-line" key={i}>
                <div className="form-field" style={{ gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ImageThumb images={d?.images ?? []} size={28} alt={d?.uniqueName ?? ""} />
                    <Combobox className="grow" value={l.designId} onChange={(v) => setLine(i, { designId: v })} placeholder="Search item…" options={designOptions} invalid={dup} ariaLabel="Item" />
                  </div>
                  {dup && <span className="field-err">Already on this order — change its quantity instead</span>}
                </div>
                <select value={l.pieceKind} onChange={(e) => setLine(i, { pieceKind: e.target.value as SamplePieceKind, cutSizeId: "" })} aria-label="Piece">
                  {(Object.keys(SAMPLE_PIECE_LABEL) as SamplePieceKind[]).map((k) => (
                    <option key={k} value={k}>
                      {SAMPLE_PIECE_LABEL[k]}
                    </option>
                  ))}
                </select>
                {l.pieceKind === "Cut" ? (
                  <Combobox
                    value={l.cutSizeId}
                    options={cutOptions}
                    onChange={(v) => setLine(i, { cutSizeId: v })}
                    onCreate={(name) => void onCreateCutSize(i, name)}
                    placeholder="Cut piece size…"
                    invalid={!!l.designId && !l.cutSizeId}
                    ariaLabel="Cut piece size"
                  />
                ) : (
                  <input value={d?.sizeLabel ? `Full size — ${d.sizeLabel}` : "Full size"} readOnly tabIndex={-1} className="calc" aria-label="Cut piece size" />
                )}
                <NumberInput min={1} value={l.qty || ""} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} placeholder="1" aria-label="Quantity" />
                <input value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} placeholder="Optional" aria-label="Line note" />
                <button type="button" className="btn ord-rm" onClick={() => removeLine(i)} title="Remove line" aria-label="Remove line" tabIndex={-1}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="btn" onClick={addLine}>
            <Icon name="plus" size={12} /> Add item
          </button>
        </div>
        <div className="qt-totals">
          <div className="row total">
            <span>Total</span>
            <span className="mono">
              {filled.length} item{filled.length === 1 ? "" : "s"} · {fmt(totalQty)} pcs
            </span>
          </div>
        </div>
      </div>

      {custSearch && (
        <CustomerSearchModal
          onPick={(c) => {
            form.touch();
            setCustomer(c.id);
          }}
          onClose={() => setCustSearch(false)}
        />
      )}
    </FormPage>
  );
}
