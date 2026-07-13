/* ============================================================
   Quote print template — branded A4 quotation sheet implementing the
   claude.ai/design "Quotation Template" (2026-07-11): dark logo band,
   meta panel, spec'd item table, amount-in-words, terms + bank details,
   signature blocks and orange footer rule.

   Rendered through a body portal so the @media print rules can hide
   the app chrome and emit only the sheet. Frontend-only.
   ============================================================ */
import { createPortal } from "react-dom";
import { Icon } from "@/ui/Icon";
import { docTotals, lineTotals, type Quote } from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import boffoLogo from "@/assets/boffo-logo.png";
import { BANK, COMPANY, amountInWords, moneyFor, prettyDate, termsList } from "./quoteTemplate";

export function QuotePrint({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { designs } = useMasters();
  const totals = docTotals(quote.lines, {
    docDiscount: quote.docDiscount,
    adjustment: quote.adjustment,
    taxType: quote.taxType,
    taxPct: quote.taxPct,
  });

  const money = moneyFor(quote.currency);
  const totalBoxes = quote.lines.reduce((s, l) => s + (l.qty || 0), 0);
  const terms = termsList(quote.terms);

  return createPortal(
    <div className="qprint-overlay" onClick={onClose}>
      {/* Design font; sheet falls back to Helvetica when offline. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Semi+Condensed:wght@600;700&display=swap"
        rel="stylesheet"
      />
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
          <img src={boffoLogo} alt="Boffo Granito — Adorable Surfaces" />
          <div className="qp-doctitle">
            <div className="qp-doc">QUOTATION</div>
            <div className="qp-doc-rule" />
          </div>
        </header>

        <section className="qp-parties">
          <div>
            <div className="qp-eyebrow">Quotation For</div>
            <div className="qp-cust">{quote.customer}</div>
            <div className="qp-addr">{quote.address || "—"}</div>
          </div>
          <div className="qp-meta">
            <div className="row"><span className="k">QUOTE NO.</span><span className="v">{quote.quoteNo}</span></div>
            <div className="row"><span className="k">DATE</span><span className="v">{prettyDate(quote.quoteDate)}</span></div>
            <div className="row"><span className="k">VALID UNTIL</span><span className="v accent">{prettyDate(quote.expiryDate)}</span></div>
            <div className="row"><span className="k">SALES REP</span><span className="v">{quote.salesperson || "—"}</span></div>
          </div>
        </section>

        <section className="qp-items">
          <table className="qp-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th>Product / Design</th>
                <th style={{ width: 82 }}>Size (mm)</th>
                <th style={{ width: 70 }}>Finish</th>
                <th className="num" style={{ width: 52 }}>Boxes</th>
                <th className="num" style={{ width: 74 }}>Rate /Box</th>
                <th className="num" style={{ width: 48 }}>Disc %</th>
                <th className="num" style={{ width: 84 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l, i) => {
                const d = designs.find((x) => x.name === l.item);
                const t = lineTotals(l);
                return (
                  <tr key={i}>
                    <td className="sub">{String(i + 1).padStart(2, "0")}</td>
                    <td>
                      <div className="qp-item-name">{l.item}</div>
                      {d?.brand && <div className="qp-item-sub">{d.brand}</div>}
                      {l.description && <div className="qp-item-sub">{l.description}</div>}
                    </td>
                    <td>{d?.size || "—"}</td>
                    <td>{d?.finish || "—"}</td>
                    <td className="num">{fmtInt(l.qty)}</td>
                    <td className="num">{money(l.rate)}</td>
                    <td className="num">{l.discount || 0}</td>
                    <td className="num strong">{money(t.subTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="qp-totals">
            <div className="qp-words">
              <b>Amount in words: </b>
              {amountInWords(totals.net, quote.currency)}
              {quote.customerNotes && (
                <div className="qp-notes">
                  <b>Notes: </b>
                  {quote.customerNotes}
                </div>
              )}
            </div>
            <div className="qp-sum">
              <div className="row"><span>Total boxes</span><b>{fmtInt(totalBoxes)}</b></div>
              <div className="row"><span>Subtotal</span><b>{money(totals.final)}</b></div>
              {totals.docDiscount > 0 && (
                <div className="row"><span>Discount</span><b>− {money(totals.docDiscount)}</b></div>
              )}
              {totals.adjustment !== 0 && (
                <div className="row"><span>Adjustment</span><b>{money(totals.adjustment)}</b></div>
              )}
              {totals.taxType !== "None" && (
                <div className="row">
                  <span>{totals.taxType} ({totals.taxPct}%)</span>
                  <b>{totals.taxType === "TDS" ? "− " : "+ "}{money(totals.taxAmt)}</b>
                </div>
              )}
              <div className="grand"><span>TOTAL</span><b>{money(totals.net)}</b></div>
              <div className="qp-taxnote">Taxes, freight &amp; insurance extra as applicable.</div>
            </div>
          </div>
        </section>

        <section className="qp-cols">
          <div>
            <div className="qp-sec-title">Terms &amp; Conditions</div>
            <ol className="qp-terms-list">
              {terms.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </div>
          <div>
            <div className="qp-sec-title">Bank Details</div>
            <div className="qp-bank">
              {BANK.map(([k, v]) => (
                <div key={k}><b>{k}:</b> {v}</div>
              ))}
            </div>
          </div>
        </section>

        <section className="qp-sign">
          <div>
            <div className="qp-sign-label">CUSTOMER ACCEPTANCE</div>
            <div className="qp-sign-line">Signature &amp; company stamp</div>
          </div>
          <div>
            <div className="qp-sign-label ink">FOR BOFFO GRANITO LLP</div>
            <div className="qp-sign-line">Authorised signatory</div>
          </div>
        </section>

        <footer className="qp-foot">
          <b>{COMPANY.name}</b>
          <div>{COMPANY.address}</div>
          <div>{COMPANY.contact}</div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const fmtInt = (n: number) => (n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
