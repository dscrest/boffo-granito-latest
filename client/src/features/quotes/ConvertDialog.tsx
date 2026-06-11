/* ============================================================
   Convert a Quote → Sales Order.

   Qty-driven: every line shows a mandatory Convert Qty (defaults to the
   full quote qty). Conversion mode is DERIVED, not toggled:
     · all lines at their full quote qty → Full convert (automatic)
     · any line reduced, or a line set to 0 (excluded) → Partial convert
   A line with Convert Qty 0 is dropped from the Sales Order. Convert Qty
   cannot exceed the quoted qty.

   Calls the data-ops `convert-quote` endpoint (creates the SalesOrder +
   OrderItems server-side and sets Quote.conversion_flag).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { lineTotals, type Quote } from "@/data";
import { fmt } from "@/lib/format";
import { convertQuote } from "./quotesApi";

let _soSeq = 4; // provisional client-side SO number until TransactionSeries wiring
const nextSoNumber = () => `SO/2026-27/${String(++_soSeq).padStart(3, "0")}`;

export function ConvertDialog({
  quote,
  onClose,
  onConverted,
}: {
  quote: Quote;
  onClose: () => void;
  onConverted: (quoteId: string, soNumber: string) => void;
}) {
  // Per-line convert qty; defaults to the full quoted qty.
  const [qty, setQty] = useState<number[]>(() => quote.lines.map((l) => l.qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Errors stay hidden until the first convert attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);

  const setLineQty = (i: number, v: string) =>
    setQty((s) => s.map((x, j) => (j === i ? Math.max(0, Number(v) || 0) : x)));

  const included = quote.lines.map((l, i) => ({ line: l, qty: qty[i] })).filter((x) => x.qty > 0);
  const overQty = quote.lines.some((l, i) => qty[i] > l.qty);
  // Full only when every line is included at its exact quoted qty.
  const isFull = included.length === quote.lines.length && quote.lines.every((l, i) => qty[i] === l.qty);
  const mode: "Full" | "Partial" = isFull ? "Full" : "Partial";

  const convert = async () => {
    if (busy) return;
    if (included.length === 0 || overQty) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError(null);
    const soNumber = nextSoNumber();
    const lines = included.map((c) => ({ item: c.line.item, qty: c.qty, rate: c.line.rate }));
    const res = await convertQuote(quote.id, mode, lines, {
      order_number: soNumber,
      payment_term: quote.paymentTerm,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Convert failed");
      toast.error(res.error || "Convert failed");
      return;
    }
    toast.success(`Quote converted to ${soNumber}`);
    onConverted(quote.id, soNumber);
    location.hash = "#/orders";
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="arrow-r" size={18} />
          </div>
          <div>
            <div className="ttl">Convert to Master Order</div>
            <div className="sub2">
              {quote.quoteNo} · {quote.customer}
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="row" style={{ marginBottom: 14, alignItems: "center", gap: 10 }}>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Conversion</span>
            <span className={`chip qstatus ${mode === "Full" ? "q-converted" : "q-partial"}`}>{mode}</span>
            <span className="dim" style={{ fontSize: "var(--t-sm)", marginLeft: "auto" }}>
              {included.length} of {quote.lines.length} lines
            </span>
          </div>

          <div className="form-section">
            <div className="form-section-title">Line Items</div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num" style={{ textAlign: "right" }}>Quote Qty</th>
                  <th className="num" style={{ textAlign: "right" }}>Convert Qty *</th>
                  <th className="num" style={{ textAlign: "right" }}>Sub Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((l, i) => {
                  const over = qty[i] > l.qty;
                  const t = lineTotals({ ...l, qty: qty[i] });
                  return (
                    <tr key={i} style={{ opacity: qty[i] > 0 ? 1 : 0.45 }}>
                      <td><span className="design-name">{l.item}</span></td>
                      <td className="num mono muted">{fmt(l.qty)}</td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          max={l.qty}
                          value={qty[i]}
                          disabled={busy}
                          onChange={(e) => setLineQty(i, e.target.value)}
                          style={{ width: 96, textAlign: "right", borderColor: over ? "var(--c-red)" : undefined }}
                        />
                      </td>
                      <td className="num mono">{fmt(t.subTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="dim" style={{ marginTop: 10, fontSize: "var(--t-sm)" }}>
              Convert Qty is mandatory. Leave every line at its full quoted qty for a <b>Full</b> conversion;
              reduce a line or set it to 0 (excluded) for a <b>Partial</b> conversion. Quote line quantities are not reduced.
            </div>
            {showErrors && included.length === 0 && (
              <div className="field-err" style={{ marginTop: 10 }}>
                Include at least one line with a Convert Qty greater than 0
              </div>
            )}
            {overQty && (
              <div className="card" style={{ marginTop: 10, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px" }}>
                Convert Qty cannot exceed the quoted qty.
              </div>
            )}
            {error && (
              <div className="card" style={{ marginTop: 10, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px" }}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="df-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={busy} onClick={convert}>
            <Icon name="arrow-r" size={13} />
            {busy ? "Converting…" : `Convert (${mode}) & open SO`}
          </button>
        </div>
      </div>
    </div>
  );
}
