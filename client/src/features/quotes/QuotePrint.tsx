/* ============================================================
   Quote print template — formatted, print/PDF-ready quotation sheet.
   Rendered through a body portal so the @media print rules can hide
   the app chrome and emit only the sheet. Frontend-only.
   ============================================================ */
import { createPortal } from "react-dom";
import { Icon } from "@/ui/Icon";
import { docTotals, lineTotals, type Quote } from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import { fmt } from "@/lib/format";

export function QuotePrint({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { designs } = useMasters();
  const totals = docTotals(quote.lines, {
    docDiscount: quote.docDiscount,
    adjustment: quote.adjustment,
    taxType: quote.taxType,
    taxPct: quote.taxPct,
  });

  return createPortal(
    <div className="qprint-overlay" onClick={onClose}>
      <div className="qprint-bar" onClick={(e) => e.stopPropagation()}>
        <span className="mono dim">{quote.quoteNo}</span>
        <div style={{ flex: 1 }} />
        <button className="hbtn" onClick={onClose}>
          <Icon name="x" size={13} /> Close
        </button>
        <button className="hbtn primary" onClick={() => window.print()}>
          <Icon name="printer" size={13} /> Print / PDF
        </button>
      </div>

      <div className="qprint-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="qp-head">
          <div>
            <div className="qp-brand">BOFFO GRANITO</div>
            <div className="qp-brand-sub">Morbi, Gujarat, India · GST 24XXXXX1234X1Z5</div>
          </div>
          <div className="qp-doctitle">
            <div className="qp-doc">QUOTATION</div>
            <div className="qp-meta">
              <span>No.</span>
              <b className="mono">{quote.quoteNo}</b>
            </div>
            <div className="qp-meta">
              <span>Date</span>
              <b className="mono">{quote.quoteDate || "—"}</b>
            </div>
          </div>
        </header>

        <section className="qp-parties">
          <div>
            <div className="qp-label">Bill To</div>
            <div className="qp-cust">{quote.customer}</div>
            <div className="qp-addr">{quote.address || "—"}</div>
          </div>
          <div className="qp-terms">
            <div className="row"><span>Payment Term</span><b>{quote.paymentTerm || "—"}</b></div>
            <div className="row"><span>Port of Discharge</span><b>{quote.portOfDischarge || "—"}</b></div>
            <div className="row"><span>Currency</span><b>{quote.currency}</b></div>
            <div className="row"><span>Status</span><b>{quote.status}</b></div>
          </div>
        </section>

        <table className="qp-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Item</th>
              <th>Spec</th>
              <th className="num">Qty (box)</th>
              <th className="num">Rate</th>
              <th className="num">Disc %</th>
              <th className="num">Sub Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l, i) => {
              const d = designs.find((x) => x.name === l.item);
              const t = lineTotals(l);
              return (
                <tr key={i}>
                  <td className="mono">{i + 1}</td>
                  <td>{l.item}</td>
                  <td className="dim">{d ? `${d.size} · ${d.finish}` : "—"}</td>
                  <td className="num mono">{fmt(l.qty)}</td>
                  <td className="num mono">{l.rate.toFixed(2)}</td>
                  <td className="num mono">{l.discount || 0}</td>
                  <td className="num mono">{fmt(t.subTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section className="qp-foot">
          <div className="qp-remarks">
            <div className="qp-label">Remarks</div>
            <div>{quote.remarks || "—"}</div>
          </div>
          <div className="qp-sum">
            <div className="row"><span>Gross</span><b className="mono">{quote.currency} {fmt(totals.gross)}</b></div>
            <div className="row"><span>Line Discount</span><b className="mono">− {quote.currency} {fmt(totals.discount)}</b></div>
            <div className="row"><span>Subtotal</span><b className="mono">{quote.currency} {fmt(totals.final)}</b></div>
            {totals.docDiscount > 0 && (
              <div className="row"><span>Discount</span><b className="mono">− {quote.currency} {fmt(totals.docDiscount)}</b></div>
            )}
            {totals.adjustment !== 0 && (
              <div className="row"><span>Adjustment</span><b className="mono">{quote.currency} {fmt(totals.adjustment)}</b></div>
            )}
            {totals.taxType !== "None" && (
              <div className="row"><span>{totals.taxType} ({totals.taxPct}%)</span><b className="mono">{totals.taxType === "TDS" ? "− " : "+ "}{quote.currency} {fmt(totals.taxAmt)}</b></div>
            )}
            <div className="row grand"><span>Net Total</span><b className="mono">{quote.currency} {fmt(totals.net)}</b></div>
          </div>
        </section>

        <footer className="qp-sign">
          <div>This is a system-generated quotation. Prices valid 30 days from quote date.</div>
          <div className="qp-sign-box">For BOFFO GRANITO</div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
