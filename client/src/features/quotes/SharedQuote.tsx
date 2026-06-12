/* ============================================================
   SharedQuote — public, read-only quote view (P2 share link).

   Rendered OUTSIDE AuthGate (main.tsx branches on the #/share/quote/
   hash), so customers can open the link without signing in. Fetches
   the quote by its share_token and re-uses the docTotals math +
   quotePdf download. Token = unguessable 32-hex capability.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { docTotals, lineTotals, type Quote, type QuoteLine } from "@/data";
import { fmt } from "@/lib/format";
import { list } from "@/lib/dataOps";

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

/** #/share/quote/<token> → token, or "". */
export function shareTokenFromHash(hash: string): string {
  const m = /^#\/share\/quote\/([A-Za-z0-9]+)/.exec(hash);
  return m ? m[1] : "";
}

async function fetchSharedQuote(token: string): Promise<{ quote: Quote | null; error?: string }> {
  const q = await list("Quote", { where: `share_token = '${token.replace(/[^A-Za-z0-9]/g, "")}'`, limit: 1 });
  if (!q.ok) return { quote: null, error: q.error };
  const r = (q.rows || [])[0];
  if (!r) return { quote: null, error: "This share link is invalid or has been revoked." };
  const id = str(r.ROWID);

  const [items, customers, terms, designs] = await Promise.all([
    list("QuoteItem", { where: `quote = ${id}`, limit: 300 }),
    list("Customer", { where: `ROWID = ${str(r.customer) || "0"}`, columns: ["name", "code"] }),
    list("PaymentTerm", { limit: 300, columns: ["name"] }),
    list("Design", { limit: 300, columns: ["design_name"] }),
  ]);
  const designName = new Map((designs.rows || []).map((d) => [str(d.ROWID), str(d.design_name)]));
  const termName = new Map((terms.rows || []).map((t) => [str(t.ROWID), str(t.name)]));
  const cust = (customers.rows || [])[0];

  const lines: QuoteLine[] = (items.rows || []).map((it) => ({
    item: designName.get(str(it.design)) || str(it.design),
    qty: num(it.quantity_boxes),
    rate: num(it.rate),
    discount: num(it.discount_pct),
  }));

  return {
    quote: {
      id,
      quoteNo: str(r.quote_number),
      customer: cust ? str(cust.name) : "",
      partyCode: cust ? str(cust.code) : "",
      address: str(r.address),
      quoteDate: str(r.quote_date),
      expiryDate: str(r.expiry_date),
      paymentTerm: termName.get(str(r.payment_term)) || "",
      portOfDischarge: str(r.port_of_discharge),
      status: "Sent",
      currency: str(r.currency) || "EUR",
      remarks: str(r.remarks),
      salesperson: str(r.salesperson),
      referenceNo: str(r.reference_no),
      customerNotes: str(r.customer_notes),
      terms: str(r.terms),
      docDiscount: num(r.discount),
      adjustment: num(r.adjustment),
      taxType: r.tax_type === "TDS" || r.tax_type === "TCS" ? r.tax_type : "None",
      taxPct: num(r.tax_pct),
      lines,
      soNumber: null,
      shareToken: token,
    },
  };
}

export function SharedQuote() {
  const token = shareTokenFromHash(window.location.hash);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Missing share token.");
      return;
    }
    let alive = true;
    void fetchSharedQuote(token).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.quote) setQuote(res.quote);
      else setError(res.error || "Quote not found.");
    });
    return () => {
      alive = false;
    };
  }, [token]);

  const totals = useMemo(
    () =>
      quote
        ? docTotals(quote.lines, {
            docDiscount: quote.docDiscount,
            adjustment: quote.adjustment,
            taxType: quote.taxType,
            taxPct: quote.taxPct,
          })
        : null,
    [quote],
  );

  const onPdf = async () => {
    if (!quote) return;
    const { downloadQuotePdf } = await import("./quotePdf");
    await downloadQuotePdf(quote);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #f4f4f8)", padding: "32px 16px" }}>
      <div className="card" style={{ maxWidth: 760, margin: "0 auto", padding: 28 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>BOFFO</div>
            <div className="muted" style={{ fontSize: 12 }}>Order OS · Plant Morbi</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>QUOTATION</div>
            <div className="mono muted">{quote?.quoteNo || ""}</div>
          </div>
        </div>

        {loading && <div className="muted">Loading quote…</div>}
        {error && <div style={{ color: "var(--c-red, #c0392b)" }}>{error}</div>}

        {quote && totals && (
          <>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, fontSize: 13 }}>
              <div>
                <div><b>Customer:</b> {quote.customer}</div>
                {quote.address && <div className="muted">{quote.address}</div>}
                {quote.referenceNo && <div><b>Reference:</b> {quote.referenceNo}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                {quote.quoteDate && <div><b>Date:</b> {quote.quoteDate}</div>}
                {quote.expiryDate && <div><b>Valid until:</b> {quote.expiryDate}</div>}
                {quote.paymentTerm && <div><b>Payment:</b> {quote.paymentTerm}</div>}
                {quote.portOfDischarge && <div><b>Port:</b> {quote.portOfDischarge}</div>}
              </div>
            </div>

            <table className="tbl" style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Design / Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate/Box</th>
                  <th className="num">Disc</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="mono muted">{i + 1}</td>
                    <td>{l.item}</td>
                    <td className="num mono">{l.qty}</td>
                    <td className="num mono">{fmt(l.rate)}</td>
                    <td className="num mono">{l.discount ? `${l.discount}%` : "—"}</td>
                    <td className="num mono">{fmt(lineTotals(l).subTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 14, marginLeft: "auto", maxWidth: 280, fontSize: 13 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Gross</span>
                <b className="mono">{quote.currency} {fmt(totals.gross)}</b>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Line Discount</span>
                <b className="mono">− {quote.currency} {fmt(totals.discount)}</b>
              </div>
              {totals.docDiscount > 0 && (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">Discount</span>
                  <b className="mono">− {quote.currency} {fmt(totals.docDiscount)}</b>
                </div>
              )}
              {totals.adjustment !== 0 && (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">Adjustment</span>
                  <b className="mono">{quote.currency} {fmt(totals.adjustment)}</b>
                </div>
              )}
              {totals.taxType !== "None" && (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{totals.taxType} ({totals.taxPct}%)</span>
                  <b className="mono">{totals.taxType === "TDS" ? "− " : "+ "}{quote.currency} {fmt(totals.taxAmt)}</b>
                </div>
              )}
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6, fontSize: 15 }}>
                <span><b>Net Total</b></span>
                <b className="mono">{quote.currency} {fmt(totals.net)}</b>
              </div>
            </div>

            {quote.customerNotes && (
              <div style={{ marginTop: 16, fontSize: 13 }}>
                <b>Notes</b>
                <div className="muted">{quote.customerNotes}</div>
              </div>
            )}
            {quote.terms && (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <b>Terms &amp; Conditions</b>
                <div className="muted">{quote.terms}</div>
              </div>
            )}

            <div className="row" style={{ marginTop: 22, justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: 11 }}>
                Read-only quotation shared by BOFFO. Contact your salesperson to accept or amend.
              </span>
              <button className="hbtn" onClick={() => void onPdf()}>Download PDF</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
