/* ============================================================
   Sales Order form — new / convert-from-quote / edit modes over the
   Catalyst `SalesOrder` header + `OrderItem` line items. Emits an
   OrderDraft; callers map it via draftToInput and hit data-ops
   (so-with-items / update-so-with-items / convert-quote). Header +
   line keys match the Data Store column names.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { docTotals, type Order, type Quote, type TaxType } from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName, salesPersonOptions } from "@/features/masters/salespersonApi";
import { currencyCodes } from "@/features/masters/currenciesApi";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { NumberInput } from "../../ui/NumberInput";

const TAX_TYPES: TaxType[] = ["None", "TDS", "TCS"];

export interface OrderLine {
  design: string;
  ordered_qty_boxes: string;
  rate: string;
  discount: string;
  description: string;
}

export interface OrderDraft {
  _id: string;
  customer: string;
  po_number: string;
  order_date: string;
  shipment_date: string;
  payment_term: string;
  port_of_discharge: string;
  currency: string;
  exchange_rate?: number;
  remarks: string;
  salesperson: string;
  box_branding: string;
  customer_notes: string;
  terms: string;
  docDiscount: string;
  adjustment: string;
  taxType: TaxType;
  taxPct: string;
  lines: OrderLine[];
}

/** qty * rate, less discount %. Mirrors the server's per-line math. */
function orderLineSub(l: OrderLine): number {
  const gross = (parseInt(l.ordered_qty_boxes, 10) || 0) * (parseFloat(l.rate) || 0);
  const disc = gross * ((parseFloat(l.discount) || 0) / 100);
  return gross - disc;
}

type FieldKind = "text" | "date" | "select";
interface FieldSpec {
  key: keyof OrderDraft;
  label: string;
  kind?: FieldKind;
  options?: string[];
  required?: boolean;
}

const HEADER: FieldSpec[] = [
  // customer renders as a Combobox over the live Customer master (options unused)
  { key: "customer", label: "Customer", kind: "select", options: [], required: true },
  { key: "po_number", label: "PO Number", required: true },
  { key: "order_date", label: "Order Date", kind: "date" },
  { key: "shipment_date", label: "Shipment Date", kind: "date" },
  // options injected at render from the live PaymentTerm / Currency masters (useMasters)
  { key: "payment_term", label: "Payment Term", kind: "select", options: [] },
  { key: "currency", label: "Currency", kind: "select", options: [] },
  // Status removed from the form — managed via the status bar on OrderDetail.
  // Port of Discharge removed 2026-07-13 (hidden app-wide; carries silently).
  { key: "salesperson", label: "Salesperson" },
  // Renders as a free-text input with our Brand list as suggestions, so the
  // customer's own branding can be typed when they want their name on the boxes.
  { key: "box_branding", label: "Box Branding" },
];

const emptyLine = (): OrderLine => ({ design: "", ordered_qty_boxes: "", rate: "", discount: "", description: "" });

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `o${++_seq}`;

/** Remaining convertible boxes per design on the quote (qty − converted),
    summed across lines sharing a design — same aggregation as the server guard. */
function remainingByDesign(quote: Quote): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of quote.lines) {
    if (!l.item) continue;
    const rem = Math.max(0, (l.qty || 0) - (l.converted || 0));
    m.set(l.item, (m.get(l.item) || 0) + rem);
  }
  return m;
}

