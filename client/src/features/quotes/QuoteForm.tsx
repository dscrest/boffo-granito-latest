/* ============================================================
   New Quote form — header (customer, terms, port, currency) +
   line items (item/design, qty, rate, discount %). FRONTEND-ONLY:
   emits a Quote draft to QuotesTable local state. Field keys mirror
   the Export Tracker `Quotes` reference for later Data Store wiring.
   Reuses shared form/modal CSS (df-*, form-*, ord-*).
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import {
  docTotals,
  lineTotals,
  type Quote,
  type QuoteLine,
  type TaxType,
} from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import { composeAddress, composeExtraAddress, parseAddresses, type CustomerRow } from "@/features/masters/customersApi";
import { currentSalespersonName, salesPersonOptions } from "@/features/masters/salespersonApi";
import { currencyCodes, rateFor } from "@/features/masters/currenciesApi";
import { fmt } from "@/lib/format";
import { todayISO, addDays } from "@/lib/dates";
import { NumberInput } from "../../ui/NumberInput";

// #16 status set on QuoteDetail bar; #18 TDS/TCS removed — STATUSES/TAX_TYPES no longer used here.

interface Charges {
  docDiscount: string;
  adjustment: string;
  taxType: TaxType;
  taxPct: string;
}

const emptyLine = (): QuoteLine => ({ item: "", qty: 1, rate: 0, discount: 0, description: "" });

/* The customer's addresses of one kind: the primary billing or shipping
   column set plus any same-typed extra addresses added from the customer
   detail screen. */
function customerAddresses(cust: CustomerRow | undefined, kind: "billing" | "shipping"): string[] {
  if (!cust) return [];
  const primary =
    kind === "billing"
      ? composeAddress(cust.extras, "billing") || cust.address
      : composeAddress(cust.extras, "shipping");
  const extras = parseAddresses(cust.extras.additional_addresses)
    .filter((a) => a.type === kind)
    .map(composeExtraAddress);
  return [...new Set([primary, ...extras].filter(Boolean))];
}

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `q${++_seq}`;

type Head = Required<
  Pick<
    Quote,
    | "customer"
    | "address"
    | "shippingAddress"
    | "quoteDate"
    | "expiryDate"
    | "paymentTerm"
    | "portOfDischarge"
    | "status"
    | "currency"
    | "remarks"
    | "salesperson"
    | "referenceNo"
    | "customerNotes"
    | "terms"
  >
>;

