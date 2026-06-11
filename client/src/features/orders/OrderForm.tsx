/* ============================================================
   New Order form — captures the Catalyst `SalesOrder` header +
   `OrderItem` line items. FRONTEND-ONLY: emits an OrderDraft to
   OrdersTable local state (no DB writes yet). Header field keys +
   line keys match the Data Store column names for 1:1 API wiring
   later. Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { CATEGORIES, DESIGNS, PARTIES, docTotals, type TaxType } from "@/data";
import { fmt } from "@/lib/format";

const TAX_TYPES: TaxType[] = ["None", "TDS", "TCS"];

export interface OrderLine {
  design: string;
  ordered_qty_boxes: string;
  rate: string;
  discount: string;
}

export interface OrderDraft {
  _id: string;
  customer: string;
  po_number: string;
  order_date: string;
  shipment_date: string;
  payment_term: string;
  port_of_discharge: string;
  status: string;
  currency: string;
  remarks: string;
  salesperson: string;
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

const PAYMENT_TERMS = ["Advance", "Credit 30", "Net 15", "Net 30", "Net 45", "Net 60"];
const STATUSES = ["Confirmed", "InProgress", "Cancelled"];
const CURRENCIES = ["INR", "USD", "EUR"];

type FieldKind = "text" | "date" | "select";
interface FieldSpec {
  key: keyof OrderDraft;
  label: string;
  kind?: FieldKind;
  options?: string[];
  required?: boolean;
}

const HEADER: FieldSpec[] = [
  { key: "customer", label: "Customer", kind: "select", options: PARTIES.map((p) => p.name), required: true },
  { key: "po_number", label: "PO Number", required: true },
  { key: "order_date", label: "Order Date", kind: "date" },
  { key: "shipment_date", label: "Shipment Date", kind: "date" },
  { key: "payment_term", label: "Payment Term", kind: "select", options: PAYMENT_TERMS },
  { key: "currency", label: "Currency", kind: "select", options: CURRENCIES },
  { key: "status", label: "Status", kind: "select", options: STATUSES },
  { key: "salesperson", label: "Salesperson" },
  { key: "port_of_discharge", label: "Port of Discharge" },
];

const emptyLine = (): OrderLine => ({ design: "", ordered_qty_boxes: "", rate: "", discount: "" });

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `o${++_seq}`;

export function OrderForm({
  onSave,
  onClose,
}: {
  onSave: (o: OrderDraft) => void;
  onClose: () => void;
}) {
  const [h, setH] = useState<Omit<OrderDraft, "_id" | "lines">>({
    customer: "",
    po_number: "",
    order_date: "",
    shipment_date: "",
    payment_term: "",
    port_of_discharge: "",
    status: "Confirmed",
    currency: "EUR",
    remarks: "",
    salesperson: "",
    customer_notes: "",
    terms: "",
    docDiscount: "",
    adjustment: "",
    taxType: "None",
    taxPct: "",
  });
  const [lines, setLines] = useState<OrderLine[]>([emptyLine()]);
  const [cat, setCat] = useState("");
  const itemOptions = useMemo(
    () => (cat ? DESIGNS.filter((d) => d.category === cat) : DESIGNS),
    [cat],
  );

  const setHead = (k: string, val: string) => setH((p) => ({ ...p, [k]: val }) as typeof p);
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
  const missing = HEADER.some((f) => f.required && !String(h[f.key as keyof typeof h]).trim()) || validLines.length === 0;

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
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="orders" size={18} />
          </div>
          <div>
            <div className="ttl">New Order</div>
            <div className="sub2">Sales order · local draft — not yet saved to database</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Order Details</div>
            <div className="form-grid">
              {HEADER.map((f) => {
                const err = fieldError(f);
                return (
                  <label key={f.key} className="form-field">
                    <span className="lbl">
                      {f.label}
                      {f.required && <span className="req"> *</span>}
                    </span>
                    {f.key === "customer" ? (
                      <Combobox
                        value={h.customer}
                        onChange={(v) => setHead("customer", v)}
                        placeholder="Search customer…"
                        options={PARTIES.map((p) => ({ value: p.name, label: p.name, hint: p.code }))}
                      />
                    ) : f.kind === "select" ? (
                      <select
                        className={err ? "error" : ""}
                        value={h[f.key as keyof typeof h]}
                        onChange={(e) => setHead(f.key, e.target.value)}
                      >
                        <option value="">—</option>
                        {f.options!.map((o) => (
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
                {totalBoxes} boxes · {h.currency} {fmt(totals.net)}
              </span>
            </div>

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
                const d = DESIGNS.find((x) => x.name === l.design);
                return (
                  <div className="ord-line qt-line" key={i}>
                    <div className="form-field" style={{ gap: 2 }}>
                      <select value={l.design} onChange={(e) => setLine(i, "design", e.target.value)}>
                        <option value="">Select design…</option>
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
                    <input
                      type="number"
                      value={l.ordered_qty_boxes}
                      onChange={(e) => setLine(i, "ordered_qty_boxes", e.target.value)}
                      placeholder="0"
                    />
                    <input
                      type="number"
                      value={l.rate}
                      onChange={(e) => setLine(i, "rate", e.target.value)}
                      placeholder="0.00"
                    />
                    <input
                      type="number"
                      value={l.discount}
                      onChange={(e) => setLine(i, "discount", e.target.value)}
                      placeholder="0"
                    />
                    <span className="mono" style={{ alignSelf: "center", color: "var(--fg)" }}>
                      {fmt(orderLineSub(l))}
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
                <span className="dim">Subtotal</span>
                <span className="mono">{h.currency} {fmt(totals.final)}</span>
              </div>
              <div className="row charge">
                <span className="dim">Discount</span>
                <input type="number" value={h.docDiscount} placeholder="0.00" onChange={(e) => setHead("docDiscount", e.target.value)} />
              </div>
              <div className="row charge">
                <span className="dim">Adjustment</span>
                <input type="number" value={h.adjustment} placeholder="0.00" onChange={(e) => setHead("adjustment", e.target.value)} />
              </div>
              <div className="row charge">
                <span className="lbl-wrap">
                  <select value={h.taxType} onChange={(e) => setHead("taxType", e.target.value)}>
                    {TAX_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {h.taxType !== "None" && (
                    <input type="number" value={h.taxPct} placeholder="%" onChange={(e) => setHead("taxPct", e.target.value)} />
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
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {validLines.length === 0 ? "Add at least one line with a design + quantity" : "Fill the required fields above"}
              </span>
            ) : (
              "* required · ≥1 line item"
            )}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit}>
            <Icon name="check" size={13} />
            Save order
          </button>
        </div>
      </div>
    </div>
  );
}