export function OrderForm({
  onSave,
  onClose,
  convert,
  initial,
  clone,
}: {
  onSave: (o: OrderDraft) => void;
  onClose: () => void;
  /** Convert-quote mode: prefill from the quote, lock customer/currency,
      cap quote-design quantities at the remaining unconverted boxes. */
  convert?: { quote: Quote };
  /** Edit mode: the SO's hydrated line items (header fields repeat on each
      row). Save replaces header + lines via update-so-with-items. */
  initial?: Order[];
  /** Clone mode: `initial` prefills the fields but Save creates a NEW order
      (parent routes onSave to create), so the title reads as a new order. */
  clone?: boolean;
}) {
  const q = convert?.quote;
  const ed = initial?.[0];
  const maxByDesign = useMemo(() => (q ? remainingByDesign(q) : new Map<string, number>()), [q]);
  const [h, setH] = useState<Omit<OrderDraft, "_id" | "lines">>({
    customer: q?.customer ?? ed?.party ?? "",
    po_number: ed?.poNumber ?? "",
    order_date: ed?.orderDate || todayISO(), // #13 default to today on new SO
    shipment_date: ed?.shipmentDate ?? "",
    payment_term: q?.paymentTerm ?? ed?.paymentTerm ?? "",
    port_of_discharge: ed?.portOfDischarge ?? "", // hidden app-wide; carries silently
    currency: q?.currency ?? ed?.currency ?? "INR",
    exchange_rate: ed?.exchangeRate,
    remarks: ed?.remarks ?? "",
    salesperson: q?.salesperson ?? ed?.salesperson ?? "",
    box_branding: ed?.boxBranding ?? "",
    customer_notes: q?.customerNotes ?? ed?.customerNotes ?? "",
    terms: q?.terms ?? ed?.terms ?? "",
    docDiscount: ed?.docDiscount ? String(ed.docDiscount) : "",
    adjustment: q?.adjustment ? String(q.adjustment) : ed?.adjustment ? String(ed.adjustment) : "",
    taxType: q?.taxType ?? ed?.taxType ?? "None",
    taxPct: q?.taxPct ? String(q.taxPct) : ed?.taxPct ? String(ed.taxPct) : "",
  });
  const [lines, setLines] = useState<OrderLine[]>(() => {
    if (initial?.length)
      return initial.map((o) => ({
        design: o.design,
        ordered_qty_boxes: String(o.orderQty || ""),
        rate: o.rate ? String(o.rate) : "",
        discount: o.discount ? String(o.discount) : "",
        description: o.description || "",
      }));
    if (!q) return [emptyLine()];
    const ls = q.lines
      .filter((l) => l.item && (l.qty || 0) - (l.converted || 0) > 0)
      .map((l) => ({
        design: l.item,
        ordered_qty_boxes: String((l.qty || 0) - (l.converted || 0)),
        rate: String(l.rate || ""),
        discount: l.discount ? String(l.discount) : "",
        description: l.description || "",
      }));
    return ls.length ? ls : [emptyLine()];
  });
  const { customers, parties, designs, salesPersons, paymentTerms, currencies } = useMasters();
  const brandOptions = useMemo(
    () => [...new Set(designs.map((d) => d.brand).filter(Boolean))].sort(),
    [designs],
  );

  // Default the salesperson to the rep linked to the logged-in user.
  const defaultedSp = useRef(false);
  useEffect(() => {
    if (defaultedSp.current || !salesPersons.length) return;
    const name = currentSalespersonName(salesPersons);
    if (name) {
      defaultedSp.current = true;
      setH((p) => (p.salesperson ? p : { ...p, salesperson: name }));
    }
  }, [salesPersons]);

  const setHead = (k: string, val: string) => {
    // Transactions inherit customer fields: picking a customer carries their
    // payment term, currency and handling sales person (mirrors QuoteForm).
    const cust = k === "customer" ? customers.find((x) => x.name === val) : undefined;
    setH((p) => {
      const next = { ...p, [k]: val } as typeof p;
      if (cust) {
        if (cust.paymentTermLabel) next.payment_term = cust.paymentTermLabel;
        if (cust.currency) next.currency = cust.currency;
        if (cust.handlingPersonLabel) next.salesperson = cust.handlingPersonLabel;
      }
      return next;
    });
  };
  const setLine = (i: number, k: keyof OrderLine, val: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: val } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const totalBoxes = useMemo(
    () => lines.reduce((s, l) => s + (parseInt(l.ordered_qty_boxes, 10) || 0), 0),
    [lines],
  );
  const charge = useMemo(
    () => ({
      docDiscount: Number(h.docDiscount) || 0,
      adjustment: Number(h.adjustment) || 0,
      taxType: h.taxType,
      taxPct: Number(h.taxPct) || 0,
    }),
    [h.docDiscount, h.adjustment, h.taxType, h.taxPct],
  );
  const totals = useMemo(
    () =>
      docTotals(
        lines.map((l) => ({
          item: l.design,
          qty: parseInt(l.ordered_qty_boxes, 10) || 0,
          rate: parseFloat(l.rate) || 0,
          discount: parseFloat(l.discount) || 0,
        })),
        charge,
      ),
    [lines, charge],
  );
  const validLines = lines.filter((l) => l.design && l.ordered_qty_boxes);
  // Convert mode: requested qty per design must fit within the quote's
  // remaining (qty − converted) boxes — mirrors the server-side guard.
  const overCap = useMemo(() => {
    if (!q) return null;
    const req = new Map<string, number>();
    for (const l of lines) {
      if (!l.design) continue;
      req.set(l.design, (req.get(l.design) || 0) + (parseInt(l.ordered_qty_boxes, 10) || 0));
    }
    for (const [design, want] of req) {
      const max = maxByDesign.get(design);
      if (max != null && want > max) return `${design}: only ${max} boxes remain on the quote`;
    }
    return null;
  }, [q, lines, maxByDesign]);
  const missing =
    HEADER.some((f) => f.required && !String(h[f.key as keyof typeof h]).trim()) ||
    validLines.length === 0 ||
    !!overCap;

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const fieldError = (f: FieldSpec): string | null =>
    showErrors && f.required && !String(h[f.key as keyof typeof h]).trim() ? `${f.label} is required` : null;

  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    onSave({ ...h, _id: newId(), lines: validLines });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="orders" size={18} />
          </div>
          <div>
            <div className="ttl">{q ? "Convert to Sales Order" : clone ? "Clone Sales Order" : ed ? "Edit Sales Order" : "New Order"}</div>
            <div className="sub2">
              {q
                ? `From quote ${q.quoteNo} · adjust quantities, dates & terms`
                : clone
                  ? `Copy of ${ed?.orderNumber || ed?.poNumber} · saves as a new order`
                  : ed
                    ? `${ed.orderNumber || ed.poNumber} · line items are replaced on save`
                    : "Sales order · saves to the database on submit"}
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Order Details</div>
            <div className="form-grid">
              {HEADER.filter((f) => !(q && f.key === "box_branding")).map((f) => {
                const err = fieldError(f);
                const locked = !!q && (f.key === "customer" || f.key === "currency");
                return (
                  <label key={f.key} className="form-field">
                    <span className="lbl">
                      {f.label}
                      {f.required && <span className="req"> *</span>}
                    </span>
                    {locked ? (
                      <input value={h[f.key as keyof typeof h]} disabled title="Fixed by the source quote" />
                    ) : f.key === "customer" ? (
                      <Combobox
                        value={h.customer}
                        onChange={(v) => setHead("customer", v)}
                        placeholder="Search customer…"
                        options={parties.map((p) => ({ value: p.name, label: p.name, hint: p.code }))}
                      />
                    ) : f.key === "salesperson" ? (
                      <Combobox
                        value={h.salesperson}
                        onChange={(v) => setHead("salesperson", v)}
                        placeholder="Search sales person…"
                        options={salesPersonOptions(salesPersons)}
                      />
                    ) : f.key === "box_branding" ? (
                      <>
                        <input
                          list="box-branding-brands"
                          value={h.box_branding}
                          onChange={(e) => setHead("box_branding", e.target.value)}
                          placeholder="Our brand, or customer's own branding"
                        />
                        <datalist id="box-branding-brands">
                          {brandOptions.map((b) => (
                            <option key={b} value={b} />
                          ))}
                        </datalist>
                      </>
                    ) : f.kind === "select" ? (
                      <select
                        className={err ? "error" : ""}
                        value={h[f.key as keyof typeof h]}
                        onChange={(e) => setHead(f.key, e.target.value)}
                      >
                        <option value=""></option>
                        {(f.key === "payment_term"
                          ? paymentTerms.map((t) => t.label)
                          : f.key === "currency"
                            ? currencyCodes(currencies)
                            : f.options!
                        ).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={err ? "error" : ""}
                        type={f.kind === "date" ? "date" : "text"}
                        value={h[f.key as keyof typeof h]}
                        onChange={(e) => setHead(f.key, e.target.value)}
                        placeholder={f.label}
                      />
                    )}
                    {err && <span className="field-err">{err}</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Line Items</div>

            <div className="ord-lines">
              <div className="ord-line ord-line-head qt-line">
                <span>Design</span>
                <span>Qty (boxes)</span>
                <span>Rate</span>
                <span>Disc %</span>
                <span>Sub Total</span>
                <span />
              </div>
              {lines.map((l, i) => {
                const d = designs.find((x) => x.name === l.design);
                return (
                  <div className="ord-line qt-line" key={i}>
                    <div className="form-field" style={{ gap: 2 }}>
                      <Combobox
                        value={l.design}
                        onChange={(v) => setLine(i, "design", v)}
                        placeholder="Search design…"
                        options={designs.map((x) => ({
                          value: x.name,
                          label: x.name,
                          hint: [x.size, x.finish].filter(Boolean).join(" · "),
                        }))}
                      />
                      {d && (
                        <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                          {d.size} · {d.finish} · {d.brand}
                        </span>
                      )}
                      <textarea
                        rows={1}
                        tabIndex={-1}
                        value={l.description}
                        onChange={(e) => setLine(i, "description", e.target.value)}
                        placeholder="Add a description to your item"
                      />
                    </div>
                    <div className="form-field" style={{ gap: 2 }}>
                      <NumberInput
                        max={q ? maxByDesign.get(l.design) : undefined}
                        value={l.ordered_qty_boxes}
                        onChange={(e) => setLine(i, "ordered_qty_boxes", e.target.value)}
                        placeholder="0"
                      />
                      {q && maxByDesign.has(l.design) && (
                        <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                          remaining {maxByDesign.get(l.design)}
                        </span>
                      )}
                    </div>
                    <NumberInput
                      value={l.rate}
                      onChange={(e) => setLine(i, "rate", e.target.value)}
                      placeholder="0.00"
                    />
                    <NumberInput
                      value={l.discount}
                      onChange={(e) => setLine(i, "discount", e.target.value)}
                      placeholder="0"
                    />
                    <span className="mono qt-sub">
                      {fmt(orderLineSub(l))}
                    </span>
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
              <div className="row">
                <span className="dim">Total Boxes</span>
                <span className="mono">{totalBoxes} boxes · {h.currency} {fmt(totals.net)}</span>
              </div>
              <div className="row">
                <span className="dim">Subtotal</span>
                <span className="mono">{h.currency} {fmt(totals.final)}</span>
              </div>
              {/* #17: document-level Discount removed from SO — inline per-line discount only. */}
              <div className="row charge">
                <span className="dim">Adjustment</span>
                <NumberInput  value={h.adjustment} placeholder="0.00" onChange={(e) => setHead("adjustment", e.target.value)} />
              </div>
              <div className="row charge">
                <span className="lbl-wrap">
                  <select value={h.taxType} onChange={(e) => setHead("taxType", e.target.value)}>
                    {TAX_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {h.taxType !== "None" && (
                    <NumberInput  value={h.taxPct} placeholder="%" onChange={(e) => setHead("taxPct", e.target.value)} />
                  )}
                </span>
                <span className="mono" style={{ color: h.taxType === "TDS" ? "var(--c-red)" : "var(--fg)" }}>
                  {h.taxType === "TDS" ? "− " : h.taxType === "TCS" ? "+ " : ""}{h.currency} {fmt(totals.taxAmt)}
                </span>
              </div>
              <div className="row total">
                <span>Order Total</span>
                <span className="mono">{h.currency} {fmt(totals.net)}</span>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Remarks &amp; Notes</div>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Remarks</span>
                <input value={h.remarks} onChange={(e) => setHead("remarks", e.target.value)} placeholder="Internal notes for this order" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Customer Notes</span>
                <textarea rows={2} value={h.customer_notes} onChange={(e) => setHead("customer_notes", e.target.value)} placeholder="Notes shown to the customer" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Terms &amp; Conditions</span>
                <textarea rows={3} value={h.terms} onChange={(e) => setHead("terms", e.target.value)} placeholder="Terms & conditions" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {validLines.length === 0
                  ? "Add at least one line with a design + quantity"
                  : overCap || "Fill the required fields above"}
              </span>
            ) : (
              "* Indicates a mandatory field"
            )}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit}>
            <Icon name="check" size={13} />
            {q ? "Convert" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