export function QuoteForm({
  nextSeq,
  initial,
  presetCustomer,
  clone,
  onSave,
  onClose,
}: {
  nextSeq: number;
  initial?: Quote;
  /** Pre-fill the customer on a NEW quote (deep-link from customer detail). */
  presetCustomer?: string;
  /** Clone mode: `initial` prefills every field, but this saves as a NEW quote
      (fresh id/number, Draft status, no SO link) — not an edit of the source. */
  clone?: boolean;
  onSave: (q: Quote) => void;
  onClose: () => void;
}) {
  const editing = !!initial && !clone;
  const { customers, parties, designs, salesPersons, paymentTerms, currencies } = useMasters();
  const [h, setH] = useState<Head>({
    customer: initial?.customer ?? presetCustomer ?? "",
    address: initial?.address ?? "",
    shippingAddress: initial?.shippingAddress ?? "",
    // New quote: default Quote Date = today, Expiry = +15 days (#13).
    quoteDate: initial?.quoteDate ?? todayISO(),
    expiryDate: initial?.expiryDate ?? addDays(todayISO(), 15),
    paymentTerm: initial?.paymentTerm ?? "",
    portOfDischarge: initial?.portOfDischarge ?? "",
    status: clone ? "Draft" : initial?.status ?? "Draft",
    currency: initial?.currency ?? "INR",
    remarks: initial?.remarks ?? "",
    salesperson: initial?.salesperson ?? "",
    referenceNo: initial?.referenceNo ?? "",
    customerNotes: initial?.customerNotes ?? "",
    terms: initial?.terms ?? "",
  });
  const [lines, setLines] = useState<QuoteLine[]>(
    initial && initial.lines.length ? initial.lines.map((l) => ({ ...l })) : [emptyLine()],
  );
  const num2str = (n: number | undefined) => (n ? String(n) : "");
  const [charges, setCharges] = useState<Charges>({
    docDiscount: num2str(initial?.docDiscount),
    adjustment: num2str(initial?.adjustment),
    taxType: initial?.taxType ?? "None",
    taxPct: num2str(initial?.taxPct),
  });
  const setCharge = <K extends keyof Charges>(k: K, val: Charges[K]) =>
    setCharges((p) => ({ ...p, [k]: val }));

  // Exchange rate to INR for the picked currency — auto-filled from the
  // Currency master whenever the currency changes, typable to override
  // for this quote (saved on the Quote row).
  const [fx, setFx] = useState(() => (initial?.exchangeRate ? String(initial.exchangeRate) : "1"));

  const setHead = (k: keyof Head, val: string) => {
    // Auto-fill from the Customer master when a known customer is picked:
    // ALL customer fields carry over — addresses, payment term, currency
    // and the customer's own sales person (falls back to logged-in user).
    const cust = k === "customer" ? customers.find((x) => x.name === val) : undefined;
    if (k === "currency") setFx(String(rateFor(currencies, val)));
    if (cust?.currency) setFx(String(rateFor(currencies, cust.currency)));
    setH((p) => {
      const next = { ...p, [k]: val };
      if (cust) {
        const billing = composeAddress(cust.extras, "billing") || cust.address;
        const shipping = composeAddress(cust.extras, "shipping") || billing;
        if (billing) next.address = billing;
        if (shipping) next.shippingAddress = shipping;
        if (cust.paymentTermLabel) next.paymentTerm = cust.paymentTermLabel;
        if (cust.currency) next.currency = cust.currency;
        if (cust.handlingPersonLabel) next.salesperson = cust.handlingPersonLabel;
      }
      return next;
    });
  };

  // Pick-list of the selected customer's addresses of one kind. The current
  // value stays selectable even when it's not on the master (legacy quotes /
  // free text) — a Combobox renders blank when its value is missing.
  const addressOptions = (current: string, kind: "billing" | "shipping") => {
    const all = customerAddresses(customers.find((x) => x.name === h.customer), kind);
    if (current && !all.includes(current)) all.unshift(current);
    return all.map((a) => ({ value: a, label: a }));
  };

  // Preset customer (deep-link): re-pick it once the customer master loads
  // so the existing setHead branch fills the address too.
  const presetDone = useRef(false);
  useEffect(() => {
    if (editing || !presetCustomer || presetDone.current || !customers.length) return;
    presetDone.current = true;
    setHead("customer", presetCustomer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, editing, presetCustomer]);

  // New quote: default the salesperson to the rep linked to the logged-in user.
  const defaultedSp = useRef(false);
  useEffect(() => {
    if (editing || defaultedSp.current || !salesPersons.length) return;
    const name = currentSalespersonName(salesPersons);
    if (name) {
      defaultedSp.current = true;
      setH((p) => (p.salesperson ? p : { ...p, salesperson: name }));
    }
  }, [salesPersons, editing]);

  const setLine = (i: number, k: keyof QuoteLine, val: string) =>
    setLines((ls) =>
      ls.map((l, j) =>
        j === i ? { ...l, [k]: k === "item" || k === "description" ? val : Number(val) || 0 } : l,
      ),
    );
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const validLines = lines.filter((l) => l.item && l.qty > 0);
  const charge = useMemo(
    () => ({
      docDiscount: Number(charges.docDiscount) || 0,
      adjustment: Number(charges.adjustment) || 0,
      taxType: charges.taxType,
      taxPct: Number(charges.taxPct) || 0,
    }),
    [charges],
  );
  const totals = useMemo(() => docTotals(validLines, charge), [validLines, charge]);
  const missing = !h.customer.trim() || validLines.length === 0;

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const customerErr = showErrors && !h.customer.trim() ? "Customer is required" : null;

  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    const party = parties.find((x) => x.name === h.customer);
    onSave({
      ...h,
      exchangeRate: Number(fx) || 1,
      id: editing ? initial!.id : newId().slice(0, 6).toUpperCase(),
      quoteNo: editing ? initial!.quoteNo : `QT/2026-27/${String(nextSeq).padStart(3, "0")}`,
      partyCode: party?.code ?? initial?.partyCode ?? "",
      soNumber: editing ? initial?.soNumber ?? null : null,
      docDiscount: charge.docDiscount,
      adjustment: charge.adjustment,
      taxType: charge.taxType,
      taxPct: charge.taxPct,
      taxAmount: totals.taxAmt,
      lines: validLines,
    });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="quote" size={18} />
          </div>
          <div>
            <div className="ttl">{editing ? `Edit Quote · ${initial!.quoteNo}` : clone ? "Clone Quote" : "New Quote"}</div>
            <div className="sub2">{clone ? `Copy of ${initial!.quoteNo}` : ""}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Quote Details</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Customer<span className="req"> *</span>
                </span>
                <Combobox
                  value={h.customer}
                  onChange={(v) => setHead("customer", v)}
                  placeholder="Search customer…"
                  options={parties.map((p) => ({ value: p.name, label: p.name, hint: p.code }))}
                />
                {customerErr && <span className="field-err">{customerErr}</span>}
              </label>
              <label className="form-field">
                <span className="lbl">Quote Date</span>
                <DateInput value={h.quoteDate} onChange={(e) => setHead("quoteDate", e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Expiry Date</span>
                <DateInput value={h.expiryDate} onChange={(e) => setHead("expiryDate", e.target.value)} />
              </label>
              {/* #14: Reference No. removed from quotes (lives on the SO only). */}
              <label className="form-field">
                <span className="lbl">Salesperson</span>
                <Combobox
                  value={h.salesperson}
                  options={salesPersonOptions(salesPersons)}
                  onChange={(v) => setHead("salesperson", v)}
                  placeholder="Search sales person…"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Payment Term</span>
                <select value={h.paymentTerm} onChange={(e) => setHead("paymentTerm", e.target.value)}>
                  <option value=""></option>
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.label}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Port of Discharge removed from quotes 2026-07-13 — the stored
                  value passes through unchanged when editing legacy quotes. */}
              <label className="form-field">
                <span className="lbl">Currency</span>
                <select value={h.currency} onChange={(e) => setHead("currency", e.target.value)}>
                  {/* Saved value stays selectable even if its master row is gone. */}
                  {[...new Set([...currencyCodes(currencies), ...(h.currency ? [h.currency] : [])])].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              {h.currency !== "INR" && (
                <label className="form-field">
                  <span className="lbl">Exchange Rate (₹ per 1 {h.currency})</span>
                  <NumberInput
                    min={0}
                    step="0.0001"
                    value={fx}
                    onChange={(e) => setFx(e.target.value)}
                    title="Auto-filled from the Currency master — type to override for this quote"
                  />
                </label>
              )}
              {/* #16: Status removed from the form — set via the status bar on
                  QuoteDetail (Zoho-Books style). New quotes default to "Draft". */}
              {/* Billing/shipping picked from the customer's addresses (primary
                  billing + shipping + extras added on the customer detail page);
                  free text still allowed for one-off addresses. */}
              <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Billing Address</span>
                <Combobox
                  value={h.address}
                  options={addressOptions(h.address, "billing")}
                  onChange={(v) => setHead("address", v)}
                  onCreate={(v) => setHead("address", v)}
                  placeholder="Select or type the billing address…"
                />
              </div>
              <div className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Shipping Address</span>
                <Combobox
                  value={h.shippingAddress}
                  options={addressOptions(h.shippingAddress, "shipping")}
                  onChange={(v) => setHead("shippingAddress", v)}
                  onCreate={(v) => setHead("shippingAddress", v)}
                  placeholder="Select or type the shipping address…"
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Line Items</div>

            <div className="ord-lines">
              <div className="ord-line ord-line-head qt-line">
                <span>Item</span>
                <span>Qty</span>
                <span>Rate</span>
                <span>Disc %</span>
                <span>Sub Total</span>
                <span />
              </div>
              {lines.map((l, i) => {
                const t = lineTotals(l);
                return (
                  <div className="ord-line qt-line" key={i}>
                    <div className="form-field" style={{ gap: 2 }}>
                      <Combobox
                        value={l.item}
                        onChange={(v) => setLine(i, "item", v)}
                        placeholder="Search item…"
                        options={designs.map((x) => ({
                          value: x.uniqueName,
                          label: x.uniqueName || x.name,
                          hint: [x.size, x.finish].filter(Boolean).join(" · "),
                        }))}
                      />
                      <textarea
                        rows={1}
                        tabIndex={-1}
                        value={l.description ?? ""}
                        onChange={(e) => setLine(i, "description", e.target.value)}
                        placeholder="Add a description to your item"
                      />
                    </div>
                    <NumberInput  value={l.qty || ""} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="0" />
                    <NumberInput  value={l.rate || ""} onChange={(e) => setLine(i, "rate", e.target.value)} placeholder="0.00" />
                    <NumberInput  value={l.discount || ""} onChange={(e) => setLine(i, "discount", e.target.value)} placeholder="0" />
                    <span className="mono qt-sub">
                      {fmt(t.subTotal)}
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
                <span className="mono">{fmt(totals.qty)}</span>
              </div>
              <div className="row">
                <span className="dim">Gross</span>
                <span className="mono">{h.currency} {fmt(totals.gross)}</span>
              </div>
              <div className="row">
                <span className="dim">Line Discount</span>
                <span className="mono" style={{ color: "var(--c-red)" }}>− {h.currency} {fmt(totals.discount)}</span>
              </div>
              <div className="row">
                <span className="dim">Subtotal</span>
                <span className="mono">{h.currency} {fmt(totals.final)}</span>
              </div>
              {/* #17: document-level Discount removed from quotes — inline per-line
                  discount only. Adjustment kept. */}
              <div className="row charge">
                <span className="dim">Adjustment</span>
                <NumberInput  value={charges.adjustment} placeholder="0.00" onChange={(e) => setCharge("adjustment", e.target.value)} />
              </div>
              {/* #18: TDS/TCS tax option removed from quotes. */}
              <div className="row total">
                <span>Net Total</span>
                <span className="mono">{h.currency} {fmt(totals.net)}</span>
              </div>
              {h.currency !== "INR" && (
                <div className="row">
                  <span className="dim" title={`At rate 1 ${h.currency} = ₹${Number(fx) || 1}`}>≈ INR</span>
                  <span className="mono dim">₹ {fmt(totals.net * (Number(fx) || 1))}</span>
                </div>
              )}
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Remarks &amp; Notes</div>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Remarks</span>
                <input value={h.remarks} onChange={(e) => setHead("remarks", e.target.value)} placeholder="Notes for this quote" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Customer Notes</span>
                <textarea rows={2} value={h.customerNotes} onChange={(e) => setHead("customerNotes", e.target.value)} placeholder="Notes shown to the customer" />
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
                {validLines.length === 0 ? "Add at least one line with an item + quantity" : "Fill the required fields above"}
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
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
