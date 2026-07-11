/* ============================================================
   quotePdf — quotation PDF via pdfmake (lib/pdf). Mirrors the
   QuotePrint template: line table + doc-charge totals (docTotals).
   ============================================================ */
import { docTotals, lineTotals, type Quote } from "@/data";
import { downloadPdf, metaLines, money, PDF_STYLES, pdfHeader } from "@/lib/pdf";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

/** pdfmake document definition for one quote (shared by download + inline preview). */
export function buildQuoteDoc(quote: Quote): TDocumentDefinitions {
  const totals = docTotals(quote.lines, {
    docDiscount: quote.docDiscount,
    adjustment: quote.adjustment,
    taxType: quote.taxType,
    taxPct: quote.taxPct,
  });
  const cur = quote.currency;

  const lineRows: Content[][] = quote.lines.map((l, i) => {
    const t = lineTotals(l);
    return [
      { text: String(i + 1), style: "td" },
      { text: l.item, style: "td" },
      { text: String(l.qty), style: "tdNum" },
      { text: money(l.rate), style: "tdNum" },
      { text: l.discount ? `${l.discount}%` : "—", style: "tdNum" },
      { text: money(t.subTotal), style: "tdNum" },
    ];
  });

  const totalRow = (label: string, value: string, style = "totVal"): Content => ({
    columns: [{ text: "" }, { width: 130, text: label, style: "totLabel" }, { width: 110, text: value, style }],
    margin: [0, 1, 0, 1],
  });

  const totalsBlock: Content[] = [
    totalRow("Gross", `${cur} ${money(totals.gross)}`),
    totalRow("Line Discount", `− ${cur} ${money(totals.discount)}`),
    totalRow("Subtotal", `${cur} ${money(totals.final)}`),
  ];
  if (totals.docDiscount > 0) totalsBlock.push(totalRow("Discount", `− ${cur} ${money(totals.docDiscount)}`));
  if (totals.adjustment !== 0) totalsBlock.push(totalRow("Adjustment", `${cur} ${money(totals.adjustment)}`));
  if (totals.taxType !== "None")
    totalsBlock.push(
      totalRow(
        `${totals.taxType} (${totals.taxPct}%)`,
        `${totals.taxType === "TDS" ? "− " : "+ "}${cur} ${money(totals.taxAmt)}`,
      ),
    );
  totalsBlock.push(totalRow("Net Total", `${cur} ${money(totals.net)}`, "grand"));

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    styles: PDF_STYLES,
    content: [
      pdfHeader("QUOTATION", quote.quoteNo),
      {
        columns: [
          metaLines([
            ["Customer", quote.customer],
            ["Address", quote.address || undefined],
            ["Reference", quote.referenceNo],
            ["Salesperson", quote.salesperson],
          ]),
          metaLines([
            ["Quote Date", quote.quoteDate],
            ["Valid Until", quote.expiryDate],
            ["Payment Term", quote.paymentTerm || undefined],
            ["Port of Discharge", quote.portOfDischarge || undefined],
            ["Currency", cur],
          ]),
        ],
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: [22, "*", 50, 65, 45, 85] as const,
          body: [
            [
              { text: "#", style: "th" },
              { text: "Design / Item", style: "th" },
              { text: "Qty", style: "th", alignment: "right" },
              { text: "Rate/Box", style: "th", alignment: "right" },
              { text: "Disc", style: "th", alignment: "right" },
              { text: "Subtotal", style: "th", alignment: "right" },
            ],
            ...lineRows,
          ],
        },
        layout: "lightHorizontalLines",
      },
      { stack: totalsBlock, margin: [0, 10, 0, 0] },
      ...(quote.customerNotes
        ? [{ text: "Notes", style: "h2" } as Content, { text: quote.customerNotes, style: "meta" } as Content]
        : []),
      ...(quote.terms
        ? [{ text: "Terms & Conditions", style: "h2" } as Content, { text: quote.terms, style: "meta" } as Content]
        : []),
      { text: "Computer-generated quotation — no signature required.", style: "fine", margin: [0, 24, 0, 0] },
    ],
  };
}

/** Build and download the PDF for one quote. */
export async function downloadQuotePdf(quote: Quote): Promise<void> {
  await downloadPdf(buildQuoteDoc(quote), `${quote.quoteNo.replace(/[\\/]/g, "-")}.pdf`);
}
