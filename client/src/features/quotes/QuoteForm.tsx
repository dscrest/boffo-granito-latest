/* ============================================================
   New Quote form — header (customer, terms, port, currency) +
   line items (item/design, qty, rate, discount %). FRONTEND-ONLY:
   emits a Quote draft to QuotesTable local state. Field keys mirror
   the Export Tracker `Quotes` reference for later Data Store wiring.
   Reuses shared form/modal CSS (df-*, form-*, ord-*).
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import {
  CATEGORIES,
  CURRENCIES,
  DESIGNS,
  PARTIES,
  PAYMENT_TERMS,
  PORTS,
  docTotals,
  lineTotals,
  type Quote,
  type QuoteLine,
  type TaxType,
} from "@/data";
import { fmt } from "@/lib/format";

const STATUSES = ["Draft", "Sent", "Accepted"] as const;
const TAX_TYPES: TaxType[] = ["None", "TDS", "TCS"];

interface Charges {
  docDiscount: string;
  adjustment: string;
  taxType: TaxType;
  taxPct: string;
}

const CUSTOMER_ADDR: Record<string, string> = {
  MRK: "ul. Czerwone Maki 65, 30-392 Kraków, Poland",
  FLB: "Obrtnička 5, 10000 Zagreb, Croatia",
  ABS: "Verkių g. 25C, 08223 Vilnius, Lithuania",
  DDM: "Str. Alexandru Vlahuță 1, Bacău 600310, Romania",
};

const emptyLine = (): QuoteLine => ({ item: "", qty: 0, rate: 0, discount: 0 });

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `q${++_seq}`;

type Head = Required<
  Pick<
    Quote,
    | "customer"
    | "address"
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
  onSave,
  onClose,
}: {
  nextSeq: number;
  initial?: Quote;
  onSave: (q: Quote) => void;
  onClose: () => void;
}) {
  const editing = !!initial;
  const [h, setH] = useState<Head>({
    customer: initial?.customer ?? "",
    address: initial?.address ?? "",
    quoteDate: initial?.quoteDate ?? "",
    expiryDate: initial?.expiryDate ?? "",
    paymentTerm: initial?.paymentTerm ?? "",
    portOfDischarge: initial?.portOfDischarge ?? "",
    status: initial?.status ?? "Draft",
    currency: initial?.currency ?? "EUR",
    remarks: initial?.remarks ?? "",
    salesperson: initial?.salesperson ?? "",
    referenceNo: initial?.referenceNo ?? "",
    customerNotes: initial?.customerNotes ?? "",
    terms: initial?.terms ?? "",
  });
  const [lines, setLines] = useState<QuoteLine[]>(
    initial && initial.lines.length ? initial.lines.map((l) => ({ ...l })) : [emptyLine()],
  );
  const [cat, setCat] = useState("");
  const itemOptions = useMemo(
    () => (cat ? DESIGNS.filter((d) => d.category === cat) : DESIGNS),
    [cat],
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

  const setHead = (k: keyof Head, val: string) =>
    setH((p) => {
      const next = { ...p, [k]: val };
      // Auto-fill address when a known customer is picked.
      if (k === "customer") {
        const party = PARTIES.find((x) => x.name === val);
        if (party && CUSTOMER_ADDR[party.code]) next.address = CUSTOMER_ADDR[party.code];
      }
      return next;
    });

  const setLine = (i: number, k: keyof QuoteLine, val: string) =>
    setLines((ls) =>
      ls.map((l, j) => (j === i ? { ...l, [k]: k === "item" ? val : Number(val) || 0 } : l)),
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

  const submit = () => {
    if (missing) return;
    const party = PARTIES.find((x) => x.name === h.customer);
    onSave({
      ...h,
      id: initial?.id ?? newId().slice(0, 6).toUpperCase(),
      quoteNo: initial?.quoteNo ?? `QT/2026-27/${String(nextSeq).padStart(3, "0")}`,
      partyCode: party?.code ?? initial?.partyCode ?? "",
      soNumber: initial?.soNumber ?? null,
      docDiscount: charge.docDiscount,
      adjustment: charge.adjustment,
      taxType: charge.taxType,
      taxPct: charge.taxPct,
      taxAmount: totals.taxAmt,
      lines: validLines,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="quote" size={18} />
          </div>
          <div>
            <div className="ttl">{editing ? `Edit Quote · ${initial!.quoteNo}` : "New Quote"}</div>
            <div className="sub2">
              {editing ? "Editing saved quote — changes overwrite the database record" : "Sales quote · local draft — not yet saved to database"}
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
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
                  options={PARTIES.map((p) => ({ value: p.name, label: p.name, hint: p.code }))}
                />
              </label>
              <label className="form-field">
                <span className="lbl">Quote Date</span>
                <input type="date" value={h.quoteDate} onChange={(e) => setHead("quoteDate", e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Expiry Date</span>
                <input type="date" value={h.expiryDate} onChange={(e) => setHead("expiryDate", e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Reference No.</span>
                <input value={h.referenceNo} onChange={(e) => setHead("referenceNo", e.target.value)} placeholder="Customer PO / ref" />
              </label>
              <label className="form-field">
                <span className="lbl">Salesperson</span>
                <input value={h.salesperson} onChange={(e) => setHead("salesperson", e.target.value)} placeholder="Owner" />
              </label>
              <label className="form-field">
                <span className="lbl">Payment Term</span>
                <select value={h.paymentTerm} onChange={(e) => setHead("paymentTerm", e.target.value)}>
                  <option value="">—</option>
                  {PAYMENT_TERMS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Port of Discharge</span>
                <select value={h.portOfDischarge} onChange={(e) => setHead("portOfDischarge", e.target.value)}>
                  <option value="">—</option>
                  {PORTS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Currency</span>
                <select value={h.currency} onChange={(e) => setHead("currency", e.target.value)}>
                  {CURRENCIES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Status</span>
                <select value={h.status} onChange={(e) => setHead("status", e.target.value)}>
                  {STATUSES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Address</span>
                <input value={h.address} onChange={(e) => setHead("address", e.target.value)} placeholder="Customer address" />
              </label>
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

          <div className="form-section">
            <div className="form-section-title">
              Line Items
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                title="Filter items by category"
                style={{ marginLeft: 10, height: 28, width: 150, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="dim" style={{ marginLeft: "auto", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {h.currency} {fmt(totals.final)} final
              </span>
            </div>

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
                const d = DESIGNS.find((x) => x.name === l.item);
                const t = lineTotals(l);
                return (
                  <div className="ord-line qt-line" key={i}>
                    <div className="form-field" style={{ gap: 2 }}>
                      <select value={l.item} onChange={(e) => setLine(i, "item", e.target.value)}>
                        <option value="">Select item…</option>
                        {itemOptions.map((x) => (
                          <option key={x.name} value={x.name}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      {d && (
                        <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                          {d.size} · {d.finish} · {d.brand}
                        </span>
                      )}
                    </div>
                    <input type="number" value={l.qty || ""} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="0" />
                    <input type="number" value={l.rate || ""} onChange={(e) => setLine(i, "rate", e.target.value)} placeholder="0.00" />
                    <input type="number" value={l.discount || ""} onChange={(e) => setLine(i, "discount", e.target.value)} placeholder="0" />
                    <span className="mono" style={{ alignSelf: "center", color: "var(--fg)" }}>
                      {fmt(t.subTotal)}
                    </span>
                    <button className="btn ord-rm" onClick={() => removeLine(i)} title="Remove line" disabled={lines.length === 1}>
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
              <div className="row charge">
                <span className="dim">Discount</span>
                <input type="number" value={charges.docDiscount} placeholder="0.00" onChange={(e) => setCharge("docDiscount", e.target.value)} />
              </div>
              <div className="row charge">
                <span className="dim">Adjustment</span>
                <input type="number" value={charges.adjustment} placeholder="0.00" onChange={(e) => setCharge("adjustment", e.target.value)} />
              </div>
              <div className="row charge">
                <span className="lbl-wrap">
                  <select value={charges.taxType} onChange={(e) => setCharge("taxType", e.target.value as TaxType)}>
                    {TAX_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {charges.taxType !== "None" && (
                    <input type="number" value={charges.taxPct} placeholder="%" onChange={(e) => setCharge("taxPct", e.target.value)} />
                  )}
                </span>
                <span className="mono" style={{ color: charges.taxType === "TDS" ? "var(--c-red)" : "var(--fg)" }}>
                  {charges.taxType === "TDS" ? "− " : charges.taxType === "TCS" ? "+ " : ""}{h.currency} {fmt(totals.taxAmt)}
                </span>
              </div>
              <div className="row total">
                <span>Net Total</span>
                <span className="mono">{h.currency} {fmt(totals.net)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* required · ≥1 line item</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            {editing ? "Update quote" : "Save quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
